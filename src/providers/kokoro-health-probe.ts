import { normalizeKokoroBaseUrl } from '@/lib/tts-engines'
import type { KokoroHealthResponse } from '@/shared/messages'
import {
  KokoroVoiceListError,
  KokoroVoiceListProvider
} from './kokoro-voice-list-provider'

export interface KokoroHealthProbeOptions {
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * Shorter than the voice list's own timeout: the settings icon reports on a
 * server the reader runs locally, and a host that has not answered in this long
 * is one they need to look at, not one worth waiting for.
 */
const DEFAULT_TIMEOUT_MS = 4_000

/**
 * Answers whether a configured address can actually serve this reader, in the
 * three states the settings icon distinguishes.
 *
 * The voice list is the route it asks. That one GET proves both halves of the
 * question at once — that something is listening, and that what listens speaks
 * the Kokoro API — without the cost of synthesizing audio the reader never
 * hears. Synthesis itself runs on a different route, so a server that lists
 * voices and then fails to speak is still reported as `ok` here; the reading
 * error surfaces that, and probing it on every keystroke would not be worth
 * the audio it generates.
 */
export class KokoroHealthProbe {
  constructor(
    private readonly baseUrl: string,
    private readonly options: KokoroHealthProbeOptions = {}
  ) {}

  async check(signal?: AbortSignal): Promise<KokoroHealthResponse> {
    const baseUrl = normalizeKokoroBaseUrl(this.baseUrl)
    if (!baseUrl) {
      return {
        status: 'incompatible',
        baseUrl: typeof this.baseUrl === 'string' ? this.baseUrl : '',
        message: 'The Kokoro server address must be an HTTP or HTTPS origin.'
      }
    }

    try {
      const voices = await new KokoroVoiceListProvider({
        baseUrl,
        fetch: this.options.fetch,
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      }).list(signal)

      return {
        status: 'ok',
        baseUrl,
        message: `${baseUrl} answered with ${voices.length} ${
          voices.length === 1 ? 'voice' : 'voices'
        }.`
      }
    } catch (error) {
      if (error instanceof KokoroVoiceListError) {
        return { status: error.reason, baseUrl, message: error.message }
      }

      return {
        status: 'unreachable',
        baseUrl,
        message: error instanceof Error
          ? error.message
          : `No Kokoro server answered at ${baseUrl}.`
      }
    }
  }
}
