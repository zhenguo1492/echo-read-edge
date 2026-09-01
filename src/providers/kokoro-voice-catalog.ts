import { KOKORO_FALLBACK_VOICES } from '@/lib/kokoro-voices'
import type { VoiceListResponse } from '@/shared/messages'
import { KokoroVoiceListProvider } from './kokoro-voice-list-provider'

export interface KokoroVoiceCatalogOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * Lists the voices of one Kokoro host without a persistent cache. The server is
 * local and answers in milliseconds, so a stale on-disk catalog would only hide
 * voices the reader just installed. An unreachable server falls back to the
 * shipped list, which keeps the settings UI usable before the container starts.
 */
export class KokoroVoiceCatalog {
  constructor(
    private readonly baseUrl: string,
    private readonly options: KokoroVoiceCatalogOptions = {}
  ) {}

  async list(): Promise<VoiceListResponse> {
    try {
      const provider = new KokoroVoiceListProvider({
        baseUrl: this.baseUrl,
        ...this.options
      })
      return { ok: true, voices: await provider.list(), source: 'network' }
    } catch {
      return { ok: true, voices: [...KOKORO_FALLBACK_VOICES], source: 'fallback' }
    }
  }
}
