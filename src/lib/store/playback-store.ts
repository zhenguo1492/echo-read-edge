import { computed, signal } from '@preact/signals'

import type { PlayState, SentencePosition, WordTimestamp } from '@/types'
import type {
  SerializedWordBoundary,
  TtsPlaybackState,
  TtsRuntimeError,
  TtsRuntimeEvent
} from '@/shared/messages'

export type SentencePlaybackStatus =
  | 'waiting'
  | 'synthesizing'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'played'
  | 'stopped'
  | 'failed'
  | 'evicted'

/**
 * Retained reader state from the legacy playback store. Audio objects are
 * intentionally absent because the offscreen document is now the sole owner of
 * synthesis buffers, MediaSource, and HTMLAudioElement lifecycle.
 */
export const playState = signal<PlayState>('idle')
export const sentences = signal<SentencePosition[]>([])
export const currentIndex = signal(0)
export const activePlaybackId = signal<string | null>(null)
export const wordTimestamps = signal<WordTimestamp[]>([])
export const sentenceWordTimestamps = signal<Record<number, WordTimestamp[]>>({})
export const sentenceStatuses = signal<SentencePlaybackStatus[]>([])
export const currentWordIndex = signal(-1)
export const errorMessage = signal<string | null>(null)

/**
 * Whether a queue is waiting for the speech runtime to answer its start request.
 * The first sentence is synthesized before any playback ID exists, so without
 * this marker a control cannot tell "the engine was asked" apart from "there is
 * nothing to play" and would look inert for the whole wait.
 */
export const isStartingPlayback = signal(false)

export const isPlaying = computed(() => playState.value === 'playing')
export const isPaused = computed(() => playState.value === 'paused')
export const isIdle = computed(() => playState.value === 'idle')

export const currentSentence = computed(() => {
  return sentences.value[currentIndex.value] ?? null
})

export const progress = computed(() => {
  const total = sentences.value.length
  return total === 0 ? 0 : ((currentIndex.value + 1) / total) * 100
})

/**
 * Replaces the reader queue with a defensive array copy and invalidates any
 * previous playback session. A late runtime event from the prior selection can
 * therefore never append timestamps to the new sentence list.
 */
export function setSentences(nextSentences: readonly SentencePosition[]): void {
  sentences.value = [...nextSentences]
  currentIndex.value = 0
  sentenceStatuses.value = nextSentences.map(() => 'waiting')
  sentenceWordTimestamps.value = {}
  clearActiveSession()
}

/**
 * Registers the trusted playback ID returned by background and stores boundaries
 * that arrived before streaming audio began. Later batches use the same ID gate.
 */
export function beginPlayback(
  playbackId: string,
  initialBoundaries: readonly SerializedWordBoundary[] = [],
  sentenceIndex = currentIndex.value
): void {
  activePlaybackId.value = playbackId
  isStartingPlayback.value = false
  adoptSentenceIndex(sentenceIndex)
  const boundaries = initialBoundaries.map(copyBoundary)
  sentenceWordTimestamps.value = {
    ...sentenceWordTimestamps.value,
    [currentIndex.value]: boundaries
  }
  wordTimestamps.value = boundaries
  currentWordIndex.value = -1
  errorMessage.value = null
  playState.value = 'playing'
  setSentenceStatus(currentIndex.value, 'playing')
}

/** Moves the local cursor without destroying the stable offscreen session ID. */
export function nextSentence(): boolean {
  if (currentIndex.value >= sentences.value.length - 1) return false

  adoptSentenceIndex(currentIndex.value + 1)
  return true
}

/** Moves the local cursor without destroying the stable offscreen session ID. */
export function previousSentence(): boolean {
  if (currentIndex.value <= 0) return false

  adoptSentenceIndex(currentIndex.value - 1)
  return true
}

/**
 * Applies only events belonging to the current offscreen session. This check is
 * required because runtime messages are broadcast and a stopped WebSocket may
 * already have queued metadata in another extension process.
 */
export function applyTtsRuntimeEvent(event: TtsRuntimeEvent): boolean {
  if (!activePlaybackId.value || event.playbackId !== activePlaybackId.value) {
    return false
  }

  if (event.action === 'tts:boundaries') {
    // Stop and final completion retain the navigable session ID, but any
    // already-queued metadata from the abandoned media operation is stale.
    if (playState.value === 'idle') return false

    const sentenceIndex = event.sentenceIndex ?? currentIndex.value
    if (!isValidSentenceIndex(sentenceIndex)) return false

    const existing = sentenceWordTimestamps.value[sentenceIndex] ?? []
    const boundaries = [
      ...existing,
      ...event.wordBoundaries.map(copyBoundary)
    ]
    sentenceWordTimestamps.value = {
      ...sentenceWordTimestamps.value,
      [sentenceIndex]: boundaries
    }
    if (sentenceIndex === currentIndex.value) wordTimestamps.value = boundaries
    return true
  }

  if (event.action === 'tts:word') {
    if (
      event.sentenceIndex !== currentIndex.value ||
      event.wordIndex >= wordTimestamps.value.length ||
      playState.value !== 'playing'
    ) {
      return false
    }
    setCurrentWordIndex(event.wordIndex)
    return true
  }

  const sentenceIndex = event.sentenceIndex ?? currentIndex.value
  if (!isValidSentenceIndex(sentenceIndex)) return false
  if (sentenceIndex !== currentIndex.value) {
    const previousIndex = currentIndex.value
    const previousStatus = sentenceStatuses.value[previousIndex]
    if (
      previousStatus === 'synthesizing' ||
      previousStatus === 'playing' ||
      previousStatus === 'paused'
    ) {
      setSentenceStatus(previousIndex, 'played')
    }
    adoptSentenceIndex(sentenceIndex)
  }

  playState.value = toPlayState(event.state)
  if (event.error) {
    errorMessage.value = event.error.message
    setSentenceStatus(sentenceIndex, 'failed')
  } else {
    setSentenceStatus(sentenceIndex, toSentenceStatus(event.state))
  }

  if (event.state === 'stopped' || event.state === 'ended') {
    currentWordIndex.value = -1
  }
  return true
}

/** Updates the highlighted word without allowing an invalid array position. */
export function setCurrentWordIndex(index: number): void {
  currentWordIndex.value =
    index >= -1 && index < wordTimestamps.value.length ? index : -1
}

/** Marks the wait between asking the speech runtime and it answering. */
export function setPlaybackStarting(starting: boolean): void {
  isStartingPlayback.value = starting
}

/** Records a page-safe runtime error independently of the current play state. */
export function setPlaybackError(error: TtsRuntimeError | string | null): void {
  errorMessage.value = typeof error === 'string' ? error : (error?.message ?? null)
}

export function clearPlaybackError(): void {
  errorMessage.value = null
}

/**
 * Resets queue and playback state while retaining the last error, matching the
 * legacy controller behavior that keeps failures visible until the next attempt.
 */
export function resetPlayback(): void {
  sentences.value = []
  currentIndex.value = 0
  sentenceStatuses.value = []
  sentenceWordTimestamps.value = {}
  clearActiveSession()
}

/** Explicitly forgets a disposed session while retaining the sentence queue. */
export function clearActivePlaybackSession(): void {
  clearActiveSession()
}

function clearActiveSession(): void {
  playState.value = 'idle'
  activePlaybackId.value = null
  isStartingPlayback.value = false
  wordTimestamps.value = []
  currentWordIndex.value = -1
}

function adoptSentenceIndex(sentenceIndex: number): void {
  if (!isValidSentenceIndex(sentenceIndex)) return
  currentIndex.value = sentenceIndex
  wordTimestamps.value = sentenceWordTimestamps.value[sentenceIndex] ?? []
  currentWordIndex.value = -1
}

function isValidSentenceIndex(sentenceIndex: number): boolean {
  return (
    Number.isInteger(sentenceIndex) &&
    sentenceIndex >= 0 &&
    (sentences.value.length === 0
      ? sentenceIndex === 0
      : sentenceIndex < sentences.value.length)
  )
}

function setSentenceStatus(
  sentenceIndex: number,
  status: SentencePlaybackStatus
): void {
  if (sentenceIndex < 0 || sentenceIndex >= sentenceStatuses.value.length) return
  const nextStatuses = [...sentenceStatuses.value]
  nextStatuses[sentenceIndex] = status
  sentenceStatuses.value = nextStatuses
}

function copyBoundary(boundary: SerializedWordBoundary): WordTimestamp {
  return {
    word: boundary.word,
    startTime: boundary.startTime,
    endTime: boundary.endTime
  }
}

function toPlayState(state: TtsPlaybackState): PlayState {
  if (state === 'paused') return 'paused'
  if (state === 'stopped' || state === 'ended') return 'idle'
  return 'playing'
}

function toSentenceStatus(state: TtsPlaybackState): SentencePlaybackStatus {
  if (state === 'synthesizing') return 'synthesizing'
  if (state === 'playing') return 'playing'
  if (state === 'paused') return 'paused'
  if (state === 'ended') return 'played'
  return 'stopped'
}
