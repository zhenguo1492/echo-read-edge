import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  destroyExampleSpeech,
  exampleSpeechState,
  initializeExampleSpeech,
  toggleExampleSpeech
} from './example-speech-controller'

let runtimeListener: ((message: unknown) => void) | null = null
const sendMessage = vi.fn()

beforeEach(() => {
  sendMessage.mockReset()
  runtimeListener = null
  vi.stubGlobal('chrome', {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListener = listener
        }),
        removeListener: vi.fn()
      },
      sendMessage
    }
  })
  initializeExampleSpeech()
})

afterEach(() => {
  destroyExampleSpeech()
  vi.unstubAllGlobals()
})

describe('example speech controller', () => {
  it('plays, pauses, resumes, and applies word events to one example', async () => {
    sendMessage.mockResolvedValueOnce({
      ok: true,
      playbackId: 'example-playback',
      state: 'playing',
      wordBoundaries: [{ word: 'Read', startTime: 0, endTime: 0.2 }]
    })
    await expect(toggleExampleSpeech('example-1', 'Read this.', {
      voice: 'en-US-AriaNeural',
      speed: 1
    })).resolves.toBe(true)
    expect(sendMessage).toHaveBeenCalledWith({
      action: 'tts:start',
      text: 'Read this.',
      voice: 'en-US-AriaNeural',
      rate: 1
    })

    runtimeListener?.({
      action: 'tts:boundaries',
      playbackId: 'example-playback',
      wordBoundaries: [{ word: 'this', startTime: 0.2, endTime: 0.4 }]
    })
    runtimeListener?.({
      action: 'tts:word',
      playbackId: 'example-playback',
      sentenceIndex: 0,
      wordIndex: 1
    })
    expect(exampleSpeechState.value).toMatchObject({
      sourceId: 'example-1',
      playState: 'playing',
      wordIndex: 1,
      boundaries: [{ word: 'Read' }, { word: 'this' }]
    })

    sendMessage.mockResolvedValueOnce({ ok: true, playbackId: 'example-playback', state: 'paused' })
    await toggleExampleSpeech('example-1', 'Read this.', { voice: 'en-US-AriaNeural', speed: 1 })
    expect(sendMessage).toHaveBeenLastCalledWith({ action: 'tts:pause', playbackId: 'example-playback' })
    expect(exampleSpeechState.value.playState).toBe('paused')

    sendMessage.mockResolvedValueOnce({ ok: true, playbackId: 'example-playback', state: 'playing' })
    await toggleExampleSpeech('example-1', 'Read this.', { voice: 'en-US-AriaNeural', speed: 1 })
    expect(sendMessage).toHaveBeenLastCalledWith({ action: 'tts:resume', playbackId: 'example-playback' })
    expect(exampleSpeechState.value.playState).toBe('playing')
  })

  it('retains boundary events that arrive before the start response', async () => {
    let resolveStart!: (response: unknown) => void
    sendMessage.mockReturnValueOnce(new Promise((resolve) => {
      resolveStart = resolve
    }))
    const starting = toggleExampleSpeech('example-2', 'Early boundary.', {
      voice: 'en-US-AriaNeural',
      speed: 1
    })
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      action: 'tts:start',
      text: 'Early boundary.',
      voice: 'en-US-AriaNeural',
      rate: 1
    }))
    runtimeListener?.({
      action: 'tts:boundaries',
      playbackId: 'early-playback',
      wordBoundaries: [{ word: 'Early', startTime: 0, endTime: 0.2 }]
    })
    resolveStart({ ok: true, playbackId: 'early-playback', state: 'playing' })

    await expect(starting).resolves.toBe(true)
    expect(exampleSpeechState.value.boundaries).toEqual([
      { word: 'Early', startTime: 0, endTime: 0.2 }
    ])
  })
})
