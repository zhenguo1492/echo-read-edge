import { describe, expect, it, vi } from 'vitest'

import {
  SentenceAudioCache,
  createSentenceAudioCacheKey,
  createSentenceAudioFingerprint,
  type SentenceAudioData
} from './sentence-audio-cache'

const VOICE = 'en-US-AriaNeural'

function fingerprint(text: string, rate = 1, voice = VOICE) {
  return createSentenceAudioFingerprint({ text, voice, rate })
}

function audio(...chunkSizes: number[]): SentenceAudioData {
  return {
    chunks: chunkSizes.map((size, index) =>
      new Uint8Array(size).fill(index + 1)
    ),
    wordBoundaries: [{ word: 'Test', startTime: 0.1, endTime: 0.4 }]
  }
}

describe('sentence audio fingerprints', () => {
  it('normalizes Provider-facing text and produces a stable SHA-256 key', async () => {
    const normalized = fingerprint('  The same sentence.  ')
    const direct = fingerprint('The same sentence.')

    expect(normalized).toEqual(direct)
    await expect(createSentenceAudioCacheKey(normalized)).resolves.toBe(
      await createSentenceAudioCacheKey(direct)
    )
    expect(await createSentenceAudioCacheKey(normalized)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('isolates voice, rate, output format, Provider, and cache version', async () => {
    const base = fingerprint('Cache isolation.')
    const variants = [
      fingerprint('Cache isolation.', 1.25),
      fingerprint('Cache isolation.', 1, 'en-US-GuyNeural'),
      createSentenceAudioFingerprint({
        text: 'Cache isolation.',
        voice: VOICE,
        rate: 1,
        outputFormat: 'another-mp3-format'
      }),
      createSentenceAudioFingerprint({
        text: 'Cache isolation.',
        voice: VOICE,
        rate: 1,
        provider: 'another-provider'
      }),
      createSentenceAudioFingerprint({
        text: 'Cache isolation.',
        voice: VOICE,
        rate: 1,
        cacheVersion: 'echo-read-edge-tts-cache-v2'
      })
    ]
    const baseKey = await createSentenceAudioCacheKey(base)

    for (const variant of variants) {
      await expect(createSentenceAudioCacheKey(variant)).resolves.not.toBe(baseKey)
    }
  })

  it('rejects empty text, empty voices, and non-finite rates', () => {
    expect(() => fingerprint('   ')).toThrow('text must not be empty')
    expect(() => fingerprint('Sentence.', 1, '   ')).toThrow('voice must not be empty')
    expect(() => fingerprint('Sentence.', Number.NaN)).toThrow('rate must be finite')
  })
})

describe('SentenceAudioCache', () => {
  it('deduplicates concurrent synthesis and reuses complete audio', async () => {
    const cache = new SentenceAudioCache()
    const target = fingerprint('Repeated sentence.')
    const factory = vi.fn(async () => audio(2, 3))

    const [first, second] = await Promise.all([
      cache.getOrCreate(target, factory),
      cache.getOrCreate(target, factory)
    ])
    const third = await cache.getOrCreate(target, factory)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(third).toBe(first)
    expect(cache.size).toBe(1)
    expect(cache.totalBytes).toBe(5)
  })

  it('keeps FIFO insertion order unchanged on cache hits', async () => {
    const cache = new SentenceAudioCache({ maxEntries: 2 })
    const first = fingerprint('First.')
    const second = fingerprint('Second.')
    const third = fingerprint('Third.')

    await cache.getOrCreate(first, async () => audio(1))
    await cache.getOrCreate(second, async () => audio(1))
    await cache.get(first)
    await cache.getOrCreate(third, async () => audio(1))

    await expect(cache.get(first)).resolves.toBeUndefined()
    await expect(cache.get(second)).resolves.toBeDefined()
    await expect(cache.get(third)).resolves.toBeDefined()
    expect(cache.totalBytes).toBe(2)
  })

  it('evicts when either the entry limit or byte limit is exceeded', async () => {
    const entryLimited = new SentenceAudioCache({ maxEntries: 1, maxBytes: 100 })
    const byteLimited = new SentenceAudioCache({ maxEntries: 10, maxBytes: 4 })
    const first = fingerprint('First limit.')
    const second = fingerprint('Second limit.')

    await entryLimited.getOrCreate(first, async () => audio(1))
    await entryLimited.getOrCreate(second, async () => audio(1))
    expect(entryLimited.size).toBe(1)
    expect(entryLimited.totalBytes).toBe(1)

    await byteLimited.getOrCreate(first, async () => audio(3))
    await byteLimited.getOrCreate(second, async () => audio(3))
    await expect(byteLimited.get(first)).resolves.toBeUndefined()
    await expect(byteLimited.get(second)).resolves.toBeDefined()
    expect(byteLimited.size).toBe(1)
    expect(byteLimited.totalBytes).toBe(3)
  })

  it('skips protected entries and completes a bounded eviction pass', async () => {
    const protectedKeys = new Set<string>()
    const cache = new SentenceAudioCache({
      maxEntries: 1,
      isProtected: (cacheKey) => protectedKeys.has(cacheKey)
    })
    const first = fingerprint('Protected.')
    const second = fingerprint('Disposable.')
    const firstEntry = await cache.getOrCreate(first, async () => audio(2))
    protectedKeys.add(firstEntry.cacheKey)

    await cache.getOrCreate(second, async () => audio(3))

    await expect(cache.get(first)).resolves.toBe(firstEntry)
    await expect(cache.get(second)).resolves.toBeUndefined()
    expect(cache.size).toBe(1)
    expect(cache.totalBytes).toBe(2)
  })

  it('verifies the complete fingerprint after a hash hit', async () => {
    const cache = new SentenceAudioCache()
    const original = fingerprint('Original.')
    const entry = await cache.getOrCreate(original, async () => audio(2))
    const collidingFingerprint = {
      ...original,
      text: 'Different text under the same synthetic key.'
    }

    expect(cache.getByKey(entry.cacheKey, collidingFingerprint)).toBeUndefined()
    expect(cache.getByKey(entry.cacheKey, original)).toBe(entry)
  })

  it('copies audio data and maintains totalBytes through deletion and clear', async () => {
    const cache = new SentenceAudioCache()
    const sourceChunk = new Uint8Array([1, 2, 3])
    const target = fingerprint('Owned bytes.')
    const entry = await cache.getOrCreate(target, async () => ({
      chunks: [sourceChunk],
      wordBoundaries: [{ word: 'Owned', startTime: 0, endTime: 0.2 }]
    }))

    sourceChunk[0] = 99
    expect(entry.chunks[0][0]).toBe(1)
    expect(cache.totalBytes).toBe(3)
    expect(cache.delete(entry.cacheKey)).toBe(true)
    expect(cache.totalBytes).toBe(0)

    await cache.getOrCreate(fingerprint('Again.'), async () => audio(4))
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.totalBytes).toBe(0)
  })

  it('does not cache failures and allows a later retry', async () => {
    const cache = new SentenceAudioCache()
    const target = fingerprint('Retry.')
    const factory = vi
      .fn<() => Promise<SentenceAudioData>>()
      .mockRejectedValueOnce(new Error('Temporary synthesis failure.'))
      .mockResolvedValueOnce(audio(2))

    await expect(cache.getOrCreate(target, factory)).rejects.toThrow(
      'Temporary synthesis failure.'
    )
    await expect(cache.getOrCreate(target, factory)).resolves.toBeDefined()
    expect(factory).toHaveBeenCalledTimes(2)
    expect(cache.size).toBe(1)
  })

  it('prevents late synthesis from repopulating a cleared cache', async () => {
    const cache = new SentenceAudioCache()
    let resolveFactory!: (data: SentenceAudioData) => void
    const pendingData = new Promise<SentenceAudioData>((resolve) => {
      resolveFactory = resolve
    })
    const pending = cache.getOrCreate(fingerprint('Late result.'), () => pendingData)

    await vi.waitFor(() => expect(resolveFactory).toBeTypeOf('function'))
    cache.clear()
    resolveFactory(audio(5))

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cache.size).toBe(0)
    expect(cache.totalBytes).toBe(0)
  })
})
