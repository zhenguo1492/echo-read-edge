import type { EdgeVoiceRecord } from '@/shared/messages'
import { resolveFetch } from './global-fetch'
import { EDGE_TRUSTED_CLIENT_TOKEN } from './edge-tts-provider'

const VOICE_LIST_ENDPOINT =
  'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list'
const DEFAULT_TIMEOUT_MS = 10_000
const EDGE_VOICE_ID_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]+){2,5}Neural$/u

interface EdgeVoiceListPayload {
  ShortName?: unknown
  Locale?: unknown
  Gender?: unknown
}

export interface EdgeVoiceListProviderOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

/** Fetches the current public Edge Read Aloud catalog from one fixed endpoint. */
export class EdgeVoiceListProvider {
  private readonly fetchImplementation: typeof fetch
  private readonly timeoutMs: number

  constructor(options: EdgeVoiceListProviderOptions = {}) {
    this.fetchImplementation = resolveFetch(options.fetch)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async list(signal?: AbortSignal): Promise<EdgeVoiceRecord[]> {
    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const url = new URL(VOICE_LIST_ENDPOINT)
      url.searchParams.set('trustedclienttoken', EDGE_TRUSTED_CLIENT_TOKEN)
      const response = await this.fetchImplementation(url, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'omit'
      })
      if (!response.ok) throw new Error(`Edge voice list returned HTTP ${response.status}.`)

      const payload: unknown = await response.json()
      if (!Array.isArray(payload)) throw new Error('Edge voice list returned invalid data.')

      const voices = payload
        .map(normalizeVoice)
        .filter((voice): voice is EdgeVoiceRecord => voice !== null)
        .sort((left, right) => left.locale.localeCompare(right.locale)
          || left.name.localeCompare(right.name))
      if (voices.length === 0) throw new Error('Edge voice list returned no usable voices.')
      return voices
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }
}

function normalizeVoice(value: unknown): EdgeVoiceRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as EdgeVoiceListPayload
  if (
    typeof item.ShortName !== 'string'
    || !EDGE_VOICE_ID_PATTERN.test(item.ShortName)
    || typeof item.Locale !== 'string'
    || !/^[a-z]{2,3}(?:-[A-Za-z0-9]+){1,3}$/u.test(item.Locale)
  ) {
    return null
  }

  const name = item.ShortName.slice(item.Locale.length + 1).replace(/Neural$/u, '')
  if (!name || name.length > 80) return null
  return {
    id: item.ShortName,
    name,
    locale: item.Locale,
    gender: item.Gender === 'Female' || item.Gender === 'Male'
      ? item.Gender
      : 'Unknown'
  }
}
