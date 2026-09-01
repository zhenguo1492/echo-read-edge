/**
 * Word timing returned by a speech provider. Times are measured in seconds from
 * the start of one synthesized audio chunk. The content player can map these
 * boundaries to the retained single-color reading highlight without exposing
 * provider-specific tick units to page-facing modules.
 */
export interface WordBoundary {
  word: string
  startTime: number
  endTime: number
}

/**
 * Framework-independent input for synthesizing one bounded text chunk.
 * Long-text splitting and queue prefetching belong to the reader controller;
 * providers deliberately synthesize only one chunk per request.
 */
export interface SpeechSynthesisRequest {
  text: string
  voice: string
  rate: number
}

/**
 * A transferable synthesis result. Uint8Array works in the service worker,
 * survives structured cloning, and can be converted to a Blob by the content
 * player without a Node.js Buffer dependency.
 */
export interface SpeechSynthesisResult {
  audio: Uint8Array
  contentType: 'audio/mpeg'
  wordBoundaries: WordBoundary[]
}

/**
 * One incremental MP3 payload emitted in the same order that the provider
 * receives it. The offscreen runtime can enqueue these bytes into MediaSource
 * without waiting for the complete synthesis result or exposing transport
 * framing details outside the Provider boundary.
 */
export interface SpeechAudioChunk {
  audio: Uint8Array
  contentType: 'audio/mpeg'
}

/**
 * Synchronous handlers keep transport backpressure separate from browser media
 * buffering. Implementations should copy or transfer any bytes that cannot be
 * consumed during the callback because the Provider may release its frame data
 * immediately after the callback returns.
 */
export interface SpeechSynthesisStreamHandlers {
  onAudioChunk(chunk: SpeechAudioChunk): void
  onWordBoundaries(boundaries: readonly WordBoundary[]): void
}

/**
 * Final metadata returned when Edge signals that one synthesis turn is complete.
 * Audio bytes are deliberately not repeated here: the consumer has already
 * received them incrementally and may have played and discarded earlier frames.
 */
export interface SpeechSynthesisStreamSummary {
  contentType: 'audio/mpeg'
  audioBytes: number
  wordBoundaries: WordBoundary[]
}

/**
 * Stable failure categories let UI code provide useful recovery actions without
 * inspecting transport error strings from the unsupported Edge protocol.
 */
export type TtsProviderErrorCode =
  | 'aborted'
  | 'invalid-request'
  | 'connection-failed'
  | 'protocol-error'
  | 'timeout'
  | 'empty-audio'

/**
 * Typed provider error whose message is safe to present in extension UI. The
 * optional cause remains local diagnostic context and is never serialized into
 * a page-controlled document.
 */
export class TtsProviderError extends Error {
  readonly code: TtsProviderErrorCode

  constructor(code: TtsProviderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TtsProviderError'
    this.code = code
  }
}

/**
 * Transport boundary implemented by the direct Edge Read Aloud provider. The
 * AbortSignal is mandatory so stopping playback also stops in-flight sockets and
 * prevents the queue from submitting work after cancellation.
 */
export interface TtsProvider {
  synthesize(
    request: SpeechSynthesisRequest,
    signal: AbortSignal
  ): Promise<SpeechSynthesisResult>
}

/**
 * Optional higher-capability boundary used by the offscreen MediaSource player.
 * Keeping it separate from TtsProvider preserves the fully buffered fallback for
 * browsers or test environments that cannot append MP3 data incrementally.
 */
export interface StreamingTtsProvider extends TtsProvider {
  synthesizeStream(
    request: SpeechSynthesisRequest,
    handlers: SpeechSynthesisStreamHandlers,
    signal: AbortSignal
  ): Promise<SpeechSynthesisStreamSummary>
}
