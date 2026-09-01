import type { SpeechVoiceSettings, SentencePosition } from '@/types'
import {
  isTtsRuntimeEvent,
  type TtsCommandResponse,
  type TtsQueueStartRequest,
  type TtsControlRequest,
  type TtsRuntimeEvent
} from '@/shared/messages'
import {
  activePlaybackId,
  applyTtsRuntimeEvent,
  beginPlayback,
  clearActivePlaybackSession,
  currentIndex,
  sentences,
  setPlaybackError,
  setPlaybackStarting,
  setSentences
} from '@/lib/store/playback-store'

let runtimeListener: ((message: unknown) => void) | null = null
let startRequestVersion = 0
let pendingStartVersion: number | null = null
let retainedSettings: SpeechVoiceSettings | null = null

/**
 * Runtime metadata can arrive between offscreen starting audio and background
 * delivering the tts:start response. These small queues retain only events seen
 * while this controller has a pending start, then discard all unrelated IDs.
 */
const earlyEvents = new Map<string, TtsRuntimeEvent[]>()

/** Registers the single runtime listener used by the retained content player. */
export function initializeTtsPlayer(): void {
  if (runtimeListener) return

  runtimeListener = (message: unknown): void => {
    if (!isTtsRuntimeEvent(message)) return
    handleRuntimeEvent(message)
  }
  chrome.runtime.onMessage.addListener(runtimeListener)
}

/** Removes the listener for tests or content-script teardown during development. */
export function disposeTtsPlayer(): void {
  if (!runtimeListener) return

  chrome.runtime.onMessage.removeListener(runtimeListener)
  runtimeListener = null
  pendingStartVersion = null
  earlyEvents.clear()
  startRequestVersion += 1
  setPlaybackStarting(false)
}

/**
 * Sends the complete ordered queue once. The offscreen PlaybackSession owns all
 * automatic sentence promotion and look-ahead synthesis after this request.
 *
 * The voice arrives already resolved. Nothing here inspects the text: a detector
 * that reads one selected phrase cannot tell a foreign term from a foreign
 * sentence, so the language question is asked of the whole page instead, and its
 * answer reaches this queue as the caller's chosen voice.
 */
export async function readSentences(
  sentenceList: readonly SentencePosition[],
  settings: SpeechVoiceSettings,
  startIndex = 0
): Promise<boolean> {
  const readableSentences = sentenceList
    .filter((sentence) => sentence.text.trim())
    .map((sentence) => ({ ...sentence, text: sentence.text.trim() }))

  // A queue without readable text can never start, so the retained session keeps
  // its sentences and settings instead of being cleared by the attempt.
  if (readableSentences.length === 0) return false

  setSentences(readableSentences)
  retainedSettings = { ...settings }

  return await startQueuePlayback(readableSentences, retainedSettings, startIndex)
}

/**
 * Starts a new offscreen queue without replacing the retained content records.
 * Recovery uses this path so sentence DOM Ranges and per-sentence metadata remain
 * aligned while Chrome assigns a replacement playback ID to the same queue.
 */
async function startQueuePlayback(
  sentenceList: readonly SentencePosition[],
  settings: SpeechVoiceSettings,
  startIndex: number
): Promise<boolean> {
  if (
    sentenceList.length === 0 ||
    !Number.isInteger(startIndex) ||
    startIndex < 0 ||
    startIndex >= sentenceList.length
  ) {
    return false
  }

  const requestVersion = ++startRequestVersion
  pendingStartVersion = null
  earlyEvents.clear()

  pendingStartVersion = requestVersion
  setPlaybackError(null)
  setPlaybackStarting(true)

  const request: TtsQueueStartRequest = {
    action: 'tts:start-queue',
    sentences: sentenceList.map((sentence) => sentence.text),
    voice: settings.voice,
    rate: settings.speed,
    ...(startIndex === 0 ? {} : { startIndex })
  }

  try {
    const response = await chrome.runtime.sendMessage<
      TtsQueueStartRequest,
      TtsCommandResponse
    >(request)

    // A newer request owns the start marker, so only the current one clears it.
    if (requestVersion !== startRequestVersion) {
      if (response.ok) void discardPlayback(response.playbackId)
      return false
    }

    pendingStartVersion = null
    if (!response.ok) {
      earlyEvents.clear()
      setPlaybackStarting(false)
      setPlaybackError(response.error)
      return false
    }

    beginPlayback(
      response.playbackId,
      response.wordBoundaries,
      response.sentenceIndex ?? 0
    )
    const queuedEvents = earlyEvents.get(response.playbackId) ?? []
    earlyEvents.clear()
    for (const event of queuedEvents) handleRuntimeEvent(event)
    return true
  } catch (error) {
    if (requestVersion !== startRequestVersion) return false

    pendingStartVersion = null
    earlyEvents.clear()
    setPlaybackStarting(false)
    setPlaybackError(
      error instanceof Error ? error.message : 'The speech runtime did not respond.'
    )
    return false
  }
}

export function pauseReading(): Promise<boolean> {
  return controlActivePlayback('tts:pause')
}

export function resumeReading(): Promise<boolean> {
  return controlActivePlayback('tts:resume')
}

/**
 * Stops current media and unfinished prefetch while retaining the queue and all
 * complete cache entries. A pending start is invalidated and disposed when its
 * late response identifies the session.
 */
export async function stopReading(): Promise<boolean> {
  const playbackId = activePlaybackId.value
  if (playbackId) {
    return sendControlRequest({ action: 'tts:stop', playbackId })
  }

  if (pendingStartVersion === null) return false
  pendingStartVersion = null
  earlyEvents.clear()
  startRequestVersion += 1
  setPlaybackStarting(false)
  return true
}

export function playPreviousSentence(): Promise<boolean> {
  return controlActivePlayback('tts:previous')
}

export function playNextSentence(): Promise<boolean> {
  return controlActivePlayback('tts:next')
}

export function playSentence(sentenceIndex: number): Promise<boolean> {
  const playbackId = activePlaybackId.value
  if (!playbackId || !Number.isInteger(sentenceIndex) || sentenceIndex < 0) {
    return Promise.resolve(false)
  }
  return sendControlRequest({
    action: 'tts:play-sentence',
    playbackId,
    sentenceIndex
  })
}

/**
 * Permanently releases the retained queue and its offscreen audio cache.
 * Local ownership is always cleared so the page can exit a stale session even
 * when Chrome already discarded the offscreen document or service worker state.
 */
export async function disposeReading(): Promise<boolean> {
  const playbackId = activePlaybackId.value
  pendingStartVersion = null
  earlyEvents.clear()
  startRequestVersion += 1
  setPlaybackStarting(false)

  if (!playbackId) return false
  await sendControlRequest({ action: 'tts:dispose', playbackId })
  clearActivePlaybackSession()
  return true
}

async function controlActivePlayback(
  action: 'tts:pause' | 'tts:resume' | 'tts:previous' | 'tts:next'
): Promise<boolean> {
  const playbackId = activePlaybackId.value
  if (!playbackId) return false
  return sendControlRequest({ action, playbackId })
}

/**
 * Teardown asks for a session to stop existing, so a runtime that has already
 * forgotten it answered the request. Reporting that as a control failure paints
 * the transport red for a session the reader deliberately ended.
 */
function isTeardownRequest(request: TtsControlRequest): boolean {
  return request.action === 'tts:dispose'
}

async function sendControlRequest(
  request: TtsControlRequest
): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage<
      TtsControlRequest,
      TtsCommandResponse
    >(request)
    if (!response.ok) {
      const recovered = await recoverPlaybackControl(request, response.error.code)
      if (recovered !== null) return recovered
      if (isTeardownRequest(request)) return true
      setPlaybackError(response.error)
      return false
    }

    applyTtsRuntimeEvent({
      action: 'tts:state',
      playbackId: response.playbackId,
      state: response.state,
      ...(response.sentenceIndex === undefined
        ? {}
        : { sentenceIndex: response.sentenceIndex })
    })
    return true
  } catch (error) {
    const recovered = await recoverPlaybackControl(request, 'runtime-unavailable')
    if (recovered !== null) return recovered
    if (isTeardownRequest(request)) return true
    setPlaybackError(
      error instanceof Error ? error.message : 'The speech runtime did not respond.'
    )
    return false
  }
}

/**
 * Recreates a queue when Chrome discarded its idle AUDIO_PLAYBACK document or
 * the service worker restarted and forgot the old playback ownership map. The
 * requested control is folded into the replacement queue's start index, so the
 * user never hears sentence zero before the intended sentence is activated.
 */
async function recoverPlaybackControl(
  request: TtsControlRequest,
  errorCode: 'runtime-unavailable' | 'invalid-request' | string
): Promise<boolean | null> {
  if (errorCode !== 'runtime-unavailable' && errorCode !== 'invalid-request') {
    return null
  }

  const settings = retainedSettings
  const sentenceList = sentences.value
  if (!settings || sentenceList.length === 0) return null

  let startIndex: number
  switch (request.action) {
    case 'tts:resume':
      startIndex = currentIndex.value
      break
    case 'tts:previous':
      startIndex = currentIndex.value - 1
      break
    case 'tts:next':
      startIndex = currentIndex.value + 1
      break
    case 'tts:play-sentence':
      startIndex = request.sentenceIndex
      break
    case 'tts:pause':
    case 'tts:stop':
    case 'tts:dispose':
      return null
  }

  if (startIndex < 0 || startIndex >= sentenceList.length) return null
  return await startQueuePlayback(sentenceList, settings, startIndex)
}

/** Applies active events; offscreen alone advances the retained sentence queue. */
function handleRuntimeEvent(event: TtsRuntimeEvent): void {
  if (!applyTtsRuntimeEvent(event)) {
    if (pendingStartVersion === null) return

    const queued = earlyEvents.get(event.playbackId) ?? []
    // A defensive cap prevents an unrelated extension playback from retaining
    // unbounded metadata while this content request is waiting for its response.
    if (queued.length < 256) queued.push(event)
    earlyEvents.set(event.playbackId, queued)
  }
}

/** Disposes a superseded session without mutating the new queue's visible state. */
async function discardPlayback(playbackId: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage<TtsControlRequest, TtsCommandResponse>({
      action: 'tts:dispose',
      playbackId
    })
  } catch {
    // Background may already have disposed this session while replacing it.
  }
}
