import { describe, expect, it, vi } from 'vitest'

import type { DetailedDictionaryEntry } from '@/types'
import type {
  DictionaryCacheRecord,
  DictionaryCacheRepository
} from '@/storage'
import { CachedDictionaryService } from './cached-dictionary-service'
import { DictionaryProviderError } from './dictionary-provider'

class MemoryDictionaryCache implements DictionaryCacheRepository {
  readonly records = new Map<string, DictionaryCacheRecord>()
  readonly get = vi.fn(async (key: string) => this.records.get(key) ?? null)
  readonly put = vi.fn(async (record: DictionaryCacheRecord) => {
    this.records.set(record.cacheKey, record)
  })
  readonly remove = vi.fn(async (key: string) => {
    this.records.delete(key)
  })
}

describe('CachedDictionaryService', () => {
  it('persists a miss and reuses the IndexedDB record on the next lookup', async () => {
    const cache = new MemoryDictionaryCache()
    const provider = {
      name: 'youdao',
      definitionLanguage: 'zh',
      lookup: vi.fn(async (word: string) => createEntry(word))
    }
    const service = new CachedDictionaryService(
      provider,
      cache,
      () => new Date('2026-07-19T00:00:00.000Z')
    )

    await expect(service.lookup('Read', new AbortController().signal))
      .resolves.toMatchObject({ word: 'read' })
    await service.lookup('read', new AbortController().signal)

    expect(provider.lookup).toHaveBeenCalledOnce()
    expect(cache.put).toHaveBeenCalledOnce()
    expect(cache.records.get('youdao:zh:read')?.expiresAt).toBe('2027-07-19T00:00:00.000Z')
  })

  it('deletes an expired entry and deduplicates concurrent refreshes', async () => {
    const cache = new MemoryDictionaryCache()
    cache.records.set('youdao:zh:read', {
      cacheKey: 'youdao:zh:read',
      normalizedWord: 'read',
      provider: 'youdao',
      data: createEntry('stale'),
      createdAt: '2025-01-01T00:00:00.000Z',
      expiresAt: '2025-12-31T00:00:00.000Z'
    })
    let resolveLookup!: (entry: DetailedDictionaryEntry) => void
    const provider = {
      name: 'youdao',
      definitionLanguage: 'zh',
      lookup: vi.fn(() => new Promise<DetailedDictionaryEntry>((resolve) => {
        resolveLookup = resolve
      }))
    }
    const service = new CachedDictionaryService(provider, cache, () => new Date('2026-07-19'))

    const first = service.lookup('read', new AbortController().signal)
    const second = service.lookup('read', new AbortController().signal)
    await vi.waitFor(() => expect(provider.lookup).toHaveBeenCalledOnce())
    resolveLookup(createEntry('read'))

    await expect(Promise.all([first, second])).resolves.toEqual([
      createEntry('read'),
      createEntry('read')
    ])
    expect(cache.remove).toHaveBeenCalledWith('youdao:zh:read')
  })

  it('keeps each source in its own cache namespace', async () => {
    const cache = new MemoryDictionaryCache()
    const provider = {
      name: 'free-dictionary',
      definitionLanguage: 'en',
      lookup: vi.fn(async (word: string) => createEntry(word))
    }
    const service = new CachedDictionaryService(provider, cache)

    await service.lookup('read', new AbortController().signal)

    expect([...cache.records.keys()]).toEqual(['free-dictionary:en:read'])
  })

  it('combines an inflected result with its cached or fetched lemma', async () => {
    const cache = new MemoryDictionaryCache()
    const provider = {
      name: 'youdao',
      definitionLanguage: 'zh',
      lookup: vi.fn(async (word: string) => word === 'reading'
        ? { ...createEntry('reading'), lemma: 'read' }
        : createEntry('read'))
    }
    const service = new CachedDictionaryService(provider, cache)

    await expect(service.lookup('reading', new AbortController().signal)).resolves.toMatchObject({
      word: 'read',
      originalWord: 'reading',
      lemma: 'read',
      isLemmatized: true,
      inflectedData: { word: 'reading' }
    })
    expect(provider.lookup).toHaveBeenCalledTimes(2)
  })

  it('falls back to a derived lemma when the source has no inflected entry', async () => {
    const cache = new MemoryDictionaryCache()
    const provider = {
      name: 'free-dictionary',
      definitionLanguage: 'en',
      lookup: vi.fn(async (word: string) => {
        if (word !== 'billion') {
          throw new DictionaryProviderError('not-found', `No entry was found for “${word}”.`)
        }
        return createEntry('billion')
      })
    }
    const service = new CachedDictionaryService(provider, cache)

    await expect(service.lookup('billions', new AbortController().signal)).resolves.toMatchObject({
      word: 'billion',
      originalWord: 'billions',
      lemma: 'billion',
      isLemmatized: true
    })
    expect(provider.lookup).toHaveBeenCalledWith('billions', expect.anything())
  })

  it('reports the original miss when no derived lemma is defined either', async () => {
    const cache = new MemoryDictionaryCache()
    const provider = {
      name: 'free-dictionary',
      definitionLanguage: 'en',
      lookup: vi.fn(async (word: string) => {
        throw new DictionaryProviderError('not-found', `No entry was found for “${word}”.`)
      })
    }
    const service = new CachedDictionaryService(provider, cache)

    await expect(service.lookup('zzzzs', new AbortController().signal))
      .rejects.toMatchObject({ code: 'not-found', message: 'No entry was found for “zzzzs”.' })
  })

  it('stops the fallback walk when the source itself is unavailable', async () => {
    const cache = new MemoryDictionaryCache()
    const provider = {
      name: 'free-dictionary',
      definitionLanguage: 'en',
      lookup: vi.fn(async (word: string) => {
        if (word === 'billions') {
          throw new DictionaryProviderError('not-found', 'No entry was found.')
        }
        throw new DictionaryProviderError('unavailable', 'The dictionary is currently unavailable.')
      })
    }
    const service = new CachedDictionaryService(provider, cache)

    await expect(service.lookup('billions', new AbortController().signal))
      .rejects.toMatchObject({ code: 'unavailable' })
    expect(provider.lookup).toHaveBeenCalledTimes(2)
  })
})

function createEntry(word: string): DetailedDictionaryEntry {
  return {
    word,
    examTypes: [],
    meanings: [{ partOfSpeech: 'v.', definition: 'To interpret text.' }],
    examples: [],
    phrases: [],
    synonyms: [],
    discriminate: [],
    collins: []
  }
}
