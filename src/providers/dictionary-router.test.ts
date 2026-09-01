import { describe, expect, it, vi } from 'vitest'

import type { DetailedDictionaryEntry } from '@/types'
import { DictionaryRouter } from './dictionary-router'
import { DictionaryProviderError } from './dictionary-provider'

describe('DictionaryRouter', () => {
  it('answers from the first source and names it', async () => {
    const free = lookupOf(createEntry('read'))
    const wiktionary = lookupOf(createEntry('read'))
    const router = new DictionaryRouter({ 'free-dictionary': free, wiktionary })

    await expect(router.lookup('read', ['free-dictionary', 'wiktionary'])).resolves.toEqual({
      entry: createEntry('read'),
      source: 'free-dictionary'
    })
    expect(wiktionary.lookup).not.toHaveBeenCalled()
  })

  it('moves to the next source when the first one is unreachable', async () => {
    const free = failingWith(new DictionaryProviderError('unavailable', 'down'))
    const wiktionary = lookupOf(createEntry('interesting'))
    const router = new DictionaryRouter({ 'free-dictionary': free, wiktionary })

    await expect(router.lookup('interesting', ['free-dictionary', 'wiktionary']))
      .resolves.toMatchObject({ source: 'wiktionary' })
  })

  it('abandons a source that outlives its own budget', async () => {
    vi.useFakeTimers()
    try {
      const free = {
        lookup: vi.fn((_word: string, signal: AbortSignal) =>
          new Promise<DetailedDictionaryEntry>((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DictionaryProviderError('unavailable', 'aborted')))
          }))
      }
      const wiktionary = lookupOf(createEntry('interesting'))
      const router = new DictionaryRouter(
        { 'free-dictionary': free, wiktionary },
        { attemptTimeoutMs: 6_000 }
      )

      const result = router.lookup('interesting', ['free-dictionary', 'wiktionary'])
      await vi.advanceTimersByTimeAsync(6_000)

      await expect(result).resolves.toMatchObject({ source: 'wiktionary' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the miss rather than the outage when a reachable source denies the word', async () => {
    const free = failingWith(new DictionaryProviderError('unavailable', 'down'))
    const wiktionary = failingWith(new DictionaryProviderError('not-found', 'No entry.'))
    const router = new DictionaryRouter({ 'free-dictionary': free, wiktionary })

    await expect(router.lookup('zzzz', ['free-dictionary', 'wiktionary']))
      .rejects.toMatchObject({ code: 'not-found' })
  })

  it('rejects an invalid word without troubling any further source', async () => {
    const free = failingWith(new DictionaryProviderError('invalid-word', 'Enter one word.'))
    const wiktionary = lookupOf(createEntry('read'))
    const router = new DictionaryRouter({ 'free-dictionary': free, wiktionary })

    await expect(router.lookup('../read', ['free-dictionary', 'wiktionary']))
      .rejects.toMatchObject({ code: 'invalid-word' })
    expect(wiktionary.lookup).not.toHaveBeenCalled()
  })

  it('stops retrying an unreachable source until its cooldown expires', async () => {
    const free = failingWith(new DictionaryProviderError('unavailable', 'down'))
    const wiktionary = lookupOf(createEntry('read'))
    let clock = 0
    const router = new DictionaryRouter(
      { 'free-dictionary': free, wiktionary },
      { cooldownMs: 300_000, now: () => clock }
    )

    await router.lookup('read', ['free-dictionary', 'wiktionary'])
    await router.lookup('write', ['free-dictionary', 'wiktionary'])
    expect(free.lookup).toHaveBeenCalledOnce()

    clock = 300_001
    await router.lookup('speak', ['free-dictionary', 'wiktionary'])
    expect(free.lookup).toHaveBeenCalledTimes(2)
  })

  it('still tries a cooling source when it is the only one the reader can read', async () => {
    const youdao = {
      lookup: vi.fn()
        .mockRejectedValueOnce(new DictionaryProviderError('unavailable', 'down'))
        .mockResolvedValueOnce(createEntry('read'))
    }
    const router = new DictionaryRouter({ youdao }, { cooldownMs: 300_000, now: () => 0 })

    await expect(router.lookup('read', ['youdao'])).rejects.toMatchObject({ code: 'unavailable' })
    await expect(router.lookup('read', ['youdao'])).resolves.toMatchObject({ source: 'youdao' })
  })
})

function lookupOf(entry: DetailedDictionaryEntry) {
  return { lookup: vi.fn(async () => entry) }
}

function failingWith(error: DictionaryProviderError) {
  return { lookup: vi.fn(async () => { throw error }) }
}

function createEntry(word: string): DetailedDictionaryEntry {
  return {
    word,
    examTypes: [],
    meanings: [{ partOfSpeech: 'verb', definition: 'To interpret text.' }],
    examples: [],
    phrases: [],
    synonyms: [],
    discriminate: [],
    collins: []
  }
}
