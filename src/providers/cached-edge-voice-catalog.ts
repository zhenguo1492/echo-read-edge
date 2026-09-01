import { EDGE_VOICE_LANGUAGES } from '@/lib/edge-voices'
import type { EdgeVoiceListResponse, EdgeVoiceRecord } from '@/shared/messages'
import type { EdgeVoiceCatalogRepository } from '@/storage/edge-voice-catalog-repository'
import type { EdgeVoiceListProvider } from './edge-voice-list-provider'

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface CachedEdgeVoiceCatalogOptions {
  maxAgeMs?: number
  now?: () => number
}

/** Uses fresh cache first, refreshes stale data, and always retains a local fallback. */
export class CachedEdgeVoiceCatalog {
  private readonly maxAgeMs: number
  private readonly now: () => number

  constructor(
    private readonly provider: EdgeVoiceListProvider,
    private readonly repository: EdgeVoiceCatalogRepository,
    options: CachedEdgeVoiceCatalogOptions = {}
  ) {
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    this.now = options.now ?? Date.now
  }

  async list(): Promise<EdgeVoiceListResponse> {
    const cached = await this.repository.get()
    const now = this.now()
    if (cached && now - cached.fetchedAt <= this.maxAgeMs) {
      return { ok: true, voices: cached.voices, source: 'cache' }
    }

    try {
      const voices = await this.provider.list()
      await this.repository.set({ fetchedAt: now, voices })
      return { ok: true, voices, source: 'network' }
    } catch {
      if (cached) return { ok: true, voices: cached.voices, source: 'cache' }
      return { ok: true, voices: createFallbackVoices(), source: 'fallback' }
    }
  }
}

function createFallbackVoices(): EdgeVoiceRecord[] {
  return EDGE_VOICE_LANGUAGES.flatMap((language) => language.voices.map((voice) => ({
    id: voice.id,
    name: voice.name.replace(/ \(.+\)$/u, ''),
    locale: voice.id.split('-').slice(0, 2).join('-'),
    gender: 'Unknown' as const
  })))
}
