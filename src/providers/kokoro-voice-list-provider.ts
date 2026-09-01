import { toKokoroVoiceRecord } from '@/lib/kokoro-voices'
import { DEFAULT_KOKORO_BASE_URL, normalizeKokoroBaseUrl } from '@/lib/tts-engines'
import { resolveFetch } from './global-fetch'
import type { VoiceRecord } from '@/shared/messages'

const VOICE_LIST_PATH = '/v1/audio/voices'
const DEFAULT_TIMEOUT_MS = 5_000

export interface KokoroVoiceListProviderOptions {
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * Separates the two ways a configured address fails, because they ask the
 * reader for different repairs: `unreachable` means nothing answered and the
 * server is probably not running, while `incompatible` means something did
 * answer but not with a Kokoro voice catalog, so the address points elsewhere.
 */
export type KokoroVoiceListFailure = 'unreachable' | 'incompatible'

export class KokoroVoiceListError extends Error {
  constructor(readonly reason: KokoroVoiceListFailure, message: string) {
    super(message)
    this.name = 'KokoroVoiceListError'
  }
}

/**
 * Reads the voices installed on the reader's own Kokoro server. The timeout is
 * short because the server is local: a slow answer means it is not running, and
 * the popup should fall back rather than block on it.
 */
export class KokoroVoiceListProvider {
  private readonly baseUrl: string
  private readonly fetchImplementation: typeof fetch
  private readonly timeoutMs: number

  constructor(options: KokoroVoiceListProviderOptions = {}) {
    const baseUrl = normalizeKokoroBaseUrl(options.baseUrl ?? DEFAULT_KOKORO_BASE_URL)
    if (!baseUrl) {
      throw new TypeError('The Kokoro server address must be an HTTP or HTTPS origin.')
    }

    this.baseUrl = baseUrl
    this.fetchImplementation = resolveFetch(options.fetch)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async list(signal?: AbortSignal): Promise<VoiceRecord[]> {
    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      let response: Response
      try {
        response = await this.fetchImplementation(`${this.baseUrl}${VOICE_LIST_PATH}`, {
          method: 'GET',
          signal: controller.signal,
          credentials: 'omit'
        })
      } catch (error) {
        // A caller that cancelled deliberately is not reporting a broken host.
        if (signal?.aborted) throw error
        throw new KokoroVoiceListError(
          'unreachable',
          `No Kokoro server answered at ${this.baseUrl}.`
        )
      }

      if (!response.ok) {
        throw new KokoroVoiceListError(
          'incompatible',
          `The Kokoro voice list returned HTTP ${response.status}.`
        )
      }

      const voices = normalizeVoices(await readJsonPayload(response))
      if (voices.length === 0) {
        throw new KokoroVoiceListError(
          'incompatible',
          'The Kokoro voice list returned invalid data.'
        )
      }
      return voices
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }
}

/**
 * An address that points at some other server answers with HTML or with JSON of
 * a different shape, so a body that cannot be parsed is treated the same as one
 * carrying no voices rather than escaping as a raw SyntaxError.
 */
async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/** Accepts both the object catalog and the legacy list of bare identifiers. */
function normalizeVoices(payload: unknown): VoiceRecord[] {
  if (typeof payload !== 'object' || payload === null) return []

  const entries = (payload as { voices?: unknown }).voices
  if (!Array.isArray(entries)) return []

  return entries
    .map(readVoiceId)
    .filter((voiceId): voiceId is string => voiceId !== null)
    .map(toKokoroVoiceRecord)
    .filter((voice): voice is VoiceRecord => voice !== null)
    .sort((left, right) => left.locale.localeCompare(right.locale)
      || left.name.localeCompare(right.name))
}

function readVoiceId(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (typeof entry !== 'object' || entry === null) return null

  const id = (entry as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}
