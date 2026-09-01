import type { DictionarySourceId } from '@/lib/dictionary-sources'
import {
  normalizeKokoroBaseUrl,
  isTtsEngineId,
  type TtsEngineId
} from '@/lib/tts-engines'
import type { DetailedDictionaryEntry } from '@/types'

/**
 * The shell message proves that the MV3 service worker can receive and validate
 * extension-owned requests before feature-specific message contracts are added.
 */
export interface ShellPingRequest {
  action: 'shell:ping'
}

export interface ShellPingResponse {
  ok: true
  version: string
}

/**
 * Requests the catalog of the currently selected engine from the background.
 * The popup never chooses the engine host itself, so the same request serves the
 * self-hosted Kokoro catalog and the Edge Read Aloud catalog.
 */
export interface VoiceListRequest {
  action: 'voices:list'
}

/**
 * One selectable voice normalized across engines. Kokoro voice identifiers are
 * short slugs and Edge identifiers are SSML short names, so the locale is
 * derived by the engine-specific catalog rather than parsed from the ID here.
 */
export interface VoiceRecord {
  id: string
  name: string
  locale: string
  gender: 'Female' | 'Male' | 'Unknown'
}

export type VoiceListResponse =
  | {
      ok: true
      voices: VoiceRecord[]
      source: 'network' | 'cache' | 'fallback'
    }
  | { ok: false; error: string }

/**
 * Asks the background to probe the Kokoro server the reader has configured. The
 * request carries no address: the popup saves the field before checking it, so
 * the probe reports on exactly the host a later reading would use and no sender
 * can point the extension's fetch at a host of its own choosing.
 */
export interface KokoroHealthRequest {
  action: 'kokoro:health'
}

/**
 * `ok` means the address served a usable voice catalog, `unreachable` that
 * nothing answered there, and `incompatible` that something answered without
 * being a Kokoro server. The settings icon shows the last two the same way,
 * because the reader's next step is to correct the address either way; the
 * distinction lives in the message.
 */
export type KokoroHealthStatus = 'ok' | 'unreachable' | 'incompatible'

export interface KokoroHealthResponse {
  status: KokoroHealthStatus
  baseUrl: string
  message: string
}

/** Historical names retained for the Edge-only call sites. */
export type EdgeVoiceListRequest = VoiceListRequest
export type EdgeVoiceRecord = VoiceRecord
export type EdgeVoiceListResponse = VoiceListResponse

/** Page-facing translation requests cannot choose a network endpoint. */
export interface TranslateRequest {
  action: 'translate:text'
  text: string
  sourceLanguage: string
  targetLanguage: string
}

export type TranslateResponse =
  | {
      ok: true
      translation: string
      detectedLanguage: string
    }
  | {
      ok: false
      error: string
    }

/** Dictionary lookup accepts one normalized English word, never an arbitrary URL. */
export interface DictionaryLookupRequest {
  action: 'dictionary:lookup'
  word: string
}

export type DictionaryLookupResponse =
  | {
      ok: true
      entry: DetailedDictionaryEntry
      /** Identifies which dictionary source answered, for attribution in the UI. */
      source: DictionarySourceId
      cached?: boolean
    }
  | { ok: false; code: 'invalid-word' | 'not-found' | 'unavailable'; error: string }

/**
 * Saves one looked-up word with the sentence it was read in. No dictionary data
 * crosses this boundary: definitions stay in the dictionary cache and are looked
 * up again when the reader opens the word. The content script never opens the
 * database itself; the service worker owns the transaction.
 */
export interface VocabularySaveRequest {
  action: 'vocabulary:save'
  word: string
  context?: string
  sourceUrl?: string
  sourceTitle?: string
}

/** A reader unsaves the word they are looking at, never an arbitrary record ID. */
export interface VocabularyRemoveRequest {
  action: 'vocabulary:remove'
  word: string
}

export interface VocabularyStatusRequest {
  action: 'vocabulary:status'
  word: string
}

export type VocabularyRequest =
  | VocabularySaveRequest
  | VocabularyRemoveRequest
  | VocabularyStatusRequest

/** One shape for all three requests because each reports the same saved state. */
export type VocabularyResponse =
  | {
      ok: true
      saved: boolean
      savedAt?: string
    }
  | { ok: false; error: string }

/**
 * Starts one bounded text chunk. The caller supplies only synthesis values; the
 * service worker chooses the trusted runtime target and never accepts a URL from
 * a content script or popup.
 */
export interface TtsStartRequest {
  action: 'tts:start'
  text: string
  voice: string
  rate: number
}

/**
 * Starts one ordered reading session while preserving sentence boundaries.
 * The hidden runtime streams the first sentence and keeps a bounded prefetch
 * window warm instead of making the content script start each sentence after
 * receiving the previous sentence's ended event.
 */
export interface TtsQueueStartRequest {
  action: 'tts:start-queue'
  sentences: string[]
  voice: string
  rate: number
  /**
   * Selects the first sentence activated by a newly created queue. Normal starts
   * omit this field and begin at zero; recovery starts preserve the content-side
   * cursor after Chrome has discarded an idle offscreen document.
   */
  startIndex?: number
}

/** Playback controls apply to one stable, service-worker-issued session ID. */
export interface TtsPauseRequest {
  action: 'tts:pause'
  playbackId: string
}

export interface TtsResumeRequest {
  action: 'tts:resume'
  playbackId: string
}

export interface TtsStopRequest {
  action: 'tts:stop'
  playbackId: string
}

export interface TtsPreviousRequest {
  action: 'tts:previous'
  playbackId: string
}

export interface TtsNextRequest {
  action: 'tts:next'
  playbackId: string
}

/** Selects any sentence in the retained queue without creating a new session. */
export interface TtsPlaySentenceRequest {
  action: 'tts:play-sentence'
  playbackId: string
  sentenceIndex: number
}

/** Permanently releases the queue, cached audio, and all in-flight work. */
export interface TtsDisposeRequest {
  action: 'tts:dispose'
  playbackId: string
}

export type TtsControlRequest =
  | TtsPauseRequest
  | TtsResumeRequest
  | TtsStopRequest
  | TtsPreviousRequest
  | TtsNextRequest
  | TtsPlaySentenceRequest
  | TtsDisposeRequest
export type TtsRequest = TtsStartRequest | TtsQueueStartRequest | TtsControlRequest

/**
 * Engine selection resolved by the service worker from stored settings. Network
 * configuration is private to this extension-owned message.
 */
export interface OffscreenTtsEngineTarget {
  engine: TtsEngineId
  kokoroBaseUrl: string
}

/**
 * Internal start message emitted only by the service worker after it validates
 * the public request and ensures the hidden extension document exists.
 */
export interface OffscreenTtsStartRequest
  extends Omit<TtsStartRequest, 'action'>, OffscreenTtsEngineTarget {
  target: 'offscreen'
  action: 'offscreen:tts:start'
  playbackId: string
}

/** Internal form of one validated sentence queue owned by a single playback ID. */
export interface OffscreenTtsQueueStartRequest
  extends Omit<TtsQueueStartRequest, 'action'>, OffscreenTtsEngineTarget {
  target: 'offscreen'
  action: 'offscreen:tts:start-queue'
  playbackId: string
}

/** Internal controls that do not require another validated payload field. */
export interface OffscreenTtsBasicControlRequest {
  target: 'offscreen'
  action:
    | 'offscreen:tts:pause'
    | 'offscreen:tts:resume'
    | 'offscreen:tts:stop'
    | 'offscreen:tts:previous'
    | 'offscreen:tts:next'
    | 'offscreen:tts:dispose'
  playbackId: string
}

/** Internal targeted navigation retains the public queue index after routing. */
export interface OffscreenTtsPlaySentenceRequest {
  target: 'offscreen'
  action: 'offscreen:tts:play-sentence'
  playbackId: string
  sentenceIndex: number
}

export type OffscreenTtsControlRequest =
  | OffscreenTtsBasicControlRequest
  | OffscreenTtsPlaySentenceRequest

export type OffscreenTtsRequest =
  | OffscreenTtsStartRequest
  | OffscreenTtsQueueStartRequest
  | OffscreenTtsControlRequest

/** Provider-neutral timing values that are safe to send through runtime messaging. */
export interface SerializedWordBoundary {
  word: string
  startTime: number
  endTime: number
}

/**
 * Stopped and ended sessions retain their sentence queue and completed cache.
 * They remain addressable for navigation until an explicit dispose or a new
 * primary session destroys them.
 */
export type TtsPlaybackState =
  | 'synthesizing'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'ended'

export type TtsRuntimeErrorCode =
  | 'aborted'
  | 'invalid-message'
  | 'invalid-request'
  | 'connection-failed'
  | 'protocol-error'
  | 'timeout'
  | 'empty-audio'
  | 'playback-failed'
  | 'runtime-unavailable'

export interface TtsRuntimeError {
  code: TtsRuntimeErrorCode
  message: string
}

export type TtsCommandResponse =
  | {
      ok: true
      playbackId: string
      state: TtsPlaybackState
      sentenceIndex?: number
      wordBoundaries?: SerializedWordBoundary[]
    }
  | {
      ok: false
      error: TtsRuntimeError
    }

/**
 * Playback events keep page-facing controls synchronized without giving the
 * offscreen document direct access to the host page or its DOM.
 */
export interface TtsPlaybackEvent {
  action: 'tts:state'
  playbackId: string
  state: TtsPlaybackState
  sentenceIndex?: number
  currentTime?: number
  error?: TtsRuntimeError
}

/**
 * Carries each newly received Edge metadata batch while the matching MP3 stream
 * is still downloading and playing. Consumers append these ordered boundaries
 * instead of waiting for the early tts:start response to contain the final list.
 */
export interface TtsWordBoundariesEvent {
  action: 'tts:boundaries'
  playbackId: string
  sentenceIndex?: number
  wordBoundaries: SerializedWordBoundary[]
}

/**
 * Announces only active-word changes instead of broadcasting high-frequency
 * audio currentTime updates. The content script maps this sentence-local index
 * to the corresponding WordBoundary and non-destructive DOM Range.
 */
export interface TtsActiveWordEvent {
  action: 'tts:word'
  playbackId: string
  sentenceIndex: number
  wordIndex: number
}

/** Events emitted by the hidden audio runtime for page-facing playback state. */
export type TtsRuntimeEvent =
  | TtsPlaybackEvent
  | TtsWordBoundariesEvent
  | TtsActiveWordEvent

/**
 * Rejects null values, arrays, page-controlled primitives, and unknown actions.
 * Feature routers will extend this allowlist instead of accepting arbitrary URLs.
 */
export function isShellPingRequest(value: unknown): value is ShellPingRequest {
  return isRecord(value) && value.action === 'shell:ping'
}

export function isVoiceListRequest(value: unknown): value is VoiceListRequest {
  return isRecord(value) && value.action === 'voices:list'
}

export function isKokoroHealthRequest(value: unknown): value is KokoroHealthRequest {
  return isRecord(value) && value.action === 'kokoro:health'
}

/**
 * The popup shows whatever the background reports, so a malformed answer must
 * not reach the indicator as an unlabelled state.
 */
export function isKokoroHealthResponse(value: unknown): value is KokoroHealthResponse {
  return (
    isRecord(value) &&
    (value.status === 'ok'
      || value.status === 'unreachable'
      || value.status === 'incompatible') &&
    typeof value.baseUrl === 'string' &&
    typeof value.message === 'string'
  )
}

/** Limits public translation input and validates only language-code fields. */
export function isTranslateRequest(value: unknown): value is TranslateRequest {
  return (
    isRecord(value) &&
    value.action === 'translate:text' &&
    isBoundedString(value.text, 1, 5000) &&
    isLanguageCode(value.sourceLanguage, true) &&
    isLanguageCode(value.targetLanguage, false) &&
    value.sourceLanguage !== value.targetLanguage
  )
}

/** Keeps malformed words from ever reaching the fixed Dictionary Provider. */
export function isDictionaryLookupRequest(
  value: unknown
): value is DictionaryLookupRequest {
  return (
    isRecord(value) &&
    value.action === 'dictionary:lookup' &&
    isDictionaryWord(value.word)
  )
}

/**
 * Bounds every vocabulary field at the trust boundary so one page cannot send a
 * huge payload into the database. The repository then clamps what it stores to
 * the documented per-record limits.
 */
export function isVocabularyRequest(value: unknown): value is VocabularyRequest {
  if (!isRecord(value) || !isDictionaryWord(value.word)) return false

  if (value.action === 'vocabulary:remove' || value.action === 'vocabulary:status') {
    return true
  }

  return (
    value.action === 'vocabulary:save' &&
    isOptionalBoundedString(value.context, 2000) &&
    isOptionalBoundedString(value.sourceTitle, 500) &&
    isOptionalPageUrl(value.sourceUrl)
  )
}

/** Validates page-facing TTS commands before the service worker routes them. */
export function isTtsRequest(value: unknown): value is TtsRequest {
  if (!isRecord(value)) return false

  if (value.action === 'tts:start') {
    return isSynthesisFields(value)
  }

  if (value.action === 'tts:start-queue') {
    return isQueueSynthesisFields(value)
  }

  if (value.action === 'tts:play-sentence') {
    return (
      isNonEmptyString(value.playbackId) &&
      isNonNegativeInteger(value.sentenceIndex)
    )
  }

  return (
    (value.action === 'tts:pause' ||
      value.action === 'tts:resume' ||
      value.action === 'tts:stop' ||
      value.action === 'tts:previous' ||
      value.action === 'tts:next' ||
      value.action === 'tts:dispose') &&
    isNonEmptyString(value.playbackId)
  )
}

/**
 * Validates the private service-worker-to-offscreen protocol independently of
 * TypeScript because runtime messages cross process and document boundaries.
 */
export function isOffscreenTtsRequest(value: unknown): value is OffscreenTtsRequest {
  if (!isRecord(value) || value.target !== 'offscreen') return false

  // Only the internal message carries a resolved engine: the public request is
  // written by the popup and content script, which must not choose a host.
  if (value.action === 'offscreen:tts:start') {
    return isNonEmptyString(value.playbackId)
      && isSynthesisFields(value)
      && isEngineTarget(value)
  }

  if (value.action === 'offscreen:tts:start-queue') {
    return isNonEmptyString(value.playbackId)
      && isQueueSynthesisFields(value)
      && isEngineTarget(value)
  }

  if (value.action === 'offscreen:tts:play-sentence') {
    return (
      isNonEmptyString(value.playbackId) &&
      isNonNegativeInteger(value.sentenceIndex)
    )
  }

  return (
    (value.action === 'offscreen:tts:pause' ||
      value.action === 'offscreen:tts:resume' ||
      value.action === 'offscreen:tts:stop' ||
      value.action === 'offscreen:tts:previous' ||
      value.action === 'offscreen:tts:next' ||
      value.action === 'offscreen:tts:dispose') &&
    isNonEmptyString(value.playbackId)
  )
}

/**
 * Validates events after the service worker has independently authenticated the
 * offscreen sender URL. Queue timing is meaningful only when its sentence index
 * is a non-negative integer.
 */
export function isTtsRuntimeEvent(value: unknown): value is TtsRuntimeEvent {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.playbackId) ||
    !isOptionalSentenceIndex(value.sentenceIndex)
  ) {
    return false
  }

  if (value.action === 'tts:boundaries') {
    return (
      Array.isArray(value.wordBoundaries) &&
      value.wordBoundaries.every(isSerializedWordBoundary)
    )
  }

  if (value.action === 'tts:word') {
    return (
      isNonNegativeInteger(value.sentenceIndex) &&
      isNonNegativeInteger(value.wordIndex)
    )
  }

  if (value.action !== 'tts:state' || !isTtsPlaybackState(value.state)) {
    return false
  }

  return (
    (value.currentTime === undefined || isNonNegativeFiniteNumber(value.currentTime)) &&
    (value.error === undefined || isTtsRuntimeError(value.error))
  )
}

function isSynthesisFields(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.text) &&
    isVoiceAndRate(value)
  )
}

/**
 * Network values are re-validated where the offscreen document turns them into
 * a fetch request. Only extension-owned messages can reach this check.
 */
function isEngineTarget(value: Record<string, unknown>): boolean {
  return (
    isTtsEngineId(value.engine) &&
    typeof value.kokoroBaseUrl === 'string' &&
    normalizeKokoroBaseUrl(value.kokoroBaseUrl) === value.kokoroBaseUrl
  )
}

function isQueueSynthesisFields(value: Record<string, unknown>): boolean {
  if (
    !Array.isArray(value.sentences) ||
    value.sentences.length === 0 ||
    !value.sentences.every(isNonEmptyString) ||
    !isVoiceAndRate(value)
  ) {
    return false
  }

  // The upper bound is checked at the trust boundary instead of leaving an
  // invalid recovery cursor for the hidden runtime to clamp or reinterpret.
  return (
    value.startIndex === undefined ||
    (isNonNegativeInteger(value.startIndex) &&
      value.startIndex < value.sentences.length)
  )
}

function isVoiceAndRate(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.voice) &&
    typeof value.rate === 'number' &&
    Number.isFinite(value.rate)
  )
}

function isOptionalSentenceIndex(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isSerializedWordBoundary(value: unknown): value is SerializedWordBoundary {
  return (
    isRecord(value) &&
    typeof value.word === 'string' &&
    isNonNegativeFiniteNumber(value.startTime) &&
    isNonNegativeFiniteNumber(value.endTime) &&
    value.endTime >= value.startTime
  )
}

function isTtsPlaybackState(value: unknown): value is TtsPlaybackState {
  return (
    value === 'synthesizing' ||
    value === 'playing' ||
    value === 'paused' ||
    value === 'stopped' ||
    value === 'ended'
  )
}

function isTtsRuntimeError(value: unknown): value is TtsRuntimeError {
  return (
    isRecord(value) &&
    isTtsRuntimeErrorCode(value.code) &&
    isNonEmptyString(value.message)
  )
}

function isTtsRuntimeErrorCode(value: unknown): value is TtsRuntimeErrorCode {
  return (
    value === 'aborted' ||
    value === 'invalid-message' ||
    value === 'invalid-request' ||
    value === 'connection-failed' ||
    value === 'protocol-error' ||
    value === 'timeout' ||
    value === 'empty-audio' ||
    value === 'playback-failed' ||
    value === 'runtime-unavailable'
  )
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Source pages are recorded only for the web origins the extension reads. */
function isOptionalPageUrl(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length <= 2000 &&
      /^https?:\/\//u.test(value))
  )
}

function isOptionalBoundedString(value: unknown, maximum: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maximum)
}

function isDictionaryWord(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z]+(?:['\u2019-][A-Za-z]+)*$/.test(value) &&
    value.length <= 64
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isBoundedString(
  value: unknown,
  minimum: number,
  maximum: number
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= minimum &&
    value.length <= maximum
  )
}

function isLanguageCode(value: unknown, allowAuto: boolean): value is string {
  return (
    (allowAuto && value === 'auto') ||
    (typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
