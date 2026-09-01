import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TtsProviderError,
  type SpeechSynthesisRequest,
  type SpeechSynthesisStreamHandlers,
  type SpeechSynthesisStreamSummary,
  type WordBoundary
} from '@/providers/tts-provider'
import type { TtsCommandResponse } from '@/shared/messages'

interface StreamCall {
  request: SpeechSynthesisRequest
  handlers: SpeechSynthesisStreamHandlers
  signal: AbortSignal
  boundaries: WordBoundary[]
  resolve: (summary: SpeechSynthesisStreamSummary) => void
  reject: (error: unknown) => void
}

const { synthesizeStreamMock, kokoroOptionsMock } = vi.hoisted(() => ({
  synthesizeStreamMock: vi.fn(),
  kokoroOptionsMock: vi.fn()
}))

vi.mock('@/providers/edge-tts-provider', () => ({
  EdgeTtsProvider: class MockEdgeTtsProvider {
    synthesizeStream = synthesizeStreamMock
  }
}))

vi.mock('@/providers/kokoro-tts-provider', () => ({
  KokoroTtsProvider: class MockKokoroTtsProvider {
    synthesizeStream = synthesizeStreamMock

    constructor(options: unknown) {
      kokoroOptionsMock(options)
    }
  }
}))

type RuntimeMessageListener = (
  message: unknown,
  sender: { id?: string },
  sendResponse: (response: TtsCommandResponse) => void
) => boolean

class MockAudio extends EventTarget {
  static instances: MockAudio[] = []

  readonly play = vi.fn(async () => {
    this.paused = false
  })
  readonly pause = vi.fn(() => {
    this.paused = true
  })
  readonly load = vi.fn()
  paused = true
  currentTime = 0
  error: MediaError | null = null
  src: string

  constructor(src: string) {
    super()
    this.src = src
    MockAudio.instances.push(this)
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }

  finish(): void {
    this.dispatchEvent(new Event('ended'))
  }
}

/** Controllable SourceBuffer that exposes each append in provider order. */
class MockSourceBuffer extends EventTarget {
  /** Audio one mock byte represents; tests lower it to model real Edge frames. */
  static secondsPerByte = 1

  readonly appendedAudio: number[][] = []
  readonly abort = vi.fn(() => {
    this.updating = false
  })
  readonly appendBuffer = vi.fn((data: BufferSource) => {
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    this.appendedAudio.push(Array.from(bytes))
    this.bufferedSeconds += bytes.length * MockSourceBuffer.secondsPerByte
    this.updating = true
  })
  updating = false
  bufferedSeconds = 0

  get buffered(): TimeRanges {
    const end = this.bufferedSeconds
    return {
      length: end > 0 ? 1 : 0,
      start: () => 0,
      end: () => end
    } as unknown as TimeRanges
  }

  finishAppend(): void {
    this.updating = false
    this.dispatchEvent(new Event('updateend'))
  }
}

/** Minimal MediaSource lifecycle used for current and promoted sentences. */
class MockMediaSource extends EventTarget {
  static instances: MockMediaSource[] = []
  static readonly isTypeSupported = vi.fn(() => true)

  readonly sourceBuffer = new MockSourceBuffer()
  readonly addSourceBuffer = vi.fn(() => this.sourceBuffer)
  readonly endOfStream = vi.fn(() => {
    this.readyState = 'ended'
  })
  readyState: 'closed' | 'open' | 'ended' = 'closed'

  constructor() {
    super()
    MockMediaSource.instances.push(this)
  }

  open(): void {
    this.readyState = 'open'
    this.dispatchEvent(new Event('sourceopen'))
  }
}

const streamCalls: StreamCall[] = []
const sendMessageMock = vi.fn<() => Promise<unknown>>()
const createObjectUrlMock = vi.fn(() => `blob:mock-${createObjectUrlMock.mock.calls.length}`)
const revokeObjectUrlMock = vi.fn()
const NativeUrl = URL

class MockUrl extends NativeUrl {
  static readonly createObjectURL = createObjectUrlMock
  static readonly revokeObjectURL = revokeObjectUrlMock
}

let runtimeListener: RuntimeMessageListener | undefined
let currentPlaybackId: string | null = null

describe('offscreen TTS queue runtime', () => {
  beforeAll(async () => {
    vi.stubGlobal('Audio', MockAudio)
    vi.stubGlobal('URL', MockUrl)
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'test-extension-id',
        onMessage: {
          addListener: vi.fn((listener: RuntimeMessageListener) => {
            runtimeListener = listener
          })
        },
        sendMessage: sendMessageMock
      }
    })

    await import('./index')
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    MockAudio.instances = []
    MockMediaSource.instances = []
    MockMediaSource.isTypeSupported.mockClear()
    MockSourceBuffer.secondsPerByte = 1
    streamCalls.length = 0
    synthesizeStreamMock.mockReset().mockImplementation(createStreamCall)
    kokoroOptionsMock.mockReset()
    sendMessageMock.mockReset().mockResolvedValue(undefined)
    createObjectUrlMock.mockClear()
    revokeObjectUrlMock.mockClear()
    vi.stubGlobal('MediaSource', MockMediaSource)
    currentPlaybackId = null
  })

  afterEach(async () => {
    if (!currentPlaybackId) return
    await dispatch(controlMessage('dispose', currentPlaybackId))
    currentPlaybackId = null
  })

  it('synthesizes through the engine the service worker resolved', async () => {
    const startResponse = startQueue('kokoro-engine', ['Only sentence.'], undefined, {
      engine: 'kokoro',
      kokoroBaseUrl: 'http://127.0.0.1:9000'
    })

    await waitForStreamTexts(['Only sentence.'])
    expect(kokoroOptionsMock).toHaveBeenCalledWith({ baseUrl: 'http://127.0.0.1:9000' })

    MockMediaSource.instances[0].open()
    emitAudio('Only sentence.', [1, 2, 3])
    await expect(startResponse).resolves.toMatchObject({ ok: true, state: 'playing' })
  })

  it('prefetches two future sentences only once the current one is audible', async () => {
    const startResponse = startQueue('prefetch-window', [
      'First sentence.',
      'Second sentence.',
      'Third sentence.',
      'Fourth sentence.'
    ])

    await waitForStreamTexts(['First sentence.'])
    // The current sentence holds the connection alone until it can be heard.
    expect(findStream('Second sentence.')).toBeUndefined()

    const firstMediaSource = MockMediaSource.instances[0]
    firstMediaSource.open()
    emitBoundaries('First sentence.', [
      boundary('First', 0.1, 0.3),
      boundary('sentence', 0.35, 0.8)
    ])
    emitAudio('First sentence.', [1, 2, 3])

    await expect(startResponse).resolves.toMatchObject({
      ok: true,
      playbackId: 'prefetch-window',
      state: 'playing',
      sentenceIndex: 0,
      wordBoundaries: [
        boundary('First', 0.1, 0.3),
        boundary('sentence', 0.35, 0.8)
      ]
    })
    await waitForStreamTexts(['Second sentence.', 'Third sentence.'])
    expect(findStream('Fourth sentence.')).toBeUndefined()

    expect(firstMediaSource.sourceBuffer.appendedAudio).toEqual([[1, 2, 3]])
    expect(MockAudio.instances[0]?.play).toHaveBeenCalledOnce()
    expect(sendMessageMock).toHaveBeenCalledWith({
      action: 'tts:word',
      playbackId: 'prefetch-window',
      sentenceIndex: 0,
      wordIndex: 0
    })

    MockAudio.instances[0].currentTime = 0.5
    MockAudio.instances[0].dispatchEvent(new Event('timeupdate'))
    expect(sendMessageMock).toHaveBeenCalledWith({
      action: 'tts:word',
      playbackId: 'prefetch-window',
      sentenceIndex: 0,
      wordIndex: 1
    })
  })

  it('starts a restored queue at its requested sentence without playing sentence zero', async () => {
    const startResponse = startQueue(
      'restored-index',
      ['First sentence.', 'Second sentence.', 'Third sentence.', 'Fourth sentence.'],
      1
    )

    await waitForStreamTexts(['Second sentence.'])
    expect(findStream('First sentence.')).toBeUndefined()

    MockMediaSource.instances[0].open()
    emitAudio('Second sentence.', [2, 3])

    await expect(startResponse).resolves.toMatchObject({
      ok: true,
      playbackId: 'restored-index',
      state: 'playing',
      sentenceIndex: 1
    })

    await waitForStreamTexts(['Third sentence.', 'Fourth sentence.'])
    expect(findStream('First sentence.')).toBeUndefined()
  })

  it('deduplicates equal sentences into one in-flight synthesis job', async () => {
    const startResponse = startQueue('deduplicated', [
      'Repeated sentence.',
      'Repeated sentence.',
      'Repeated sentence.'
    ])

    await vi.waitFor(() => expect(streamCalls).toHaveLength(1))
    MockMediaSource.instances[0].open()
    emitAudio('Repeated sentence.', [4, 5])

    await expect(startResponse).resolves.toMatchObject({
      ok: true,
      sentenceIndex: 0
    })
    expect(synthesizeStreamMock).toHaveBeenCalledOnce()
  })

  it('promotes cached audio and extends the prefetch window without another start request', async () => {
    const sentences = ['First.', 'Second.', 'Third.', 'Fourth.']
    const startResponse = startQueue('automatic-promotion', sentences)
    await waitForStreamTexts(['First.'])

    MockMediaSource.instances[0].open()
    emitAudio('First.', [10, 11])
    completeStream('First.')
    await startResponse

    await waitForStreamTexts(['Second.', 'Third.'])
    emitBoundaries('Second.', [boundary('Second')])
    emitAudio('Second.', [20, 21])
    completeStream('Second.')

    MockMediaSource.instances[0].sourceBuffer.finishAppend()
    MockAudio.instances[0].finish()

    await vi.waitFor(() => expect(MockMediaSource.instances).toHaveLength(2))
    MockMediaSource.instances[1].open()
    await vi.waitFor(() =>
      expect(MockMediaSource.instances[1].sourceBuffer.appendedAudio).toEqual([
        [20, 21]
      ])
    )
    await vi.waitFor(() => expect(findStream('Fourth.')).toBeDefined())

    expect(streamCalls.filter((call) => call.request.text === 'Second.')).toHaveLength(1)
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tts:state',
        playbackId: 'automatic-promotion',
        state: 'playing',
        sentenceIndex: 1
      })
    )
    expect(sendMessageMock).toHaveBeenCalledWith({
      action: 'tts:boundaries',
      playbackId: 'automatic-promotion',
      sentenceIndex: 1,
      wordBoundaries: [boundary('Second')]
    })
  })

  it('publishes later WordBoundary batches with the active sentence index', async () => {
    const startResponse = startQueue('indexed-boundaries', ['Boundary sentence.'])
    await waitForStreamTexts(['Boundary sentence.'])
    MockMediaSource.instances[0].open()
    emitAudio('Boundary sentence.', [1])
    await startResponse

    emitBoundaries('Boundary sentence.', [boundary('later', 0.5, 0.8)])

    expect(sendMessageMock).toHaveBeenCalledWith({
      action: 'tts:boundaries',
      playbackId: 'indexed-boundaries',
      sentenceIndex: 0,
      wordBoundaries: [boundary('later', 0.5, 0.8)]
    })
  })

  it('navigates next and previous using completed cache entries', async () => {
    const startResponse = startQueue('navigation', ['First cached.', 'Second cached.'])
    await waitForStreamTexts(['First cached.'])

    emitAudio('First cached.', [1])
    completeStream('First cached.')
    MockMediaSource.instances[0].open()
    await startResponse

    await waitForStreamTexts(['Second cached.'])
    emitAudio('Second cached.', [2])
    completeStream('Second cached.')

    const nextResponse = dispatch(controlMessage('next', 'navigation'))
    await vi.waitFor(() => expect(MockMediaSource.instances).toHaveLength(2))
    MockMediaSource.instances[1].open()
    await expect(nextResponse).resolves.toMatchObject({
      ok: true,
      state: 'playing',
      sentenceIndex: 1
    })

    const previousResponse = dispatch(controlMessage('previous', 'navigation'))
    await vi.waitFor(() => expect(MockMediaSource.instances).toHaveLength(3))
    MockMediaSource.instances[2].open()
    await expect(previousResponse).resolves.toMatchObject({
      ok: true,
      state: 'playing',
      sentenceIndex: 0
    })

    expect(streamCalls.filter((call) => call.request.text === 'First cached.')).toHaveLength(1)
    expect(streamCalls.filter((call) => call.request.text === 'Second cached.')).toHaveLength(1)
  })

  it('retains completed cache across stop and resumes without resynthesis', async () => {
    const startResponse = startQueue('non-destructive-stop', ['Retained sentence.'])
    await waitForStreamTexts(['Retained sentence.'])
    emitAudio('Retained sentence.', [7, 8])
    completeStream('Retained sentence.')
    MockMediaSource.instances[0].open()
    await startResponse

    await expect(dispatch(controlMessage('stop', 'non-destructive-stop'))).resolves.toMatchObject({
      ok: true,
      state: 'stopped',
      sentenceIndex: 0
    })

    const resumeResponse = dispatch(controlMessage('resume', 'non-destructive-stop'))
    await vi.waitFor(() => expect(MockMediaSource.instances).toHaveLength(2))
    MockMediaSource.instances[1].open()
    await expect(resumeResponse).resolves.toMatchObject({
      ok: true,
      state: 'playing',
      sentenceIndex: 0
    })
    expect(streamCalls).toHaveLength(1)
  })

  it('cancels current and prefetched WebSockets on stop but retains the session', async () => {
    const startResponse = startQueue('stop-pending', ['Current.', 'Future one.', 'Future two.'])
    await waitForStreamTexts(['Current.'])
    MockMediaSource.instances[0].open()
    emitAudio('Current.', [9])
    await startResponse
    await waitForStreamTexts(['Future one.', 'Future two.'])

    await expect(dispatch(controlMessage('stop', 'stop-pending'))).resolves.toMatchObject({
      ok: true,
      state: 'stopped',
      sentenceIndex: 0
    })
    expect(streamCalls.every((call) => call.signal.aborted)).toBe(true)

    await expect(dispatch(controlMessage('previous', 'stop-pending'))).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'The requested sentence index is out of range.'
      }
    })
  })

  it('disposes the queue and rejects every later control for its playback ID', async () => {
    const startResponse = startQueue('disposed-session', ['Disposable.'])
    await waitForStreamTexts(['Disposable.'])
    MockMediaSource.instances[0].open()
    emitAudio('Disposable.', [1, 2])
    await startResponse

    await expect(dispatch(controlMessage('dispose', 'disposed-session'))).resolves.toMatchObject({
      ok: true,
      state: 'stopped'
    })
    currentPlaybackId = null
    expect(streamCalls[0].signal.aborted).toBe(true)
    expect(revokeObjectUrlMock).toHaveBeenCalled()

    await expect(dispatch(controlMessage('resume', 'disposed-session'))).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'The requested playback session is no longer active.'
      }
    })
  })

  it('holds playback until enough audio is buffered to survive a late Edge burst', async () => {
    // Edge sends ~120 ms MP3 frames, so one frame cannot start playback safely.
    MockSourceBuffer.secondsPerByte = 0.12
    const startResponse = startQueue('preroll-gate', ['Streaming sentence.'])
    await waitForStreamTexts(['Streaming sentence.'])
    MockMediaSource.instances[0].open()

    emitAudio('Streaming sentence.', [1])
    await Promise.resolve()
    expect(MockAudio.instances[0].play).not.toHaveBeenCalled()

    // Both frames arrive while the SourceBuffer is still updating.
    emitAudio('Streaming sentence.', [2, 3, 4])
    emitAudio('Streaming sentence.', [5, 6, 7])
    MockMediaSource.instances[0].sourceBuffer.finishAppend()

    await expect(startResponse).resolves.toMatchObject({
      ok: true,
      state: 'playing',
      sentenceIndex: 0
    })
    expect(MockAudio.instances[0].play).toHaveBeenCalledOnce()
    // Every frame that arrived during one update cycle is appended together.
    expect(MockMediaSource.instances[0].sourceBuffer.appendedAudio).toEqual([
      [1],
      [2, 3, 4, 5, 6, 7]
    ])
  })

  it('starts a sentence shorter than the preroll as soon as its stream completes', async () => {
    MockSourceBuffer.secondsPerByte = 0.12
    const startResponse = startQueue('short-sentence', ['Yes.'])
    await waitForStreamTexts(['Yes.'])
    MockMediaSource.instances[0].open()

    emitAudio('Yes.', [1])
    MockMediaSource.instances[0].sourceBuffer.finishAppend()
    await Promise.resolve()
    expect(MockAudio.instances[0].play).not.toHaveBeenCalled()

    completeStream('Yes.')

    await expect(startResponse).resolves.toMatchObject({
      ok: true,
      state: 'playing',
      sentenceIndex: 0
    })
    expect(MockMediaSource.instances[0].endOfStream).toHaveBeenCalled()
  })

  it('buffers the stream into a Blob when incremental MP3 append is unavailable', async () => {
    vi.stubGlobal('MediaSource', undefined)
    const startResponse = startQueue('buffered-fallback', ['Buffered sentence.'])
    await waitForStreamTexts(['Buffered sentence.'])
    emitBoundaries('Buffered sentence.', [boundary('Buffered')])
    emitAudio('Buffered sentence.', [1, 2, 3])
    completeStream('Buffered sentence.')

    await expect(startResponse).resolves.toMatchObject({
      ok: true,
      state: 'playing',
      sentenceIndex: 0,
      wordBoundaries: [boundary('Buffered')]
    })
    expect(MockAudio.instances[0]?.play).toHaveBeenCalledOnce()
    expect(createObjectUrlMock).toHaveBeenCalledOnce()
  })

})

function createStreamCall(
  request: SpeechSynthesisRequest,
  handlers: SpeechSynthesisStreamHandlers,
  signal: AbortSignal
): Promise<SpeechSynthesisStreamSummary> {
  return new Promise((resolve, reject) => {
    const call: StreamCall = {
      request,
      handlers,
      signal,
      boundaries: [],
      resolve,
      reject
    }
    streamCalls.push(call)
    signal.addEventListener(
      'abort',
      () => reject(new TtsProviderError('aborted', 'Speech synthesis was stopped.')),
      { once: true }
    )
  })
}

function startQueue(
  playbackId: string,
  sentences: string[],
  startIndex?: number,
  engineTarget: object = { engine: 'edge', kokoroBaseUrl: 'http://localhost:8880' }
): Promise<TtsCommandResponse> {
  currentPlaybackId = playbackId
  return dispatch({
    target: 'offscreen',
    action: 'offscreen:tts:start-queue',
    playbackId,
    sentences,
    voice: 'en-US-AriaNeural',
    rate: 1,
    ...engineTarget,
    ...(startIndex === undefined ? {} : { startIndex })
  })
}

function controlMessage(
  action: 'pause' | 'resume' | 'stop' | 'previous' | 'next' | 'dispose',
  playbackId: string
): object {
  return {
    target: 'offscreen',
    action: `offscreen:tts:${action}`,
    playbackId
  }
}

function dispatch(message: unknown): Promise<TtsCommandResponse> {
  if (!runtimeListener) throw new Error('The offscreen listener was not registered.')
  return new Promise((resolve, reject) => {
    try {
      const keepChannelOpen = runtimeListener?.(
        message,
        { id: 'test-extension-id' },
        resolve
      )
      if (!keepChannelOpen) reject(new Error('The message was not accepted.'))
    } catch (error) {
      reject(error)
    }
  })
}

async function waitForStreamTexts(texts: string[]): Promise<void> {
  await vi.waitFor(() => {
    for (const text of texts) expect(findStream(text)).toBeDefined()
  })
}

function findStream(text: string): StreamCall | undefined {
  return streamCalls.find((call) => call.request.text === text)
}

function emitAudio(text: string, bytes: number[]): void {
  const call = requireStream(text)
  call.handlers.onAudioChunk({
    audio: new Uint8Array(bytes),
    contentType: 'audio/mpeg'
  })
}

function emitBoundaries(text: string, boundaries: WordBoundary[]): void {
  const call = requireStream(text)
  call.boundaries.push(...boundaries)
  call.handlers.onWordBoundaries(boundaries)
}

function completeStream(text: string): void {
  const call = requireStream(text)
  call.resolve({
    contentType: 'audio/mpeg',
    audioBytes: 1,
    wordBoundaries: [...call.boundaries]
  })
}

function requireStream(text: string): StreamCall {
  const call = findStream(text)
  if (!call) throw new Error(`No synthesis stream exists for: ${text}`)
  return call
}

function boundary(
  word: string,
  startTime = 0.1,
  endTime = 0.4
): WordBoundary {
  return { word, startTime, endTime }
}
