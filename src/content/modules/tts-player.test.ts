import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TtsCommandResponse } from '@/shared/messages'
import {
  activePlaybackId,
  clearPlaybackError,
  currentIndex,
  currentWordIndex,
  errorMessage,
  isIdle,
  isPaused,
  isPlaying,
  isStartingPlayback,
  resetPlayback,
  sentenceStatuses,
  sentenceWordTimestamps,
  sentences,
  wordTimestamps
} from '@/lib/store/playback-store'
import {
  disposeReading,
  disposeTtsPlayer,
  initializeTtsPlayer,
  pauseReading,
  playNextSentence,
  playPreviousSentence,
  playSentence,
  readSentences,
  resumeReading,
  stopReading
} from './tts-player'

type RuntimeListener = (message: unknown) => void

const sendMessageMock = vi.fn<(message: unknown) => Promise<TtsCommandResponse>>()
let runtimeListener: RuntimeListener | undefined

// The reader speaks with the single voice stored in the popup, so the player
// receives nothing that could select a different one.
const settings = {
  voice: 'en-US-AriaNeural',
  speed: 1.25
}

const queue = [
  { start: 0, end: 6, text: 'First.' },
  { start: 7, end: 14, text: 'Second.' },
  { start: 15, end: 21, text: 'Third.' }
]

describe('content TTS queue player', () => {
  beforeAll(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: sendMessageMock,
        onMessage: {
          addListener: vi.fn((listener: RuntimeListener) => {
            runtimeListener = listener
          }),
          removeListener: vi.fn((listener: RuntimeListener) => {
            if (runtimeListener === listener) runtimeListener = undefined
          })
        }
      }
    })
  })

  afterAll(() => {
    disposeTtsPlayer()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    disposeTtsPlayer()
    resetPlayback()
    clearPlaybackError()
    sendMessageMock.mockReset()
    runtimeListener = undefined
    initializeTtsPlayer()
  })

  it('sends the complete ordered queue once and appends indexed boundaries', async () => {
    sendMessageMock.mockResolvedValueOnce(
      success('queue-playback', 'playing', 0, [
        { word: 'First', startTime: 0.1, endTime: 0.4 }
      ])
    )

    await expect(readSentences(queue, settings)).resolves.toBe(true)

    expect(sendMessageMock).toHaveBeenCalledOnce()
    expect(sendMessageMock).toHaveBeenCalledWith({
      action: 'tts:start-queue',
      sentences: ['First.', 'Second.', 'Third.'],
      voice: 'en-US-AriaNeural',
      rate: 1.25
    })
    expect(sentences.value).toEqual(queue)
    expect(activePlaybackId.value).toBe('queue-playback')
    expect(currentIndex.value).toBe(0)
    expect(isPlaying.value).toBe(true)

    dispatchRuntimeEvent({
      action: 'tts:boundaries',
      playbackId: 'queue-playback',
      sentenceIndex: 0,
      wordBoundaries: [{ word: 'sentence', startTime: 0.5, endTime: 0.9 }]
    })
    expect(wordTimestamps.value).toEqual([
      { word: 'First', startTime: 0.1, endTime: 0.4 },
      { word: 'sentence', startTime: 0.5, endTime: 0.9 }
    ])

    dispatchRuntimeEvent({
      action: 'tts:word',
      playbackId: 'queue-playback',
      sentenceIndex: 0,
      wordIndex: 1
    })
    expect(currentWordIndex.value).toBe(1)
  })

  it('starts a translated selection at the activated sentence', async () => {
    sendMessageMock.mockResolvedValueOnce(success('targeted-playback', 'playing', 1))

    await expect(readSentences(queue, settings, 1)).resolves.toBe(true)

    expect(sendMessageMock).toHaveBeenCalledWith({
      action: 'tts:start-queue',
      sentences: ['First.', 'Second.', 'Third.'],
      voice: 'en-US-AriaNeural',
      rate: 1.25,
      startIndex: 1
    })
    expect(currentIndex.value).toBe(1)
  })

  it('keeps the configured voice for text in another script', async () => {
    sendMessageMock.mockResolvedValueOnce(success('chinese-playback', 'playing', 0))

    await expect(readSentences([
      { start: 0, end: 5, text: '\u8fd9\u662f\u4e2d\u6587\u3002' }
    ], settings)).resolves.toBe(true)

    expect(sendMessageMock).toHaveBeenCalledWith({
      action: 'tts:start-queue',
      sentences: ['\u8fd9\u662f\u4e2d\u6587\u3002'],
      voice: 'en-US-AriaNeural',
      rate: 1.25
    })
  })

  it('ignores the page language of the selected element', async () => {
    document.documentElement.lang = 'en-US'
    const paragraph = document.createElement('p')
    paragraph.lang = 'it-IT'
    paragraph.textContent = 'Ciao'
    document.body.append(paragraph)
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    sendMessageMock.mockResolvedValueOnce(success('italian-playback', 'playing', 0))

    await expect(readSentences([
      { start: 0, end: 4, text: 'Ciao', range }
    ], settings)).resolves.toBe(true)

    expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      voice: 'en-US-AriaNeural'
    }))
    paragraph.remove()
    document.documentElement.removeAttribute('lang')
  })

  it('retains indexed metadata that arrives before the queue start response', async () => {
    const startResponse = deferred<TtsCommandResponse>()
    sendMessageMock.mockReturnValueOnce(startResponse.promise)

    const reading = readSentences(queue, settings)
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledOnce())

    dispatchRuntimeEvent({
      action: 'tts:boundaries',
      playbackId: 'early-playback',
      sentenceIndex: 0,
      wordBoundaries: [{ word: 'later', startTime: 0.5, endTime: 0.9 }]
    })
    startResponse.resolve(
      success('early-playback', 'playing', 0, [
        { word: 'First', startTime: 0.1, endTime: 0.4 }
      ])
    )

    await expect(reading).resolves.toBe(true)
    expect(wordTimestamps.value).toEqual([
      { word: 'First', startTime: 0.1, endTime: 0.4 },
      { word: 'later', startTime: 0.5, endTime: 0.9 }
    ])
  })

  it('routes playback and sentence navigation through one retained playback ID', async () => {
    sendMessageMock
      .mockResolvedValueOnce(success('controlled-session', 'playing', 0))
      .mockResolvedValueOnce(success('controlled-session', 'paused', 0))
      .mockResolvedValueOnce(success('controlled-session', 'playing', 0))
      .mockResolvedValueOnce(success('controlled-session', 'stopped', 0))
      .mockResolvedValueOnce(success('controlled-session', 'playing', 1))
      .mockResolvedValueOnce(success('controlled-session', 'playing', 0))
      .mockResolvedValueOnce(success('controlled-session', 'playing', 2))

    await readSentences(queue, settings)

    await expect(pauseReading()).resolves.toBe(true)
    expect(isPaused.value).toBe(true)
    await expect(resumeReading()).resolves.toBe(true)
    expect(isPlaying.value).toBe(true)
    await expect(stopReading()).resolves.toBe(true)
    expect(isIdle.value).toBe(true)
    expect(activePlaybackId.value).toBe('controlled-session')

    await expect(playNextSentence()).resolves.toBe(true)
    expect(currentIndex.value).toBe(1)
    await expect(playPreviousSentence()).resolves.toBe(true)
    expect(currentIndex.value).toBe(0)
    await expect(playSentence(2)).resolves.toBe(true)
    expect(currentIndex.value).toBe(2)

    expect(sendMessageMock.mock.calls.slice(1).map(([message]) => message)).toEqual([
      { action: 'tts:pause', playbackId: 'controlled-session' },
      { action: 'tts:resume', playbackId: 'controlled-session' },
      { action: 'tts:stop', playbackId: 'controlled-session' },
      { action: 'tts:next', playbackId: 'controlled-session' },
      { action: 'tts:previous', playbackId: 'controlled-session' },
      {
        action: 'tts:play-sentence',
        playbackId: 'controlled-session',
        sentenceIndex: 2
      }
    ])
  })

  it('clears the retained content session after explicit dispose', async () => {
    sendMessageMock
      .mockResolvedValueOnce(success('disposable-session', 'playing', 0))
      .mockResolvedValueOnce(success('disposable-session', 'stopped', 0))

    await readSentences(queue, settings)
    await expect(disposeReading()).resolves.toBe(true)

    expect(sendMessageMock).toHaveBeenLastCalledWith({
      action: 'tts:dispose',
      playbackId: 'disposable-session'
    })
    expect(activePlaybackId.value).toBeNull()
    expect(sentences.value).toEqual(queue)
  })

  it('exits the retained content session when the remote runtime is already gone', async () => {
    sendMessageMock
      .mockResolvedValueOnce(success('stale-session', 'playing', 0))
      .mockRejectedValueOnce(new Error('The message port closed.'))

    await readSentences(queue, settings)
    await expect(disposeReading()).resolves.toBe(true)

    expect(sendMessageMock).toHaveBeenLastCalledWith({
      action: 'tts:dispose',
      playbackId: 'stale-session'
    })
    expect(activePlaybackId.value).toBeNull()
    expect(isIdle.value).toBe(true)
    // Teardown asked for a session that no longer exists, which is the state it
    // wanted; reporting that as a failure would leave the controls looking broken.
    expect(errorMessage.value).toBeNull()
  })

  it('reports no failure when dispose finds the session already released', async () => {
    sendMessageMock
      .mockResolvedValueOnce(success('forgotten-session', 'playing', 0))
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'invalid-request',
          message: 'The requested playback session is no longer active.'
        }
      })

    await readSentences(queue, settings)
    await expect(disposeReading()).resolves.toBe(true)

    expect(activePlaybackId.value).toBeNull()
    expect(errorMessage.value).toBeNull()
  })

  it('still reports a failed stop, which leaves audio the reader can hear', async () => {
    sendMessageMock
      .mockResolvedValueOnce(success('stopping-session', 'playing', 0))
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'connection-failed',
          message: 'Edge TTS is currently unavailable.'
        }
      })

    await readSentences(queue, settings)
    await expect(stopReading()).resolves.toBe(false)

    expect(errorMessage.value).toBe('Edge TTS is currently unavailable.')
  })

  it('disposes a stale successful response after a newer queue replaces it', async () => {
    const firstResponse = deferred<TtsCommandResponse>()
    const secondResponse = deferred<TtsCommandResponse>()
    sendMessageMock
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise)
      .mockResolvedValueOnce(success('old-playback', 'stopped', 0))

    const firstReading = readSentences([queue[0]], settings)
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1))

    const secondReading = readSentences([queue[1]], settings)
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(2))

    firstResponse.resolve(success('old-playback', 'playing', 0))
    await expect(firstReading).resolves.toBe(false)
    await vi.waitFor(() =>
      expect(sendMessageMock).toHaveBeenNthCalledWith(3, {
        action: 'tts:dispose',
        playbackId: 'old-playback'
      })
    )

    secondResponse.resolve(success('new-playback', 'playing', 0))
    await expect(secondReading).resolves.toBe(true)
    expect(activePlaybackId.value).toBe('new-playback')
    expect(sentences.value).toEqual([queue[1]])
  })

  it('lets offscreen advance sentence indexes without sending another start request', async () => {
    sendMessageMock.mockResolvedValueOnce(success('automatic-session', 'playing', 0))
    await readSentences(queue, settings)

    dispatchRuntimeEvent({
      action: 'tts:state',
      playbackId: 'automatic-session',
      state: 'synthesizing',
      sentenceIndex: 1
    })
    dispatchRuntimeEvent({
      action: 'tts:state',
      playbackId: 'automatic-session',
      state: 'playing',
      sentenceIndex: 1
    })
    dispatchRuntimeEvent({
      action: 'tts:boundaries',
      playbackId: 'automatic-session',
      sentenceIndex: 1,
      wordBoundaries: [{ word: 'Second', startTime: 0.1, endTime: 0.4 }]
    })

    expect(sendMessageMock).toHaveBeenCalledOnce()
    expect(currentIndex.value).toBe(1)
    expect(sentenceStatuses.value).toEqual(['played', 'playing', 'waiting'])
    expect(sentenceWordTimestamps.value[1]).toEqual([
      { word: 'Second', startTime: 0.1, endTime: 0.4 }
    ])

    dispatchRuntimeEvent({
      action: 'tts:state',
      playbackId: 'automatic-session',
      state: 'ended',
      sentenceIndex: 2
    })
    expect(sendMessageMock).toHaveBeenCalledOnce()
    expect(currentIndex.value).toBe(2)
    expect(activePlaybackId.value).toBe('automatic-session')
    expect(isIdle.value).toBe(true)
  })

  it('invalidates a pending start on stop and disposes its late session ID', async () => {
    const startResponse = deferred<TtsCommandResponse>()
    sendMessageMock
      .mockReturnValueOnce(startResponse.promise)
      .mockResolvedValueOnce(success('late-session', 'stopped', 0))

    const reading = readSentences(queue, settings)
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledOnce())
    await expect(stopReading()).resolves.toBe(true)

    startResponse.resolve(success('late-session', 'playing', 0))
    await expect(reading).resolves.toBe(false)
    await vi.waitFor(() =>
      expect(sendMessageMock).toHaveBeenLastCalledWith({
        action: 'tts:dispose',
        playbackId: 'late-session'
      })
    )
    expect(activePlaybackId.value).toBeNull()
  })

  it('marks the queue as starting until the runtime answers', async () => {
    const startResponse = deferred<TtsCommandResponse>()
    sendMessageMock.mockReturnValueOnce(startResponse.promise)

    const reading = readSentences(queue, settings)
    await vi.waitFor(() => expect(isStartingPlayback.value).toBe(true))

    startResponse.resolve(success('pending-session', 'playing', 0))
    await expect(reading).resolves.toBe(true)
    expect(isStartingPlayback.value).toBe(false)
  })

  it('stops marking a start that the runtime refused', async () => {
    sendMessageMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'connection-failed',
        message: 'Edge TTS is currently unavailable.'
      }
    })

    await expect(readSentences(queue, settings)).resolves.toBe(false)
    expect(isStartingPlayback.value).toBe(false)
  })

  it('stops marking a start that was abandoned before its response', async () => {
    const startResponse = deferred<TtsCommandResponse>()
    sendMessageMock
      .mockReturnValueOnce(startResponse.promise)
      .mockResolvedValueOnce(success('late-session', 'stopped', 0))

    const reading = readSentences(queue, settings)
    await vi.waitFor(() => expect(isStartingPlayback.value).toBe(true))
    await expect(stopReading()).resolves.toBe(true)
    expect(isStartingPlayback.value).toBe(false)

    startResponse.resolve(success('late-session', 'playing', 0))
    await expect(reading).resolves.toBe(false)
    expect(isStartingPlayback.value).toBe(false)
  })

  it('rejects invalid targeted navigation without sending a runtime message', async () => {
    sendMessageMock.mockResolvedValueOnce(success('indexed-session', 'playing', 0))
    await readSentences(queue, settings)

    await expect(playSentence(-1)).resolves.toBe(false)
    await expect(playSentence(1.5)).resolves.toBe(false)
    expect(sendMessageMock).toHaveBeenCalledOnce()
  })

  it('surfaces a typed queue start failure without creating an active session', async () => {
    sendMessageMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'connection-failed',
        message: 'Edge TTS is currently unavailable.'
      }
    })

    await expect(readSentences(queue, settings)).resolves.toBe(false)
    expect(activePlaybackId.value).toBeNull()
    expect(errorMessage.value).toBe('Edge TTS is currently unavailable.')
  })

  it('keeps the retained queue and voice when a blank selection cannot be read', async () => {
    sendMessageMock
      .mockResolvedValueOnce(success('retained-session', 'playing', 0))
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'runtime-unavailable',
          message: 'The hidden audio runtime is unavailable.'
        }
      })
      .mockResolvedValueOnce(success('restored-session', 'playing', 0))

    await expect(readSentences(queue, settings)).resolves.toBe(true)
    await expect(
      readSentences([{ start: 0, end: 2, text: '  ' }], settings)
    ).resolves.toBe(false)

    expect(sendMessageMock).toHaveBeenCalledOnce()
    expect(sentences.value).toEqual(queue)

    await expect(resumeReading()).resolves.toBe(true)
    expect(sendMessageMock).toHaveBeenNthCalledWith(3, {
      action: 'tts:start-queue',
      sentences: ['First.', 'Second.', 'Third.'],
      voice: 'en-US-AriaNeural',
      rate: 1.25
    })
    expect(activePlaybackId.value).toBe('restored-session')
  })

  it('restores the retained queue at the current sentence after offscreen expires', async () => {
    sendMessageMock
      .mockResolvedValueOnce(success('expired-session', 'playing', 0))
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'runtime-unavailable',
          message: 'The hidden audio runtime is unavailable.'
        }
      })
      .mockResolvedValueOnce(success('restored-session', 'playing', 1))

    await expect(readSentences(queue, settings)).resolves.toBe(true)
    dispatchRuntimeEvent({
      action: 'tts:state',
      playbackId: 'expired-session',
      state: 'stopped',
      sentenceIndex: 1
    })

    await expect(resumeReading()).resolves.toBe(true)

    expect(sendMessageMock).toHaveBeenNthCalledWith(2, {
      action: 'tts:resume',
      playbackId: 'expired-session'
    })
    expect(sendMessageMock).toHaveBeenNthCalledWith(3, {
      action: 'tts:start-queue',
      sentences: ['First.', 'Second.', 'Third.'],
      voice: 'en-US-AriaNeural',
      rate: 1.25,
      startIndex: 1
    })
    expect(activePlaybackId.value).toBe('restored-session')
    expect(currentIndex.value).toBe(1)
    expect(isPlaying.value).toBe(true)
    expect(errorMessage.value).toBeNull()
  })
})

function dispatchRuntimeEvent(message: unknown): void {
  if (!runtimeListener) throw new Error('The content TTS listener was not registered.')
  runtimeListener(message)
}

function success(
  playbackId: string,
  state: 'playing' | 'paused' | 'stopped',
  sentenceIndex: number,
  wordBoundaries?: Array<{ word: string; startTime: number; endTime: number }>
): TtsCommandResponse {
  return {
    ok: true,
    playbackId,
    state,
    sentenceIndex,
    ...(wordBoundaries ? { wordBoundaries } : {})
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: (value: T) => {
      if (!resolvePromise) throw new Error('The deferred Promise was not initialized.')
      resolvePromise(value)
    }
  }
}
