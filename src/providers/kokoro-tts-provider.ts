import { isKokoroVoiceId } from '@/lib/kokoro-voices'
import { DEFAULT_KOKORO_BASE_URL, normalizeKokoroBaseUrl } from '@/lib/tts-engines'
import { resolveFetch } from './global-fetch'
import {
  TtsProviderError,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult,
  type SpeechSynthesisStreamHandlers,
  type SpeechSynthesisStreamSummary,
  type StreamingTtsProvider,
  type WordBoundary
} from './tts-provider'

/**
 * Kokoro FastAPI exposes an OpenAI-shaped `/v1/audio/speech` route that returns
 * audio only. Word-level timings come from the captioned route instead, which
 * streams newline-delimited JSON objects carrying base64 MP3 plus timestamps.
 */
const CAPTIONED_SPEECH_PATH = '/dev/captioned_speech'
const MODEL = 'kokoro'
const RESPONSE_FORMAT = 'mp3'
const CONTENT_TYPE = 'audio/mpeg'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TEXT_LENGTH = 2_000
const MIN_RATE = 0.25
const MAX_RATE = 4

export interface KokoroTtsProviderOptions {
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

interface CaptionedSpeechChunk {
  audio?: unknown
  timestamps?: unknown
}

/**
 * Implements the shared TtsProvider contract against a Kokoro server the reader
 * runs themselves. The host is normalized once in the constructor so no request
 * path can be redirected by a later settings value.
 */
export class KokoroTtsProvider implements StreamingTtsProvider {
  private readonly baseUrl: string
  private readonly fetchImplementation: typeof fetch
  private readonly timeoutMs: number

  constructor(options: KokoroTtsProviderOptions = {}) {
    const baseUrl = normalizeKokoroBaseUrl(options.baseUrl ?? DEFAULT_KOKORO_BASE_URL)
    if (!baseUrl) {
      throw new TtsProviderError(
        'invalid-request',
        'The Kokoro server address must be an HTTP or HTTPS origin.'
      )
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TtsProviderError(
        'invalid-request',
        'The Kokoro timeout must be a positive number.'
      )
    }

    this.baseUrl = baseUrl
    this.fetchImplementation = resolveFetch(options.fetch)
    this.timeoutMs = timeoutMs
  }

  /** Buffers one complete chunk for callers that cannot append audio gradually. */
  async synthesize(
    request: SpeechSynthesisRequest,
    signal: AbortSignal
  ): Promise<SpeechSynthesisResult> {
    const audioChunks: Uint8Array[] = []
    const summary = await this.synthesizeStream(
      request,
      {
        onAudioChunk: ({ audio }) => {
          audioChunks.push(audio)
        },
        onWordBoundaries: () => {
          // The summary already carries the complete boundary list.
        }
      },
      signal
    )

    return {
      audio: concatenateBytes(audioChunks),
      contentType: summary.contentType,
      wordBoundaries: summary.wordBoundaries
    }
  }

  /**
   * Emits each decoded MP3 payload as soon as its NDJSON line arrives. Kokoro
   * encodes one continuous MP3 stream, so the chunks are only playable in the
   * order they are delivered.
   */
  async synthesizeStream(
    request: SpeechSynthesisRequest,
    handlers: SpeechSynthesisStreamHandlers,
    signal: AbortSignal
  ): Promise<SpeechSynthesisStreamSummary> {
    validateRequest(request)
    if (signal.aborted) throw createAbortError()

    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort()
    signal.addEventListener('abort', forwardAbort, { once: true })
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)

    const wordBoundaries: WordBoundary[] = []
    let audioBytes = 0

    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl}${CAPTIONED_SPEECH_PATH}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            input: request.text.trim(),
            voice: request.voice,
            speed: request.rate,
            response_format: RESPONSE_FORMAT,
            stream: true,
            return_timestamps: true
          }),
          credentials: 'omit',
          signal: controller.signal
        }
      )

      if (!response.ok) {
        throw new TtsProviderError(
          'connection-failed',
          `The Kokoro server returned HTTP ${response.status}.`
        )
      }

      for await (const line of readLines(response)) {
        const chunk = parseChunk(line)
        if (!chunk) continue

        const audio = decodeAudio(chunk.audio)
        if (audio && audio.byteLength > 0) {
          audioBytes += audio.byteLength
          handlers.onAudioChunk({ audio, contentType: CONTENT_TYPE })
        }

        const boundaries = toWordBoundaries(chunk.timestamps)
        if (boundaries.length > 0) {
          wordBoundaries.push(...boundaries)
          handlers.onWordBoundaries(boundaries)
        }
      }
    } catch (error) {
      throw toProviderError(error, { aborted: controller.signal.aborted, timedOut })
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', forwardAbort)
    }

    if (audioBytes === 0) {
      throw new TtsProviderError(
        'empty-audio',
        'The Kokoro server completed without returning audio data.'
      )
    }

    return { contentType: CONTENT_TYPE, audioBytes, wordBoundaries }
  }
}

/**
 * Prefers the incremental body so playback can start before synthesis ends, and
 * falls back to the buffered text for environments without a streaming body.
 */
async function* readLines(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    yield* (await response.text()).split('\n')
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        yield buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) yield buffer
  } finally {
    reader.releaseLock()
  }
}

function parseChunk(line: string): CaptionedSpeechChunk | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    throw new TtsProviderError(
      'protocol-error',
      'The Kokoro server returned a malformed synthesis stream.',
      { cause: error }
    )
  }

  return typeof parsed === 'object' && parsed !== null
    ? parsed as CaptionedSpeechChunk
    : null
}

function decodeAudio(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0) return null

  let binary: string
  try {
    binary = atob(value)
  } catch (error) {
    throw new TtsProviderError(
      'protocol-error',
      'The Kokoro server returned audio that could not be decoded.',
      { cause: error }
    )
  }

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** Converts Kokoro's snake_case seconds into the provider-neutral shape. */
function toWordBoundaries(value: unknown): WordBoundary[] {
  if (!Array.isArray(value)) return []

  const boundaries: WordBoundary[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue

    const record = item as Record<string, unknown>
    const startTime = Number(record.start_time)
    const endTime = Number(record.end_time)
    if (
      typeof record.word !== 'string'
      || !Number.isFinite(startTime)
      || !Number.isFinite(endTime)
    ) {
      continue
    }

    boundaries.push({ word: record.word, startTime, endTime })
  }
  return boundaries
}

function toProviderError(
  error: unknown,
  state: { aborted: boolean; timedOut: boolean }
): TtsProviderError {
  if (error instanceof TtsProviderError) return error
  if (state.timedOut) {
    return new TtsProviderError(
      'timeout',
      'Kokoro did not finish before the synthesis timeout.'
    )
  }
  if (state.aborted) return createAbortError()

  return new TtsProviderError(
    'connection-failed',
    'The Kokoro server could not be reached. Check that it is running.',
    { cause: error }
  )
}

function validateRequest(request: SpeechSynthesisRequest): void {
  const text = request.text.trim()
  if (text.length === 0) {
    throw new TtsProviderError('invalid-request', 'Text is required for speech synthesis.')
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new TtsProviderError(
      'invalid-request',
      `A speech synthesis chunk cannot exceed ${MAX_TEXT_LENGTH} characters.`
    )
  }
  if (!isKokoroVoiceId(request.voice)) {
    throw new TtsProviderError('invalid-request', 'The selected Kokoro voice is invalid.')
  }
  if (!Number.isFinite(request.rate) || request.rate < MIN_RATE || request.rate > MAX_RATE) {
    throw new TtsProviderError(
      'invalid-request',
      `Speech rate must be between ${MIN_RATE} and ${MAX_RATE}.`
    )
  }
}

function concatenateBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function createAbortError(): TtsProviderError {
  return new TtsProviderError('aborted', 'Speech synthesis was stopped.')
}
