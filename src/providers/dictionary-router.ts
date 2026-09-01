import type { DictionarySourceId } from '@/lib/dictionary-sources'
import type { DetailedDictionaryEntry } from '@/types'
import { DictionaryProviderError } from './dictionary-provider'

/** Long enough for a healthy source, short enough to leave the next one time. */
const ATTEMPT_TIMEOUT_MS = 6_000
/** How long an unreachable source is passed over before it is tried again. */
const UNAVAILABLE_COOLDOWN_MS = 5 * 60_000

export interface DictionaryLookupResult {
  entry: DetailedDictionaryEntry
  source: DictionarySourceId
}

interface DictionaryLookupService {
  lookup(word: string, signal: AbortSignal): Promise<DetailedDictionaryEntry>
}

interface DictionaryRouterOptions {
  attemptTimeoutMs?: number
  cooldownMs?: number
  now?: () => number
}

/**
 * Walks the sources a reader can read until one of them answers.
 *
 * A public dictionary can be down for days — the community API behind Free
 * Dictionary regularly is, answering only after a gateway timeout — so each
 * source gets its own budget rather than sharing one, and a source that fails
 * to answer is passed over for a while instead of costing every later lookup
 * that same wait.
 */
export class DictionaryRouter {
  private readonly cooldowns = new Map<DictionarySourceId, number>()
  private readonly attemptTimeoutMs: number
  private readonly cooldownMs: number
  private readonly now: () => number

  constructor(
    private readonly services: Partial<Record<DictionarySourceId, DictionaryLookupService>>,
    options: DictionaryRouterOptions = {}
  ) {
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS
    this.cooldownMs = options.cooldownMs ?? UNAVAILABLE_COOLDOWN_MS
    this.now = options.now ?? (() => Date.now())
  }

  async lookup(
    word: string,
    sources: readonly DictionarySourceId[]
  ): Promise<DictionaryLookupResult> {
    let miss: unknown = null
    let outage: unknown = null

    for (const source of this.readySources(sources)) {
      const service = this.services[source]
      if (!service) continue
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.attemptTimeoutMs)
      try {
        const entry = await service.lookup(word, controller.signal)
        this.cooldowns.delete(source)
        return { entry, source }
      } catch (error) {
        // A word the reader mistyped is rejected the same way by every source.
        if (hasCode(error, 'invalid-word')) throw error
        if (hasCode(error, 'not-found')) {
          miss ??= error
        } else {
          this.cooldowns.set(source, this.now() + this.cooldownMs)
          outage = error
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    throw miss
      ?? outage
      ?? new DictionaryProviderError('unavailable', 'The dictionary is currently unavailable.')
  }

  /** A cooling source is still tried when skipping it would leave none at all. */
  private readySources(sources: readonly DictionarySourceId[]): readonly DictionarySourceId[] {
    const ready = sources.filter((source) => (this.cooldowns.get(source) ?? 0) <= this.now())
    return ready.length > 0 ? ready : sources
  }
}

function hasCode(error: unknown, code: DictionaryProviderError['code']): boolean {
  return error instanceof DictionaryProviderError && error.code === code
}
