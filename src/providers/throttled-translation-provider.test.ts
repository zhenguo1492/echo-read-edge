import { describe, expect, it, vi } from 'vitest'

import { ThrottledTranslationProvider } from './throttled-translation-provider'
import {
  TranslationProviderError,
  type TranslationProvider,
  type TranslationResult
} from './translation-provider'

const REQUEST = { text: 'Hello.', sourceLanguage: 'auto', targetLanguage: 'zh-CN' }

/** Resolves after every already-queued microtask and timer callback has run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function rateLimited(retryAfterMs?: number): TranslationProviderError {
  return new TranslationProviderError('Translation failed with HTTP 429.', {
    status: 429,
    retryAfterMs
  })
}

function stubProvider(
  translate: TranslationProvider['translate']
): { provider: TranslationProvider; translate: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(translate)
  return { provider: { translate: mock }, translate: mock }
}

function createSubject(
  translate: TranslationProvider['translate'],
  overrides: Partial<ConstructorParameters<typeof ThrottledTranslationProvider>[1]> = {}
) {
  const { provider, translate: spy } = stubProvider(translate)
  const sleeps: number[] = []
  let clock = 0
  const subject = new ThrottledTranslationProvider(provider, {
    concurrency: 2,
    maxRetries: 2,
    baseBackoffMs: 1_000,
    cooldownMs: 60_000,
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms },
    random: () => 0,
    ...overrides
  })
  return { subject, translate: spy, sleeps, advance: (ms: number) => { clock += ms } }
}

const ok = (translation: string): TranslationResult => ({ translation, detectedLanguage: 'en' })

describe('ThrottledTranslationProvider', () => {
  it('never lets more than the configured number of translations reach the network', async () => {
    let running = 0
    let peak = 0
    const release: Array<() => void> = []
    const { subject } = createSubject(async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise<void>((resolve) => release.push(resolve))
      running -= 1
      return ok('你好。')
    })

    const calls = Array.from({ length: 6 }, () =>
      subject.translate(REQUEST, new AbortController().signal))

    await flush()
    expect(peak).toBe(2)

    while (release.length > 0) {
      release.splice(0).forEach((resolve) => resolve())
      await flush()
    }

    await Promise.all(calls)
    expect(peak).toBe(2)
  })

  it('backs off exponentially on a rate limit and returns the retried result', async () => {
    let attempt = 0
    const { subject, sleeps, translate } = createSubject(async () => {
      attempt += 1
      if (attempt < 3) throw rateLimited()
      return ok('你好。')
    })

    await expect(subject.translate(REQUEST, new AbortController().signal))
      .resolves.toEqual(ok('你好。'))
    expect(translate).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([1_000, 2_000])
  })

  it('waits exactly as long as Retry-After asks instead of guessing', async () => {
    let attempt = 0
    const { subject, sleeps } = createSubject(async () => {
      attempt += 1
      if (attempt < 2) throw rateLimited(5_000)
      return ok('你好。')
    })

    await subject.translate(REQUEST, new AbortController().signal)
    expect(sleeps).toEqual([5_000])
  })

  it('stops calling the endpoint for a cooldown once retries are exhausted', async () => {
    const { subject, translate, advance } = createSubject(async () => { throw rateLimited() })

    await expect(subject.translate(REQUEST, new AbortController().signal))
      .rejects.toThrow(/rate limited/i)
    expect(translate).toHaveBeenCalledTimes(3)

    // A reader reopening the panel must not re-flood the endpoint mid-cooldown.
    await expect(subject.translate(REQUEST, new AbortController().signal))
      .rejects.toThrow(/rate limited/i)
    expect(translate).toHaveBeenCalledTimes(3)

    advance(60_000)
    translate.mockResolvedValue(ok('你好。'))
    await expect(subject.translate(REQUEST, new AbortController().signal))
      .resolves.toEqual(ok('你好。'))
    expect(translate).toHaveBeenCalledTimes(4)
  })

  it('surfaces a non-rate-limit failure immediately without retrying', async () => {
    const { subject, translate, sleeps } = createSubject(async () => {
      throw new TranslationProviderError('Translation failed with HTTP 400.', { status: 400 })
    })

    await expect(subject.translate(REQUEST, new AbortController().signal))
      .rejects.toThrow('Translation failed with HTTP 400.')
    expect(translate).toHaveBeenCalledOnce()
    expect(sleeps).toEqual([])
  })

  it('drops a queued translation whose panel closed before a slot freed', async () => {
    const release: Array<() => void> = []
    const { subject, translate } = createSubject(async () => {
      await new Promise<void>((resolve) => release.push(resolve))
      return ok('你好。')
    }, { concurrency: 1 })

    const blocking = subject.translate(REQUEST, new AbortController().signal)
    const cancelled = new AbortController()
    const queued = subject.translate(REQUEST, cancelled.signal)

    await flush()
    cancelled.abort()
    release.splice(0).forEach((resolve) => resolve())

    await expect(queued).rejects.toThrow(/cancel/i)
    release.splice(0).forEach((resolve) => resolve())
    await blocking
    expect(translate).toHaveBeenCalledOnce()
  })

  it('gives each attempt its own deadline so queue waiting cannot time it out', async () => {
    const signals: AbortSignal[] = []
    const { subject } = createSubject(async (_request, signal) => {
      signals.push(signal)
      return ok('你好。')
    })

    const caller = new AbortController()
    await subject.translate(REQUEST, caller.signal)
    expect(signals[0]).not.toBe(caller.signal)
    expect(signals[0].aborted).toBe(false)
  })
})
