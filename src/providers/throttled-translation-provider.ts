import { TaskQueue } from '@/lib/task-queue'
import {
  TranslationProviderError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult
} from './translation-provider'

/**
 * Google answers a burst the same way whether it is abuse or a long article, so
 * 503 is treated as the same back-pressure signal as an explicit 429.
 */
const RATE_LIMITED_STATUSES = new Set([429, 503])

export interface TranslationThrottleOptions {
  /** Translations allowed on the network at once, across every tab. */
  concurrency?: number
  /** Deadline for one attempt, measured from the moment it leaves the queue. */
  requestTimeoutMs?: number
  /** Extra attempts after the first rate-limited failure. */
  maxRetries?: number
  baseBackoffMs?: number
  maxBackoffMs?: number
  /** How long every translation fails fast after retries are exhausted. */
  cooldownMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

/**
 * Adds the back-pressure the free Google endpoint expects: a shared concurrency
 * gate, exponential backoff on rate limits, and a cooldown that stops a
 * reopened panel from re-flooding an endpoint that is already refusing us.
 */
export class ThrottledTranslationProvider implements TranslationProvider {
  private readonly queue: TaskQueue
  private readonly requestTimeoutMs: number
  private readonly maxRetries: number
  private readonly baseBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly cooldownMs: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number
  private cooldownUntil = 0

  constructor(
    private readonly provider: TranslationProvider,
    options: TranslationThrottleOptions = {}
  ) {
    this.queue = new TaskQueue(options.concurrency ?? 2)
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12_000
    this.maxRetries = options.maxRetries ?? 2
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000
    this.cooldownMs = options.cooldownMs ?? 60_000
    this.now = options.now ?? (() => Date.now())
    this.sleep = options.sleep
      ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.random = options.random ?? (() => Math.random())
  }

  translate(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    return this.queue.run(async () => {
      // A panel can close while its later sentences are still queued; those must
      // never reach the network just because a slot finally freed.
      assertNotCancelled(signal)
      return await this.translateWithRetry(request, signal)
    })
  }

  private async translateWithRetry(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    for (let attempt = 0; ; attempt += 1) {
      this.assertNotCoolingDown()
      try {
        return await this.attempt(request, signal)
      } catch (error) {
        const retryAfterMs = readRateLimit(error)
        if (retryAfterMs === null) throw error

        if (attempt >= this.maxRetries) {
          this.cooldownUntil = this.now() + this.cooldownMs
          throw this.rateLimitError(this.cooldownMs, error)
        }

        // Sleeping inside the queue slot brakes every waiting sentence too,
        // which is what actually lets the endpoint recover.
        await this.sleep(this.backoffFor(attempt, retryAfterMs))
        assertNotCancelled(signal)
      }
    }
  }

  /**
   * Each attempt gets a fresh deadline so time spent queued behind other
   * sentences never counts against the network timeout.
   */
  private async attempt(
    request: TranslationRequest,
    signal: AbortSignal
  ): Promise<TranslationResult> {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    const timeout = setTimeout(abort, this.requestTimeoutMs)
    signal.addEventListener('abort', abort)
    try {
      return await this.provider.translate(request, controller.signal)
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
  }

  private assertNotCoolingDown(): void {
    const remaining = this.cooldownUntil - this.now()
    if (remaining > 0) throw this.rateLimitError(remaining)
  }

  private rateLimitError(remainingMs: number, cause?: unknown): TranslationProviderError {
    const seconds = Math.ceil(remainingMs / 1_000)
    return new TranslationProviderError(
      `Translation is rate limited. Try again in ${seconds}s.`,
      { status: 429, cause }
    )
  }

  private backoffFor(attempt: number, retryAfterMs: number | undefined): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, this.maxBackoffMs)
    // Jitter keeps a whole article's sentences from retrying on the same tick.
    const base = this.baseBackoffMs * 2 ** attempt
    return Math.min(Math.round(base * (1 + this.random())), this.maxBackoffMs)
  }
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TranslationProviderError('Translation was cancelled.', { cause: signal.reason })
  }
}

/**
 * Returns the server-requested delay for a rate-limited failure, `undefined`
 * when it is rate limited without a hint, and `null` when it is not a rate
 * limit at all and must not be retried.
 */
function readRateLimit(error: unknown): number | null | undefined {
  if (!(error instanceof TranslationProviderError)) return null
  if (error.status === undefined || !RATE_LIMITED_STATUSES.has(error.status)) return null
  return error.retryAfterMs
}
