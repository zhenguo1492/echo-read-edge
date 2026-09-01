import { describe, expect, it, vi } from 'vitest'

import type { EdgeVoiceCatalogCache } from '@/storage'
import { CachedEdgeVoiceCatalog } from './cached-edge-voice-catalog'

const VOICES = [
  { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Female' as const }
]

describe('CachedEdgeVoiceCatalog', () => {
  it('uses a fresh cache without a network request', async () => {
    const provider = { list: vi.fn() }
    const repository = {
      get: vi.fn().mockResolvedValue({ fetchedAt: 900, voices: VOICES }),
      set: vi.fn()
    }
    const catalog = new CachedEdgeVoiceCatalog(
      provider as never,
      repository,
      { now: () => 1000, maxAgeMs: 200 }
    )

    await expect(catalog.list()).resolves.toEqual({
      ok: true,
      voices: VOICES,
      source: 'cache'
    })
    expect(provider.list).not.toHaveBeenCalled()
  })

  it('refreshes stale data and persists the normalized result', async () => {
    const provider = { list: vi.fn().mockResolvedValue(VOICES) }
    const repository = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn()
    }
    const catalog = new CachedEdgeVoiceCatalog(
      provider as never,
      repository,
      { now: () => 1000 }
    )

    await expect(catalog.list()).resolves.toMatchObject({
      voices: VOICES,
      source: 'network'
    })
    expect(repository.set).toHaveBeenCalledWith({ fetchedAt: 1000, voices: VOICES })
  })

  it('falls back to stale cache when refresh fails', async () => {
    const stale: EdgeVoiceCatalogCache = { fetchedAt: 1, voices: VOICES }
    const catalog = new CachedEdgeVoiceCatalog(
      { list: vi.fn().mockRejectedValue(new Error('offline')) } as never,
      { get: vi.fn().mockResolvedValue(stale), set: vi.fn() },
      { now: () => 1000, maxAgeMs: 10 }
    )

    await expect(catalog.list()).resolves.toEqual({
      ok: true,
      voices: VOICES,
      source: 'cache'
    })
  })
})
