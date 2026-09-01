import { signal } from '@preact/signals'

import {
  isTtsRuntimeEvent,
  type TtsCommandResponse,
  type TtsControlRequest,
  type TtsRuntimeEvent,
  type TtsStartRequest
} from '@/shared/messages'
import type { SpeechVoiceSettings, WordTimestamp } from '@/types'

export type ExampleSpeechPlayState = 'idle' | 'starting' | 'playing' | 'paused'

export interface ExampleSpeechState {
  sourceId: string | null
  playbackId: string | null
  playState: ExampleSpeechPlayState
  boundaries: WordTimestamp[]
  wordIndex: number
  error: string | null
}

const IDLE_STATE: ExampleSpeechState = {
  sourceId: null,
  playbackId: null,
  playState: 'idle',
  boundaries: [],
  wordIndex: -1,
  error: null
}

export const exampleSpeechState = signal<ExampleSpeechState>(IDLE_STATE)

let runtimeListener: ((message: unknown) => void) | null = null
let operationVersion = 0
let isStarting = false
const earlyEvents = new Map<string, TtsRuntimeEvent[]>()

export function initializeExampleSpeech(): void {
  if (runtimeListener) return
  runtimeListener = (message: unknown): void => {
    if (!isTtsRuntimeEvent(message)) return
    const active = exampleSpeechState.value
    if (active.playbackId === message.playbackId) {
      applyRuntimeEvent(message)
      return
    }
    if (!isStarting) return
    const queued = earlyEvents.get(message.playbackId) ?? []
    if (queued.length < 128) queued.push(message)
    earlyEvents.set(message.playbackId, queued)
  }
  chrome.runtime.onMessage.addListener(runtimeListener)
}

export function destroyExampleSpeech(): void {
  if (runtimeListener) chrome.runtime.onMessage.removeListener(runtimeListener)
  runtimeListener = null
  void disposeActiveExample()
  earlyEvents.clear()
}

/** Preserves the legacy play/pause toggle and stops any other active example. */
export async function toggleExampleSpeech(
  sourceId: string,
  text: string,
  settings: SpeechVoiceSettings
): Promise<boolean> {
  initializeExampleSpeech()
  const active = exampleSpeechState.value
  if (active.sourceId === sourceId && active.playbackId) {
    if (active.playState === 'playing') return control('tts:pause', active.playbackId)
    if (active.playState === 'paused') return control('tts:resume', active.playbackId)
  }
  if (active.sourceId === sourceId && active.playState === 'starting') return false

  await disposeActiveExample()
  const version = ++operationVersion
  isStarting = true
  earlyEvents.clear()
  exampleSpeechState.value = {
    sourceId,
    playbackId: null,
    playState: 'starting',
    boundaries: [],
    wordIndex: -1,
    error: null
  }
  const request: TtsStartRequest = {
    action: 'tts:start',
    text: text.trim(),
    voice: settings.voice,
    rate: settings.speed
  }

  try {
    const response = await chrome.runtime.sendMessage<TtsStartRequest, TtsCommandResponse>(request)
    if (version !== operationVersion) {
      if (response.ok) void disposePlayback(response.playbackId)
      return false
    }
    isStarting = false
    if (!response.ok) {
      earlyEvents.clear()
      exampleSpeechState.value = { ...IDLE_STATE, error: response.error.message }
      return false
    }
    exampleSpeechState.value = {
      sourceId,
      playbackId: response.playbackId,
      playState: response.state === 'paused' ? 'paused' : 'playing',
      boundaries: (response.wordBoundaries ?? []).map(copyBoundary),
      wordIndex: -1,
      error: null
    }
    const queued = earlyEvents.get(response.playbackId) ?? []
    earlyEvents.clear()
    queued.forEach(applyRuntimeEvent)
    return true
  } catch (error) {
    if (version !== operationVersion) return false
    isStarting = false
    earlyEvents.clear()
    exampleSpeechState.value = {
      ...IDLE_STATE,
      error: error instanceof Error ? error.message : 'Example speech is unavailable.'
    }
    return false
  }
}

export async function stopExampleSpeech(sourceId?: string): Promise<void> {
  const active = exampleSpeechState.value
  if (sourceId !== undefined && active.sourceId !== sourceId) return
  await disposeActiveExample()
}

async function control(
  action: 'tts:pause' | 'tts:resume',
  playbackId: string
): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage<TtsControlRequest, TtsCommandResponse>({
      action,
      playbackId
    })
    if (!response.ok || exampleSpeechState.value.playbackId !== playbackId) return false
    exampleSpeechState.value = {
      ...exampleSpeechState.value,
      playState: action === 'tts:pause' ? 'paused' : 'playing'
    }
    return true
  } catch (error) {
    if (exampleSpeechState.value.playbackId === playbackId) {
      exampleSpeechState.value = {
        ...IDLE_STATE,
        error: error instanceof Error ? error.message : 'Example speech is unavailable.'
      }
    }
    return false
  }
}

async function disposeActiveExample(): Promise<void> {
  operationVersion += 1
  isStarting = false
  earlyEvents.clear()
  const playbackId = exampleSpeechState.value.playbackId
  exampleSpeechState.value = IDLE_STATE
  if (playbackId) await disposePlayback(playbackId)
}

async function disposePlayback(playbackId: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage<TtsControlRequest, TtsCommandResponse>({
      action: 'tts:dispose',
      playbackId
    })
  } catch {
    // Background may already have replaced or released this short session.
  }
}

function applyRuntimeEvent(event: TtsRuntimeEvent): void {
  const active = exampleSpeechState.value
  if (active.playbackId !== event.playbackId) return
  if (event.action === 'tts:boundaries') {
    exampleSpeechState.value = {
      ...active,
      boundaries: [...active.boundaries, ...event.wordBoundaries.map(copyBoundary)]
    }
    return
  }
  if (event.action === 'tts:word') {
    exampleSpeechState.value = { ...active, wordIndex: event.wordIndex }
    return
  }
  if (event.state === 'ended' || event.state === 'stopped' || event.error) {
    exampleSpeechState.value = {
      ...IDLE_STATE,
      error: event.error?.message ?? null
    }
    return
  }
  if (event.state === 'paused' || event.state === 'playing') {
    exampleSpeechState.value = {
      ...active,
      playState: event.state,
      wordIndex: event.state === 'playing' ? active.wordIndex : -1
    }
  }
}

function copyBoundary(boundary: WordTimestamp): WordTimestamp {
  return {
    word: boundary.word,
    startTime: boundary.startTime,
    endTime: boundary.endTime
  }
}
