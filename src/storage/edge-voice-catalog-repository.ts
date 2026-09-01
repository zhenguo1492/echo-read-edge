import type { EdgeVoiceRecord } from '@/shared/messages'

export const EDGE_VOICE_CATALOG_CACHE_KEY = 'edgeVoiceCatalogCache'
const CACHE_VERSION = 1

interface CatalogStorage {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export interface EdgeVoiceCatalogCache {
  fetchedAt: number
  voices: EdgeVoiceRecord[]
}

export interface EdgeVoiceCatalogRepository {
  get(): Promise<EdgeVoiceCatalogCache | null>
  set(cache: EdgeVoiceCatalogCache): Promise<void>
}

/** Persists only normalized voice fields, not the much larger upstream payload. */
export class ChromeLocalEdgeVoiceCatalogRepository
implements EdgeVoiceCatalogRepository {
  constructor(private readonly storage: CatalogStorage = chrome.storage.local) {}

  async get(): Promise<EdgeVoiceCatalogCache | null> {
    const result = await this.storage.get(EDGE_VOICE_CATALOG_CACHE_KEY)
    return parseCache(result[EDGE_VOICE_CATALOG_CACHE_KEY])
  }

  async set(cache: EdgeVoiceCatalogCache): Promise<void> {
    await this.storage.set({
      [EDGE_VOICE_CATALOG_CACHE_KEY]: {
        version: CACHE_VERSION,
        fetchedAt: cache.fetchedAt,
        voices: cache.voices
      }
    })
  }
}

function parseCache(value: unknown): EdgeVoiceCatalogCache | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (
    record.version !== CACHE_VERSION
    || typeof record.fetchedAt !== 'number'
    || !Number.isFinite(record.fetchedAt)
    || !Array.isArray(record.voices)
  ) {
    return null
  }

  const voices = record.voices.filter(isVoiceRecord)
  return voices.length === record.voices.length && voices.length > 0
    ? { fetchedAt: record.fetchedAt, voices }
    : null
}

function isVoiceRecord(value: unknown): value is EdgeVoiceRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.locale === 'string'
    && (record.gender === 'Female'
      || record.gender === 'Male'
      || record.gender === 'Unknown')
}
