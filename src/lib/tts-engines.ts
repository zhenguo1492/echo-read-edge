/**
 * Selectable speech backends. Kokoro is the default because it runs on a server
 * the reader owns, which keeps synthesis inside the user's own machine instead
 * of depending on an unsupported vendor protocol.
 */
export type TtsEngineId = 'kokoro' | 'edge'

export interface TtsEngineOption {
  id: TtsEngineId
  label: string
  description: string
}

export const TTS_ENGINES: readonly TtsEngineOption[] = [
  {
    id: 'kokoro',
    label: 'Kokoro (self-hosted)',
    description:
      'Synthesizes on a Kokoro FastAPI server you run yourself. Nothing leaves your machine.'
  },
  {
    id: 'edge',
    label: 'Edge Read Aloud',
    description:
      'Uses Microsoft Edge Read Aloud. It needs no setup but relies on an unsupported endpoint.'
  }
]

export const DEFAULT_TTS_ENGINE: TtsEngineId = 'kokoro'

export function isTtsEngineId(value: unknown): value is TtsEngineId {
  return value === 'kokoro' || value === 'edge'
}

/**
 * Accepts only a plain HTTP origin plus optional path prefix so a stored value
 * can never turn into a credentialed URL, a query string, or a non-fetchable
 * scheme when it is concatenated with a Kokoro endpoint path.
 */
export function normalizeKokoroBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 300) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password || url.search || url.hash) return null

  const path = url.pathname.replace(/\/+$/u, '')
  return `${url.origin}${path}`
}

/** Matches the published port of the bundled docker compose service. */
export const DEFAULT_KOKORO_BASE_URL = 'http://localhost:8880'
