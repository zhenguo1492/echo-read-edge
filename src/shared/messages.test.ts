import { describe, expect, it } from 'vitest'

import {
  isDictionaryLookupRequest,
  isVoiceListRequest,
  isOffscreenTtsRequest,
  isShellPingRequest,
  isTranslateRequest,
  isTtsRequest,
  isTtsRuntimeEvent,
  isVocabularyRequest
} from './messages'

describe('content service requests', () => {
  it('accepts only the fixed Edge voice-list action', () => {
    expect(isVoiceListRequest({ action: 'voices:list' })).toBe(true)
    expect(isVoiceListRequest({ action: 'voices:list', url: 'https://example.com' }))
      .toBe(true)
    expect(isVoiceListRequest({ action: 'voices:fetch-url' })).toBe(false)
  })

  it('accepts bounded translation and dictionary requests', () => {
    expect(isTranslateRequest({
      action: 'translate:text',
      text: 'A sentence to translate.',
      sourceLanguage: 'auto',
      targetLanguage: 'zh-CN'
    })).toBe(true)
    expect(isDictionaryLookupRequest({
      action: 'dictionary:lookup',
      word: "reader's"
    })).toBe(true)
  })

  it('rejects arbitrary URLs, malformed words, and invalid languages', () => {
    expect(isTranslateRequest({
      action: 'translate:text',
      text: 'Text',
      sourceLanguage: 'auto',
      targetLanguage: 'https://example.com'
    })).toBe(false)
    expect(isTranslateRequest({
      action: 'translate:text',
      text: 'Text',
      sourceLanguage: 'en',
      targetLanguage: 'en'
    })).toBe(false)
    expect(isDictionaryLookupRequest({
      action: 'dictionary:lookup',
      word: '../secrets'
    })).toBe(false)
  })
})

const PUBLIC_CONTROLS = [
  'tts:pause',
  'tts:resume',
  'tts:stop',
  'tts:previous',
  'tts:next',
  'tts:dispose'
] as const

const OFFSCREEN_CONTROLS = [
  'offscreen:tts:pause',
  'offscreen:tts:resume',
  'offscreen:tts:stop',
  'offscreen:tts:previous',
  'offscreen:tts:next',
  'offscreen:tts:dispose'
] as const

describe('isVocabularyRequest', () => {
  it('accepts a bounded save with page context and a status or remove request', () => {
    expect(isVocabularyRequest({
      action: 'vocabulary:save',
      word: 'resilient',
      context: 'The city proved resilient after the storm.',
      sourceUrl: 'https://example.com/article',
      sourceTitle: 'A resilient city'
    })).toBe(true)
    expect(isVocabularyRequest({ action: 'vocabulary:status', word: 'resilient' }))
      .toBe(true)
    expect(isVocabularyRequest({ action: 'vocabulary:remove', word: "reader's" }))
      .toBe(true)
  })

  it('rejects malformed words, non-web sources, and oversized payloads', () => {
    expect(isVocabularyRequest({ action: 'vocabulary:save', word: 'two words' }))
      .toBe(false)
    expect(isVocabularyRequest({
      action: 'vocabulary:save',
      word: 'resilient',
      sourceUrl: 'javascript:alert(1)'
    })).toBe(false)
    expect(isVocabularyRequest({
      action: 'vocabulary:save',
      word: 'resilient',
      context: 'x'.repeat(2001)
    })).toBe(false)
    expect(isVocabularyRequest({
      action: 'vocabulary:save',
      word: 'resilient',
      sourceTitle: 't'.repeat(501)
    })).toBe(false)
    expect(isVocabularyRequest({ action: 'vocabulary:clear', word: 'resilient' }))
      .toBe(false)
  })
})

describe('isShellPingRequest', () => {
  it('accepts the extension shell ping action', () => {
    expect(isShellPingRequest({ action: 'shell:ping' })).toBe(true)
  })

  it('rejects malformed and unknown messages', () => {
    expect(isShellPingRequest(null)).toBe(false)
    expect(isShellPingRequest([])).toBe(false)
    expect(isShellPingRequest({ action: 'fetch-url', url: 'https://example.com' })).toBe(false)
  })
})

describe('isTtsRequest', () => {
  it('accepts single-text and ordered queue synthesis messages', () => {
    expect(
      isTtsRequest({
        action: 'tts:start',
        text: 'Hello from EchoRead Edge.',
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880'
      })
    ).toBe(true)

    expect(
      isTtsRequest({
        action: 'tts:start-queue',
        sentences: ['First sentence.', 'Second sentence.'],
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880',
        startIndex: 1
      })
    ).toBe(true)
  })

  it('accepts every session control and targeted sentence playback', () => {
    for (const action of PUBLIC_CONTROLS) {
      expect(isTtsRequest({ action, playbackId: 'playback-1' })).toBe(true)
    }

    expect(
      isTtsRequest({
        action: 'tts:play-sentence',
        playbackId: 'playback-1',
        sentenceIndex: 2
      })
    ).toBe(true)
  })

  it('rejects malformed synthesis fields, queues, and unknown actions', () => {
    expect(
      isTtsRequest({
        action: 'tts:start',
        text: '',
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880'
      })
    ).toBe(false)
    expect(
      isTtsRequest({
        action: 'tts:start',
        text: 'Hello',
        voice: 'en-US-AriaNeural',
        rate: Number.NaN
      })
    ).toBe(false)
    expect(
      isTtsRequest({
        action: 'tts:start-queue',
        sentences: [],
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880'
      })
    ).toBe(false)
    expect(
      isTtsRequest({
        action: 'tts:start-queue',
        sentences: ['Valid sentence.', '   '],
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880'
      })
    ).toBe(false)
    expect(isTtsRequest({ action: 'tts:pause', playbackId: '' })).toBe(false)
    expect(isTtsRequest({ action: 'fetch-url', url: 'https://example.com' })).toBe(false)
  })

  it('rejects invalid target sentence indexes', () => {
    for (const sentenceIndex of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      expect(
        isTtsRequest({
          action: 'tts:play-sentence',
          playbackId: 'playback-1',
          sentenceIndex
        })
      ).toBe(false)
    }
  })

  it('rejects malformed and out-of-range queue start indexes', () => {
    for (const startIndex of [-1, 0.5, 2, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      expect(
        isTtsRequest({
          action: 'tts:start-queue',
          sentences: ['First sentence.', 'Second sentence.'],
          voice: 'en-US-AriaNeural',
          rate: 1,
          startIndex
        })
      ).toBe(false)
    }
  })
})

describe('isTtsRequest', () => {
  it('accepts a public start that names no engine', () => {
    // The popup and content script send synthesis values only; the service
    // worker resolves the engine, so requiring it here would reject every read.
    expect(isTtsRequest({
      action: 'tts:start',
      text: 'Hello from the popup.',
      voice: 'af_heart',
      rate: 1
    })).toBe(true)
    expect(isTtsRequest({
      action: 'tts:start-queue',
      sentences: ['First.', 'Second.'],
      voice: 'af_heart',
      rate: 1
    })).toBe(true)
  })

  it('still rejects a start without usable synthesis values', () => {
    expect(isTtsRequest({ action: 'tts:start', text: '', voice: 'af_heart', rate: 1 }))
      .toBe(false)
    expect(isTtsRequest({ action: 'tts:start', text: 'Hi', voice: 'af_heart' })).toBe(false)
  })
})

describe('isOffscreenTtsRequest', () => {
  it('accepts service-worker messages for the hidden TTS runtime', () => {
    expect(
      isOffscreenTtsRequest({
        target: 'offscreen',
        action: 'offscreen:tts:start',
        playbackId: 'playback-1',
        text: 'Hello from the hidden runtime.',
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880'
      })
    ).toBe(true)
    expect(
      isOffscreenTtsRequest({
        target: 'offscreen',
        action: 'offscreen:tts:start-queue',
        playbackId: 'playback-1',
        sentences: ['First sentence.', 'Second sentence.'],
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880',
        startIndex: 1
      })
    ).toBe(true)

    for (const action of OFFSCREEN_CONTROLS) {
      expect(
        isOffscreenTtsRequest({
          target: 'offscreen',
          action,
          playbackId: 'playback-1'
        })
      ).toBe(true)
    }

    expect(
      isOffscreenTtsRequest({
        target: 'offscreen',
        action: 'offscreen:tts:play-sentence',
        playbackId: 'playback-1',
        sentenceIndex: 1
      })
    ).toBe(true)
  })

  it('rejects messages for another target or without a playback ID', () => {
    expect(
      isOffscreenTtsRequest({
        target: 'background',
        action: 'offscreen:tts:start',
        playbackId: 'playback-1',
        text: 'Hello',
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880'
      })
    ).toBe(false)
    expect(
      isOffscreenTtsRequest({
        target: 'offscreen',
        action: 'offscreen:tts:resume'
      })
    ).toBe(false)
    expect(
      isOffscreenTtsRequest({
        target: 'offscreen',
        action: 'offscreen:tts:play-sentence',
        playbackId: 'playback-1',
        sentenceIndex: -1
      })
    ).toBe(false)
  })

  it('rejects a start message without a resolved, normalized engine target', () => {
    const base = {
      target: 'offscreen',
      action: 'offscreen:tts:start',
      playbackId: 'playback-1',
      text: 'Hello',
      voice: 'af_heart',
      rate: 1
    }

    expect(isOffscreenTtsRequest(base)).toBe(false)
    expect(isOffscreenTtsRequest({
      ...base,
      engine: 'azure',
      kokoroBaseUrl: 'http://localhost:8880'
    })).toBe(false)
    expect(isOffscreenTtsRequest({
      ...base,
      engine: 'kokoro',
      kokoroBaseUrl: 'http://localhost:8880/'
    })).toBe(false)
    expect(isOffscreenTtsRequest({
      ...base,
      engine: 'kokoro',
      kokoroBaseUrl: 'javascript:alert(1)'
    })).toBe(false)
    expect(isOffscreenTtsRequest({
      ...base,
      engine: 'kokoro',
      kokoroBaseUrl: 'http://localhost:8880'
    })).toBe(true)
  })

  it('rejects an offscreen queue start index outside the validated queue', () => {
    expect(
      isOffscreenTtsRequest({
        target: 'offscreen',
        action: 'offscreen:tts:start-queue',
        playbackId: 'playback-1',
        sentences: ['Only sentence.'],
        voice: 'en-US-AriaNeural',
        rate: 1,
        engine: 'edge',
        kokoroBaseUrl: 'http://localhost:8880',
        startIndex: 1
      })
    ).toBe(false)
  })
})

describe('isTtsRuntimeEvent', () => {
  it('accepts indexed playback state and boundary events', () => {
    expect(
      isTtsRuntimeEvent({
        action: 'tts:state',
        playbackId: 'playback-1',
        state: 'playing',
        sentenceIndex: 1,
        currentTime: 0.25
      })
    ).toBe(true)

    expect(
      isTtsRuntimeEvent({
        action: 'tts:word',
        playbackId: 'playback-1',
        sentenceIndex: 1,
        wordIndex: 3
      })
    ).toBe(true)

    expect(
      isTtsRuntimeEvent({
        action: 'tts:boundaries',
        playbackId: 'playback-1',
        sentenceIndex: 1,
        wordBoundaries: [{ word: 'Hello', startTime: 0.1, endTime: 0.4 }]
      })
    ).toBe(true)
  })

  it('accepts non-destructive stopped and ended state events', () => {
    for (const state of ['stopped', 'ended']) {
      expect(
        isTtsRuntimeEvent({
          action: 'tts:state',
          playbackId: 'playback-1',
          state,
          sentenceIndex: 2
        })
      ).toBe(true)
    }
  })

  it('rejects malformed sentence indexes, timing values, and runtime errors', () => {
    expect(
      isTtsRuntimeEvent({
        action: 'tts:state',
        playbackId: 'playback-1',
        state: 'playing',
        sentenceIndex: 0.5
      })
    ).toBe(false)
    expect(
      isTtsRuntimeEvent({
        action: 'tts:word',
        playbackId: 'playback-1',
        sentenceIndex: 0,
        wordIndex: -1
      })
    ).toBe(false)
    expect(
      isTtsRuntimeEvent({
        action: 'tts:boundaries',
        playbackId: 'playback-1',
        sentenceIndex: 0,
        wordBoundaries: [{ word: 'Hello', startTime: 0.4, endTime: 0.1 }]
      })
    ).toBe(false)
    expect(
      isTtsRuntimeEvent({
        action: 'tts:state',
        playbackId: 'playback-1',
        state: 'stopped',
        error: { code: 'unknown', message: 'Invalid runtime error.' }
      })
    ).toBe(false)
  })
})
