import { describe, expect, it } from 'vitest'

import {
  ChromeLocalEdgeVoiceCatalogRepository,
  EDGE_VOICE_CATALOG_CACHE_KEY
} from './edge-voice-catalog-repository'

class MemoryCatalogStorage {
  constructor(private readonly values: Record<string, unknown> = {}) {}

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.values[key] }
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items)
  }
}

describe('ChromeLocalEdgeVoiceCatalogRepository', () => {
  it('round-trips a normalized cache record', async () => {
    const storage = new MemoryCatalogStorage()
    const repository = new ChromeLocalEdgeVoiceCatalogRepository(storage)
    const cache = {
      fetchedAt: 123,
      voices: [
        { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' as const }
      ]
    }

    await repository.set(cache)

    await expect(repository.get()).resolves.toEqual(cache)
  })

  it('rejects malformed cached values', async () => {
    const repository = new ChromeLocalEdgeVoiceCatalogRepository(
      new MemoryCatalogStorage({
        [EDGE_VOICE_CATALOG_CACHE_KEY]: {
          version: 1,
          fetchedAt: 123,
          voices: [{ id: 'bad' }]
        }
      })
    )

    await expect(repository.get()).resolves.toBeNull()
  })
})
