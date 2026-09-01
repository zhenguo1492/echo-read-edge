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
 * These protocol values come from the verified direct-connection PoC under the
 * legacy repository. Edge Read Aloud is an unsupported protocol, so keeping all
 * volatile values in this provider prevents protocol changes from leaking into
 * the reader controller or UI.
 */
export const EDGE_TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const EDGE_PROTOCOL_VERSION = '1-143.0.3650.75'
const WEBSOCKET_ENDPOINT =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'
const TICKS_PER_SECOND = 10_000_000
const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600
const GEC_TIME_BUCKET_SECONDS = 300
const MESSAGE_DELIMITER = '\r\n\r\n'
const AUDIO_MARKER = new TextEncoder().encode('Path:audio\r\n')
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TEXT_LENGTH = 2_000
const MIN_RATE = 0.25
const MAX_RATE = 4
const VOICE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]+){2,5}Neural$/u

export interface EdgeTtsProviderOptions {
  timeoutMs?: number
}

interface ParsedProtocolMessage {
  isTurnEnd: boolean
  wordBoundaries: WordBoundary[]
}

/**
 * Implements the framework-independent TtsProvider contract with a direct Edge
 * Read Aloud WebSocket. The rest of the extension sees only typed requests,
 * MP3 bytes, word boundaries, and stable provider errors.
 */
export class EdgeTtsProvider implements StreamingTtsProvider {
  private readonly timeoutMs: number

  constructor(options: EdgeTtsProviderOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TtsProviderError(
        'invalid-request',
        'The Edge TTS timeout must be a positive number.'
      )
    }
    this.timeoutMs = timeoutMs
  }

  /**
   * Synthesizes exactly one reader-controller chunk. Cancellation closes the
   * active socket, which is important because an MV3 service worker can otherwise
   * continue receiving data after the user has stopped playback.
   */
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
          // The stream summary already returns the complete boundary list, so
          // buffered callers do not need to duplicate incremental metadata.
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
   * Emits each parsed MP3 payload and WordBoundary batch directly from the Edge
   * WebSocket message handler. The returned Promise represents turn completion,
   * while consumers may begin buffering or playback before that Promise settles.
   */
  async synthesizeStream(
    request: SpeechSynthesisRequest,
    handlers: SpeechSynthesisStreamHandlers,
    signal: AbortSignal
  ): Promise<SpeechSynthesisStreamSummary> {
    validateRequest(request)
    if (signal.aborted) throw createAbortError()

    const requestId = randomHex(16)
    const socketUrl = await createWebSocketUrl()
    if (signal.aborted) throw createAbortError()

    return new Promise<SpeechSynthesisStreamSummary>((resolve, reject) => {
      const socket = new WebSocket(socketUrl)
      socket.binaryType = 'arraybuffer'

      const wordBoundaries: WordBoundary[] = []
      let audioBytes = 0
      let settled = false

      const timeout = setTimeout(() => {
        fail(
          new TtsProviderError(
            'timeout',
            'Edge TTS did not finish before the synthesis timeout.'
          )
        )
      }, this.timeoutMs)

      const cleanup = (): void => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', handleAbort)
      }

      const closeSocket = (): void => {
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
          socket.close(1000, 'Request finished')
        }
      }

      const succeed = (): void => {
        if (settled) return
        settled = true
        cleanup()
        closeSocket()

        if (audioBytes === 0) {
          reject(
            new TtsProviderError(
              'empty-audio',
              'Edge TTS completed without returning audio data.'
            )
          )
          return
        }

        resolve({
          contentType: 'audio/mpeg',
          audioBytes,
          wordBoundaries
        })
      }

      function fail(error: TtsProviderError): void {
        if (settled) return
        settled = true
        cleanup()
        closeSocket()
        reject(error)
      }

      function handleAbort(): void {
        fail(createAbortError())
      }

      signal.addEventListener('abort', handleAbort, { once: true })

      socket.addEventListener('open', () => {
        try {
          socket.send(buildSpeechConfig())
          socket.send(buildSsmlRequest(request, requestId))
        } catch (error) {
          fail(
            new TtsProviderError(
              'protocol-error',
              'Edge TTS could not send the synthesis request.',
              { cause: error }
            )
          )
        }
      })

      socket.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (typeof event.data === 'string') {
          try {
            const parsed = parseProtocolMessage(event.data, requestId)
            if (parsed.wordBoundaries.length > 0) {
              wordBoundaries.push(...parsed.wordBoundaries)
              handlers.onWordBoundaries(parsed.wordBoundaries)
            }
            if (parsed.isTurnEnd) succeed()
          } catch (error) {
            fail(
              new TtsProviderError(
                'protocol-error',
                'Edge TTS returned malformed synthesis metadata.',
                { cause: error }
              )
            )
          }
          return
        }

        if (!(event.data instanceof ArrayBuffer)) {
          fail(
            new TtsProviderError(
              'protocol-error',
              'Edge TTS returned an unsupported binary message.'
            )
          )
          return
        }

        const audio = parseAudioMessage(new Uint8Array(event.data))
        if (!audio?.byteLength) return

        try {
          audioBytes += audio.byteLength
          handlers.onAudioChunk({ audio, contentType: 'audio/mpeg' })
        } catch (error) {
          fail(
            new TtsProviderError(
              'protocol-error',
              'The streaming audio consumer could not accept Edge TTS data.',
              { cause: error }
            )
          )
        }
      })

      socket.addEventListener('error', () => {
        fail(
          new TtsProviderError(
            'connection-failed',
            'Edge TTS is currently unavailable. Please try again.'
          )
        )
      })

      socket.addEventListener('close', (event: CloseEvent) => {
        if (settled) return
        fail(
          new TtsProviderError(
            'connection-failed',
            `Edge TTS closed before synthesis completed (code ${event.code}).`
          )
        )
      })
    })
  }
}

/**
 * Validates all page-derived request fields before opening a network connection.
 * Text chunking should normally keep requests well below this defensive limit.
 */
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
  if (!VOICE_PATTERN.test(request.voice)) {
    throw new TtsProviderError('invalid-request', 'The selected Edge voice is invalid.')
  }
  if (!Number.isFinite(request.rate) || request.rate < MIN_RATE || request.rate > MAX_RATE) {
    throw new TtsProviderError(
      'invalid-request',
      `Speech rate must be between ${MIN_RATE} and ${MAX_RATE}.`
    )
  }
}

/**
 * Edge derives Sec-MS-GEC from five-minute Windows-epoch buckets plus its public
 * trusted-client token. No account credential or user secret is involved.
 */
async function generateSecMsGec(): Promise<string> {
  const windowsSeconds = Math.floor(Date.now() / 1000) + WINDOWS_EPOCH_OFFSET_SECONDS
  const bucketSeconds = windowsSeconds - (windowsSeconds % GEC_TIME_BUCKET_SECONDS)
  const windowsTicks = bucketSeconds * TICKS_PER_SECOND
  const input = new TextEncoder().encode(`${windowsTicks}${EDGE_TRUSTED_CLIENT_TOKEN}`)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return bytesToHex(new Uint8Array(digest)).toUpperCase()
}

async function createWebSocketUrl(): Promise<string> {
  const parameters = new URLSearchParams({
    TrustedClientToken: EDGE_TRUSTED_CLIENT_TOKEN,
    'Sec-MS-GEC': await generateSecMsGec(),
    'Sec-MS-GEC-Version': EDGE_PROTOCOL_VERSION,
    ConnectionId: crypto.randomUUID()
  })
  return `${WEBSOCKET_ENDPOINT}?${parameters.toString()}`
}

/**
 * Enables only the metadata retained by the current product: word boundaries
 * for the single-color reading highlight. Pronunciation scoring metadata is not
 * requested and does not enter the provider contract.
 */
function buildSpeechConfig(): string {
  const configuration = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: 'false',
            wordBoundaryEnabled: 'true'
          },
          outputFormat: OUTPUT_FORMAT
        }
      }
    }
  }

  return `Content-Type:application/json; charset=utf-8\r\nPath:speech.config${MESSAGE_DELIMITER}${JSON.stringify(configuration)}`
}

function buildSsmlRequest(request: SpeechSynthesisRequest, requestId: string): string {
  const locale = request.voice.match(/^[a-z]{2,3}-[A-Z]{2}/)?.[0] ?? 'en-US'
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">` +
    `<voice name="${escapeXml(request.voice)}">` +
    `<prosody pitch="+0Hz" rate="${request.rate}" volume="100">` +
    `${escapeXml(request.text.trim())}</prosody></voice></speak>`

  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `Path:ssml${MESSAGE_DELIMITER}${ssml}`
  )
}

/**
 * Parses text protocol frames and converts Edge's 100-nanosecond ticks to the
 * provider contract's seconds. Unrelated protocol frames are safely ignored.
 */
function parseProtocolMessage(message: string, requestId: string): ParsedProtocolMessage {
  const delimiterIndex = message.indexOf(MESSAGE_DELIMITER)
  const headers = delimiterIndex >= 0 ? message.slice(0, delimiterIndex) : message
  const body = delimiterIndex >= 0 ? message.slice(delimiterIndex + MESSAGE_DELIMITER.length) : ''
  const messageRequestId = headers.match(/X-RequestId:([^\r\n]+)/)?.[1]
  const isMatchingRequest = !messageRequestId || messageRequestId === requestId
  const wordBoundaries: WordBoundary[] = []

  if (headers.includes('Path:audio.metadata') && body) {
    const payload = JSON.parse(body) as {
      Metadata?: Array<{
        Type?: unknown
        Data?: {
          Offset?: unknown
          Duration?: unknown
          text?: { Text?: unknown }
        }
      }>
    }

    for (const item of payload.Metadata ?? []) {
      if (item.Type !== 'WordBoundary') continue

      const offset = Number(item.Data?.Offset)
      const duration = Number(item.Data?.Duration)
      const word = item.Data?.text?.Text
      if (!Number.isFinite(offset) || !Number.isFinite(duration) || typeof word !== 'string') {
        continue
      }

      wordBoundaries.push({
        word,
        startTime: offset / TICKS_PER_SECOND,
        endTime: (offset + duration) / TICKS_PER_SECOND
      })
    }
  }

  return {
    isTurnEnd: headers.includes('Path:turn.end') && isMatchingRequest,
    wordBoundaries
  }
}

/**
 * Binary Edge frames contain protocol headers followed by raw MP3 bytes. The
 * verified PoC locates the narrowly defined audio marker instead of depending on
 * undocumented header-length details that have changed between implementations.
 */
function parseAudioMessage(message: Uint8Array): Uint8Array | null {
  const markerIndex = indexOfBytes(message, AUDIO_MARKER)
  if (markerIndex < 0) return null
  return message.slice(markerIndex + AUDIO_MARKER.length)
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer
    }
    return index
  }
  return -1
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

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return bytesToHex(bytes)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function createAbortError(): TtsProviderError {
  return new TtsProviderError('aborted', 'Speech synthesis was stopped.')
}
