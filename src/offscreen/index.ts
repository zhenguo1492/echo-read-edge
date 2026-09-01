import type { TtsEngineId } from '@/lib/tts-engines'
import { EdgeTtsProvider } from '@/providers/edge-tts-provider'
import { KokoroTtsProvider } from '@/providers/kokoro-tts-provider'
import {
  TtsProviderError,
  type StreamingTtsProvider,
  type WordBoundary
} from '@/providers/tts-provider'
import {
  isOffscreenTtsRequest,
  type OffscreenTtsControlRequest,
  type OffscreenTtsQueueStartRequest,
  type OffscreenTtsStartRequest,
  type TtsCommandResponse,
  type TtsActiveWordEvent,
  type TtsPlaybackEvent,
  type TtsPlaybackState,
  type TtsRuntimeError,
  type TtsWordBoundariesEvent
} from '@/shared/messages'
import {
  releaseAudioOutputPrimer,
  startAudioOutputPrimer
} from './audio-output-warmup'
import {
  SentenceAudioCache,
  createSentenceAudioCacheKey,
  createSentenceAudioFingerprint,
  type AudioCacheKey,
  type CachedSentenceAudio,
  type SentenceAudioFingerprint
} from './sentence-audio-cache'

const STREAM_CONTENT_TYPE = 'audio/mpeg'
const PREFETCH_AHEAD = 2
/**
 * Edge delivers ~120 ms MP3 frames in bursts separated by hundreds of
 * milliseconds, so starting on the first frame leaves Chrome one late burst away
 * from an audible mid-word rebuffer. Playback waits for this much buffered audio
 * or for the complete sentence, whichever comes first.
 */
const PREROLL_SECONDS = 0.8

type SentenceState =
  | 'waiting'
  | 'synthesizing'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'played'
  | 'failed'
  | 'evicted'

interface SentenceEntry {
  index: number
  text: string
  fingerprint: SentenceAudioFingerprint
  cacheKey: AudioCacheKey
  state: SentenceState
  error: TtsRuntimeError | null
}

/** One direct Edge synthesis shared by every equal sentence fingerprint. */
interface SynthesisJob {
  cacheKey: AudioCacheKey
  sentenceIndexes: Set<number>
  abortController: AbortController
  chunks: Array<Uint8Array<ArrayBuffer>>
  wordBoundaries: WordBoundary[]
  complete: boolean
  error: TtsRuntimeError | null
  promise: Promise<CachedSentenceAudio> | null
}

/** Mutable or cached bytes consumed by one sentence-specific media binding. */
interface PlayableSource {
  cacheKey: AudioCacheKey
  chunks: readonly Uint8Array[]
  wordBoundaries: readonly WordBoundary[]
  isComplete(): boolean
  completion: Promise<CachedSentenceAudio>
}

interface MediaBinding {
  operationVersion: number
  sentenceIndex: number
  cacheKey: AudioCacheKey
  source: PlayableSource
  audio: HTMLAudioElement
  audioUrl: string
  mediaSource: MediaSource | null
  sourceBuffer: SourceBuffer | null
  nextChunkIndex: number
  playbackRequested: boolean
  started: boolean
  publishedBoundaryCount: number
  activeWordIndex: number
  wordSyncFrame: number | null
  initialStart: boolean
  resolveStart: (wordBoundaries: WordBoundary[]) => void
  rejectStart: (error: unknown) => void
}

/**
 * One retained session owns navigation, synthesis jobs, encoded audio cache, and
 * the current media element. Stopped and ended sessions remain addressable.
 */
interface PlaybackSession {
  playbackId: string
  /** Resolved once per session so every sentence uses one engine and host. */
  provider: StreamingTtsProvider
  sentences: SentenceEntry[]
  currentIndex: number
  state: TtsPlaybackState
  operationVersion: number
  jobs: Map<AudioCacheKey, SynthesisJob>
  cache: SentenceAudioCache
  media: MediaBinding | null
}

let activeSession: PlaybackSession | null = null

/**
 * Creating one provider per session keeps the configured host that the service
 * worker validated bound to the sentences it was sent with, even if the reader
 * changes the setting while a queue is still playing.
 */
function createProvider(engine: TtsEngineId, kokoroBaseUrl: string): StreamingTtsProvider {
  return engine === 'kokoro'
    ? new KokoroTtsProvider({ baseUrl: kokoroBaseUrl })
    : new EdgeTtsProvider()
}

// Background creates this document on the first playback request, so the output
// stream is opened here rather than during the first audible sentence.
startAudioOutputPrimer()

/** Accepts only validated commands explicitly targeted at this hidden runtime. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false

  if (!isOffscreenTtsRequest(message)) return false

  if (
    message.action === 'offscreen:tts:start' ||
    message.action === 'offscreen:tts:start-queue'
  ) {
    void startPlaybackSession(message).then(sendResponse)
    return true
  }

  void controlPlaybackSession(message).then(sendResponse)
  return true
})

/** Creates one queue for both the popup's single text and content sentence lists. */
async function startPlaybackSession(
  message: OffscreenTtsStartRequest | OffscreenTtsQueueStartRequest
): Promise<TtsCommandResponse> {
  // The primer runs for the whole synthesis wait so the sentence never has to
  // open an output stream of its own.
  startAudioOutputPrimer()
  await disposeActiveSession(true)

  const texts = message.action === 'offscreen:tts:start' ? [message.text] : message.sentences
  const startIndex =
    message.action === 'offscreen:tts:start-queue'
      ? (message.startIndex ?? 0)
      : 0
  const fingerprints = texts.map((text) =>
    createSentenceAudioFingerprint({ text, voice: message.voice, rate: message.rate })
  )
  const cacheKeys = await Promise.all(fingerprints.map(createSentenceAudioCacheKey))

  const session: PlaybackSession = {
    playbackId: message.playbackId,
    provider: createProvider(message.engine, message.kokoroBaseUrl),
    sentences: texts.map((text, index) => ({
      index,
      text,
      fingerprint: fingerprints[index],
      cacheKey: cacheKeys[index],
      state: 'waiting',
      error: null
    })),
    currentIndex: startIndex,
    state: 'synthesizing',
    operationVersion: 1,
    jobs: new Map(),
    cache: new SentenceAudioCache({
      // The callback runs only after construction, when the session binding is
      // initialized and can safely identify the currently consumed cache key.
      isProtected: (cacheKey) => session.media?.cacheKey === cacheKey
    }),
    media: null
  }
  activeSession = session

  try {
    const wordBoundaries = await activateSentence(session, startIndex, true)
    return {
      ok: true,
      playbackId: session.playbackId,
      state: 'playing',
      sentenceIndex: startIndex,
      wordBoundaries
    }
  } catch (error) {
    const runtimeError = normalizeError(error)
    if (activeSession === session) {
      activeSession = null
      abortJobsImmediately(session)
      disposeCurrentMedia(session)
      session.cache.clear()
    }
    return { ok: false, error: runtimeError }
  }
}

/** Applies controls without replacing the stable queue session. */
async function controlPlaybackSession(
  message: OffscreenTtsControlRequest
): Promise<TtsCommandResponse> {
  const session = activeSession
  if (!session || session.playbackId !== message.playbackId) {
    return failure('invalid-request', 'The requested playback session is no longer active.')
  }

  switch (message.action) {
    case 'offscreen:tts:pause':
      return pauseSession(session)
    case 'offscreen:tts:resume':
      return await resumeSession(session)
    case 'offscreen:tts:stop':
      return await stopSession(session)
    case 'offscreen:tts:previous':
      return await navigateSession(session, session.currentIndex - 1)
    case 'offscreen:tts:next':
      return await navigateSession(session, session.currentIndex + 1)
    case 'offscreen:tts:play-sentence':
      return await navigateSession(session, message.sentenceIndex)
    case 'offscreen:tts:dispose':
      await disposeActiveSession(true)
      return {
        ok: true,
        playbackId: message.playbackId,
        state: 'stopped',
        sentenceIndex: session.currentIndex
      }
  }
}

function pauseSession(session: PlaybackSession): TtsCommandResponse {
  const media = session.media
  if (!media || !media.started) {
    return failure('invalid-request', 'Audio playback has not started yet.')
  }

  media.audio.pause()
  stopWordSynchronization(media)
  session.state = 'paused'
  session.sentences[session.currentIndex].state = 'paused'
  publishState(session, 'paused', media.audio.currentTime)
  return success(session, 'paused')
}

async function resumeSession(session: PlaybackSession): Promise<TtsCommandResponse> {
  const media = session.media
  if (session.state === 'paused' && media) {
    try {
      await media.audio.play()
      startWordSynchronization(session, media)
      session.state = 'playing'
      session.sentences[session.currentIndex].state = 'playing'
      publishState(session, 'playing', media.audio.currentTime)
      return success(session, 'playing')
    } catch (error) {
      return failControl(session, error)
    }
  }

  if (session.state !== 'stopped' && session.state !== 'ended') {
    return failure('invalid-request', 'The playback session cannot resume now.')
  }

  return await navigateSession(session, session.currentIndex)
}

/** Stops current media and unfinished synthesis while retaining complete cache. */
async function stopSession(session: PlaybackSession): Promise<TtsCommandResponse> {
  const currentTime = session.media?.audio.currentTime
  session.operationVersion += 1
  disposeCurrentMedia(session)
  await abortJobsAndWait(session)
  refreshSentenceStates(session)
  session.state = 'stopped'
  publishState(session, 'stopped', currentTime)
  return success(session, 'stopped')
}

/** Moves the cursor, then promotes cached or already-streaming sentence audio. */
async function navigateSession(
  session: PlaybackSession,
  sentenceIndex: number
): Promise<TtsCommandResponse> {
  if (sentenceIndex < 0 || sentenceIndex >= session.sentences.length) {
    return failure('invalid-request', 'The requested sentence index is out of range.')
  }

  session.operationVersion += 1
  disposeCurrentMedia(session)
  session.currentIndex = sentenceIndex
  await abortJobsOutsideWindow(session)

  try {
    const wordBoundaries = await activateSentence(session, sentenceIndex, false)
    return {
      ...success(session, 'playing'),
      wordBoundaries
    }
  } catch (error) {
    return { ok: false, error: normalizeError(error) }
  }
}

/** Starts current playback; the look-ahead window opens once it is audible. */
async function activateSentence(
  session: PlaybackSession,
  sentenceIndex: number,
  initialStart: boolean
): Promise<WordBoundary[]> {
  if (activeSession !== session) throw createAbortError()

  const sentence = session.sentences[sentenceIndex]
  sentence.state = 'synthesizing'
  sentence.error = null
  session.state = 'synthesizing'
  publishState(session, 'synthesizing')

  const source = getOrStartSource(session, sentence)

  return supportsIncrementalMp3Playback()
    ? await startMediaSourceSentence(session, sentence, source, initialStart)
    : await startBufferedSentence(session, sentence, source, initialStart)
}

/** Returns complete cached bytes or starts one deduplicated Edge synthesis job. */
function getOrStartSource(
  session: PlaybackSession,
  sentence: SentenceEntry
): PlayableSource {
  const cached = session.cache.getByKey(sentence.cacheKey, sentence.fingerprint)
  if (cached) {
    sentence.state = 'ready'
    return sourceFromCache(cached)
  }

  const existingJob = session.jobs.get(sentence.cacheKey)
  if (existingJob) {
    existingJob.sentenceIndexes.add(sentence.index)
    sentence.state = 'synthesizing'
    return sourceFromJob(existingJob)
  }

  const job: SynthesisJob = {
    cacheKey: sentence.cacheKey,
    sentenceIndexes: new Set([sentence.index]),
    abortController: new AbortController(),
    chunks: [],
    wordBoundaries: [],
    complete: false,
    error: null,
    promise: null
  }
  session.jobs.set(job.cacheKey, job)
  sentence.state = 'synthesizing'

  const promise = session.cache.getOrCreate(
    sentence.fingerprint,
    async () => {
      const summary = await session.provider.synthesizeStream(
        {
          text: sentence.text,
          voice: sentence.fingerprint.voice,
          rate: Number(sentence.fingerprint.rate)
        },
        {
          onAudioChunk: ({ audio }) => {
            if (activeSession !== session || job.abortController.signal.aborted) return
            job.chunks.push(copyBytes(audio))
            pumpCurrentMedia(session, job.cacheKey)
          },
          onWordBoundaries: (boundaries) => {
            if (activeSession !== session || job.abortController.signal.aborted) return
            job.wordBoundaries.push(...boundaries.map(copyWordBoundary))
            publishCurrentBoundaryBatch(session, job.cacheKey, boundaries)
          }
        },
        job.abortController.signal
      )
      job.wordBoundaries.splice(
        0,
        job.wordBoundaries.length,
        ...summary.wordBoundaries.map(copyWordBoundary)
      )
      job.complete = true
      pumpCurrentMedia(session, job.cacheKey)
      return {
        chunks: job.chunks,
        wordBoundaries: job.wordBoundaries
      }
    }
  )
  job.promise = promise

  void promise.then(
    (entry) => {
      job.complete = true
      markJobReady(session, job, entry)
      pumpCurrentMedia(session, job.cacheKey)
    },
    (error: unknown) => {
      job.error = normalizeError(error)
      markJobFailed(session, job, job.error)
      rejectCurrentMedia(session, job.cacheKey, error)
    }
  ).finally(() => {
    if (session.jobs.get(job.cacheKey) === job) session.jobs.delete(job.cacheKey)
  })

  return sourceFromJob(job)
}

/**
 * Starts only missing jobs in the current sentence plus two-future window.
 *
 * Deferred until the current sentence is audible: Edge synthesis is not rate
 * limited here, so three sockets opened at once share the bandwidth the first
 * sentence needs to reach its preroll, and the reader waits longer to hear
 * anything at all. Look-ahead only has to stay ahead of a playing sentence.
 */
function startPrefetchWindow(session: PlaybackSession): void {
  const finalIndex = Math.min(
    session.sentences.length - 1,
    session.currentIndex + PREFETCH_AHEAD
  )
  for (let index = session.currentIndex + 1; index <= finalIndex; index += 1) {
    const source = getOrStartSource(session, session.sentences[index])
    void source.completion.catch(() => {
      // A future failure is retained on its sentence and retried if promoted.
    })
  }
}

function sourceFromCache(entry: CachedSentenceAudio): PlayableSource {
  return {
    cacheKey: entry.cacheKey,
    chunks: entry.chunks,
    wordBoundaries: entry.wordBoundaries,
    isComplete: () => true,
    completion: Promise.resolve(entry)
  }
}

function sourceFromJob(job: SynthesisJob): PlayableSource {
  if (!job.promise) throw new Error('The sentence synthesis job was not initialized.')
  return {
    cacheKey: job.cacheKey,
    chunks: job.chunks,
    wordBoundaries: job.wordBoundaries,
    isComplete: () => job.complete,
    completion: job.promise
  }
}

/** Streams the current source into a sentence-specific MediaSource. */
function startMediaSourceSentence(
  session: PlaybackSession,
  sentence: SentenceEntry,
  source: PlayableSource,
  initialStart: boolean
): Promise<WordBoundary[]> {
  const mediaSource = new MediaSource()
  const audioUrl = URL.createObjectURL(mediaSource)
  const audio = new Audio(audioUrl)
  const deferred = createDeferred<WordBoundary[]>()
  const binding: MediaBinding = {
    operationVersion: session.operationVersion,
    sentenceIndex: sentence.index,
    cacheKey: sentence.cacheKey,
    source,
    audio,
    audioUrl,
    mediaSource,
    sourceBuffer: null,
    nextChunkIndex: 0,
    playbackRequested: false,
    started: false,
    publishedBoundaryCount: 0,
    activeWordIndex: -1,
    wordSyncFrame: null,
    initialStart,
    resolveStart: deferred.resolve,
    rejectStart: deferred.reject
  }
  session.media = binding
  attachAudioLifecycle(session, binding)

  mediaSource.addEventListener(
    'sourceopen',
    () => {
      if (!isCurrentBinding(session, binding)) return
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(STREAM_CONTENT_TYPE)
        binding.sourceBuffer = sourceBuffer
        sourceBuffer.addEventListener('updateend', () => pumpMediaBinding(session, binding))
        sourceBuffer.addEventListener('error', () => {
          rejectCurrentMedia(
            session,
            binding.cacheKey,
            new Error('Chrome could not append the streaming MP3 data.')
          )
        })
        pumpMediaBinding(session, binding)
      } catch (error) {
        rejectCurrentMedia(session, binding.cacheKey, error)
      }
    },
    { once: true }
  )

  void source.completion.then(
    () => pumpMediaBinding(session, binding),
    (error: unknown) => rejectCurrentMedia(session, binding.cacheKey, error)
  )
  return deferred.promise
}

/** Buffers one complete sentence when MediaSource MP3 append is unavailable. */
async function startBufferedSentence(
  session: PlaybackSession,
  sentence: SentenceEntry,
  source: PlayableSource,
  initialStart: boolean
): Promise<WordBoundary[]> {
  const operationVersion = session.operationVersion
  const entry = await source.completion
  if (!isCurrentOperation(session, operationVersion, sentence.index)) {
    throw createAbortError()
  }

  const audioBlob = new Blob(
    entry.chunks.map((chunk) => copyBytes(chunk).buffer),
    { type: entry.contentType }
  )
  const audioUrl = URL.createObjectURL(audioBlob)
  const audio = new Audio(audioUrl)
  const deferred = createDeferred<WordBoundary[]>()
  const binding: MediaBinding = {
    operationVersion,
    sentenceIndex: sentence.index,
    cacheKey: sentence.cacheKey,
    source: sourceFromCache(entry),
    audio,
    audioUrl,
    mediaSource: null,
    sourceBuffer: null,
    nextChunkIndex: entry.chunks.length,
    playbackRequested: true,
    started: false,
    publishedBoundaryCount: 0,
    activeWordIndex: -1,
    wordSyncFrame: null,
    initialStart,
    resolveStart: deferred.resolve,
    rejectStart: deferred.reject
  }
  session.media = binding
  attachAudioLifecycle(session, binding)

  void audio.play().then(
    () => markPlaybackStarted(session, binding),
    (error: unknown) => rejectCurrentMedia(session, binding.cacheKey, error)
  )
  return deferred.promise
}

/** Appends every arrived chunk per SourceBuffer update cycle. */
function pumpMediaBinding(session: PlaybackSession, binding: MediaBinding): void {
  if (!isCurrentBinding(session, binding)) return
  const sourceBuffer = binding.sourceBuffer
  const mediaSource = binding.mediaSource
  if (!sourceBuffer || !mediaSource || sourceBuffer.updating) return

  // Appending the whole arrived burst at once reaches the preroll in a single
  // update cycle instead of one 120 ms frame per event-loop turn.
  const pendingChunks = binding.source.chunks.slice(binding.nextChunkIndex)
  if (pendingChunks.length > 0) {
    try {
      sourceBuffer.appendBuffer(mergeChunks(pendingChunks))
      binding.nextChunkIndex += pendingChunks.length
    } catch (error) {
      rejectCurrentMedia(session, binding.cacheKey, error)
      return
    }
    requestMediaPlayback(session, binding)
    return
  }

  if (binding.source.isComplete() && mediaSource.readyState === 'open') {
    try {
      mediaSource.endOfStream()
    } catch (error) {
      rejectCurrentMedia(session, binding.cacheKey, error)
      return
    }
  }
  requestMediaPlayback(session, binding)
}

function pumpCurrentMedia(session: PlaybackSession, cacheKey: AudioCacheKey): void {
  const binding = session.media
  if (binding?.cacheKey === cacheKey) pumpMediaBinding(session, binding)
}

function requestMediaPlayback(session: PlaybackSession, binding: MediaBinding): void {
  if (binding.playbackRequested || !isCurrentBinding(session, binding)) return
  if (!hasSufficientPreroll(binding)) return
  binding.playbackRequested = true
  void binding.audio.play().then(
    () => markPlaybackStarted(session, binding),
    (error: unknown) => rejectCurrentMedia(session, binding.cacheKey, error)
  )
}

/**
 * A fully appended sentence can never starve, so it starts immediately. A
 * sentence still arriving must first hold enough audio to cover one late burst.
 */
function hasSufficientPreroll(binding: MediaBinding): boolean {
  if (
    binding.source.isComplete() &&
    binding.nextChunkIndex >= binding.source.chunks.length
  ) {
    return true
  }

  const buffered = binding.sourceBuffer?.buffered
  if (!buffered || buffered.length === 0) return false
  return buffered.end(buffered.length - 1) - buffered.start(0) >= PREROLL_SECONDS
}

/** Publishes the sentence transition before any indexed boundary batches. */
function markPlaybackStarted(session: PlaybackSession, binding: MediaBinding): void {
  if (!isCurrentBinding(session, binding) || binding.started) return
  binding.started = true
  // The primer can stop now that this sentence owns a running output stream.
  releaseAudioOutputPrimer()
  binding.publishedBoundaryCount = binding.source.wordBoundaries.length
  session.state = 'playing'
  session.sentences[binding.sentenceIndex].state = 'playing'
  publishState(session, 'playing', binding.audio.currentTime)
  startWordSynchronization(session, binding)

  const initialBoundaries = binding.source.wordBoundaries.map(copyWordBoundary)
  if (!binding.initialStart) {
    publishWordBoundaries(session, binding.sentenceIndex, initialBoundaries)
  }
  binding.resolveStart(initialBoundaries)

  // Look-ahead opens only now, so nothing competed with this sentence's audio.
  startPrefetchWindow(session)
}

function publishCurrentBoundaryBatch(
  session: PlaybackSession,
  cacheKey: AudioCacheKey,
  boundaries: readonly WordBoundary[]
): void {
  const binding = session.media
  if (!binding || binding.cacheKey !== cacheKey || !binding.started) return
  binding.publishedBoundaryCount += boundaries.length
  publishWordBoundaries(session, binding.sentenceIndex, boundaries)
}

function attachAudioLifecycle(
  session: PlaybackSession,
  binding: MediaBinding
): void {
  binding.audio.addEventListener(
    'timeupdate',
    () => publishActiveWord(session, binding)
  )
  binding.audio.addEventListener(
    'ended',
    () => {
      if (!isCurrentBinding(session, binding)) return
      void handleSentenceEnded(session, binding)
    },
    { once: true }
  )
  binding.audio.addEventListener(
    'error',
    () => {
      const error = new Error(
        binding.audio.error?.message || 'The synthesized audio could not be played.'
      )
      rejectCurrentMedia(session, binding.cacheKey, error)
    },
    { once: true }
  )
}

/** Advances locally; content and background do not start another TTS request. */
async function handleSentenceEnded(
  session: PlaybackSession,
  binding: MediaBinding
): Promise<void> {
  session.sentences[binding.sentenceIndex].state = 'played'
  disposeCurrentMedia(session)

  const nextIndex = binding.sentenceIndex + 1
  if (nextIndex >= session.sentences.length) {
    session.state = 'ended'
    publishState(session, 'ended', binding.audio.currentTime)
    return
  }

  session.currentIndex = nextIndex
  session.operationVersion += 1
  await abortJobsOutsideWindow(session)
  try {
    await activateSentence(session, nextIndex, false)
  } catch {
    // activateSentence publishes the typed failure for the retained session.
  }
}

function rejectCurrentMedia(
  session: PlaybackSession,
  cacheKey: AudioCacheKey,
  error: unknown
): void {
  const binding = session.media
  if (!binding || binding.cacheKey !== cacheKey || !isCurrentBinding(session, binding)) {
    return
  }

  binding.rejectStart(error)
  const runtimeError = normalizeError(error)
  session.sentences[binding.sentenceIndex].state = 'failed'
  session.sentences[binding.sentenceIndex].error = runtimeError
  session.state = 'stopped'
  const currentTime = binding.audio.currentTime
  disposeCurrentMedia(session)
  abortJobsImmediately(session)
  publishState(session, 'stopped', currentTime, runtimeError)
}

function markJobReady(
  session: PlaybackSession,
  job: SynthesisJob,
  entry: CachedSentenceAudio
): void {
  for (const sentence of session.sentences) {
    if (sentence.cacheKey !== job.cacheKey || sentence.state === 'playing') continue
    sentence.state = session.cache.getByKey(job.cacheKey, sentence.fingerprint)
      ? 'ready'
      : 'evicted'
    sentence.error = null
  }
  void entry
}

function markJobFailed(
  session: PlaybackSession,
  job: SynthesisJob,
  error: TtsRuntimeError
): void {
  for (const sentenceIndex of job.sentenceIndexes) {
    const sentence = session.sentences[sentenceIndex]
    if (!sentence || sentence.state === 'playing') continue
    sentence.state = 'failed'
    sentence.error = error
  }
}

/** Cancels jobs that cannot serve the current-plus-two look-ahead window. */
async function abortJobsOutsideWindow(session: PlaybackSession): Promise<void> {
  const allowedKeys = new Set(
    session.sentences
      .slice(session.currentIndex, session.currentIndex + PREFETCH_AHEAD + 1)
      .map((sentence) => sentence.cacheKey)
  )
  await abortSelectedJobs(session, (job) => !allowedKeys.has(job.cacheKey))
}

async function abortJobsAndWait(session: PlaybackSession): Promise<void> {
  await abortSelectedJobs(session, () => true)
}

async function abortSelectedJobs(
  session: PlaybackSession,
  shouldAbort: (job: SynthesisJob) => boolean
): Promise<void> {
  const jobs = [...session.jobs.values()].filter(shouldAbort)
  for (const job of jobs) job.abortController.abort()
  await Promise.allSettled(
    jobs.flatMap((job) => (job.promise ? [job.promise] : []))
  )
}

function abortJobsImmediately(session: PlaybackSession): void {
  for (const job of session.jobs.values()) job.abortController.abort()
}

function refreshSentenceStates(session: PlaybackSession): void {
  for (const sentence of session.sentences) {
    if (sentence.state !== 'synthesizing' && sentence.state !== 'failed') continue
    sentence.state = session.cache.getByKey(sentence.cacheKey, sentence.fingerprint)
      ? 'ready'
      : 'waiting'
    sentence.error = null
  }
}

/** Releases only the current HTML media objects, preserving queue and cache. */
function disposeCurrentMedia(session: PlaybackSession): void {
  const binding = session.media
  if (!binding) return
  session.media = null
  stopWordSynchronization(binding)

  if (
    binding.sourceBuffer?.updating &&
    binding.mediaSource?.readyState === 'open'
  ) {
    try {
      binding.sourceBuffer.abort()
    } catch {
      // Chrome may close MediaSource between the readyState check and abort().
    }
  }
  binding.audio.pause()
  binding.audio.removeAttribute('src')
  binding.audio.load()
  URL.revokeObjectURL(binding.audioUrl)
}

/** Permanently destroys the current session and its complete audio cache. */
async function disposeActiveSession(publishStopped: boolean): Promise<void> {
  const session = activeSession
  if (!session) return
  activeSession = null

  const currentTime = session.media?.audio.currentTime
  abortJobsImmediately(session)
  await Promise.allSettled(
    [...session.jobs.values()].flatMap((job) => (job.promise ? [job.promise] : []))
  )
  disposeCurrentMedia(session)
  session.cache.clear()
  if (publishStopped) publishState(session, 'stopped', currentTime)
}

function isCurrentBinding(
  session: PlaybackSession,
  binding: MediaBinding
): boolean {
  return (
    activeSession === session &&
    session.media === binding &&
    session.operationVersion === binding.operationVersion &&
    session.currentIndex === binding.sentenceIndex
  )
}

function isCurrentOperation(
  session: PlaybackSession,
  operationVersion: number,
  sentenceIndex: number
): boolean {
  return (
    activeSession === session &&
    session.operationVersion === operationVersion &&
    session.currentIndex === sentenceIndex
  )
}

function supportsIncrementalMp3Playback(): boolean {
  return (
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported(STREAM_CONTENT_TYPE)
  )
}

function success(
  session: PlaybackSession,
  state: TtsPlaybackState
): Extract<TtsCommandResponse, { ok: true }> {
  return {
    ok: true,
    playbackId: session.playbackId,
    state,
    sentenceIndex: session.currentIndex
  }
}

function failControl(
  session: PlaybackSession,
  error: unknown
): TtsCommandResponse {
  const runtimeError = normalizeError(error)
  session.state = 'stopped'
  publishState(session, 'stopped', session.media?.audio.currentTime, runtimeError)
  return { ok: false, error: runtimeError }
}

/** Publishes one sentence-indexed metadata batch to the owning content tab. */
function publishWordBoundaries(
  session: PlaybackSession,
  sentenceIndex: number,
  wordBoundaries: readonly WordBoundary[]
): void {
  if (wordBoundaries.length === 0) return
  const event: TtsWordBoundariesEvent = {
    action: 'tts:boundaries',
    playbackId: session.playbackId,
    sentenceIndex,
    wordBoundaries: wordBoundaries.map(copyWordBoundary)
  }
  void chrome.runtime.sendMessage(event).catch(() => {
    // Playback remains valid when no visible context needs highlighting.
  })
}

/**
 * Tracks the offscreen-owned audio clock and sends a message only when the active
 * WordBoundary index changes. RAF provides responsive highlighting while the
 * native timeupdate listener remains a fallback in throttled hidden documents.
 */
function startWordSynchronization(
  session: PlaybackSession,
  binding: MediaBinding
): void {
  if (binding.wordSyncFrame !== null) return

  const synchronize = (): void => {
    binding.wordSyncFrame = null
    if (!isCurrentBinding(session, binding) || session.state !== 'playing') return
    publishActiveWord(session, binding)
    binding.wordSyncFrame = requestAnimationFrame(synchronize)
  }
  synchronize()
}

function stopWordSynchronization(binding: MediaBinding): void {
  if (binding.wordSyncFrame !== null) cancelAnimationFrame(binding.wordSyncFrame)
  binding.wordSyncFrame = null
  binding.activeWordIndex = -1
}

function publishActiveWord(
  session: PlaybackSession,
  binding: MediaBinding
): void {
  if (!isCurrentBinding(session, binding) || session.state !== 'playing') return
  const wordIndex = findActiveWordIndex(
    binding.source.wordBoundaries,
    binding.audio.currentTime
  )
  if (wordIndex < 0 || wordIndex === binding.activeWordIndex) return
  binding.activeWordIndex = wordIndex

  const event: TtsActiveWordEvent = {
    action: 'tts:word',
    playbackId: session.playbackId,
    sentenceIndex: binding.sentenceIndex,
    wordIndex
  }
  void chrome.runtime.sendMessage(event).catch(() => {
    // Audio playback remains valid when no content context needs highlighting.
  })
}

/** Matches the legacy mapper's behavior across leading silence and word gaps. */
function findActiveWordIndex(
  boundaries: readonly WordBoundary[],
  currentTime: number
): number {
  if (boundaries.length === 0) return -1
  if (currentTime < boundaries[0].startTime) return 0

  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index]
    if (currentTime >= boundary.startTime && currentTime < boundary.endTime) {
      return index
    }
  }

  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    if (currentTime >= boundaries[index].startTime) return index
  }
  return 0
}

/** Publishes state without requiring the popup or content script to stay open. */
function publishState(
  session: PlaybackSession,
  state: TtsPlaybackState,
  currentTime?: number,
  error?: TtsRuntimeError
): void {
  const event: TtsPlaybackEvent = {
    action: 'tts:state',
    playbackId: session.playbackId,
    state,
    sentenceIndex: session.currentIndex,
    ...(currentTime === undefined ? {} : { currentTime }),
    ...(error ? { error } : {})
  }
  void chrome.runtime.sendMessage(event).catch(() => {
    // The offscreen session remains valid without an event consumer.
  })
}

function normalizeError(error: unknown): TtsRuntimeError {
  if (error instanceof TtsProviderError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { code: 'aborted', message: error.message || 'Speech synthesis was stopped.' }
  }
  return {
    code: 'playback-failed',
    message: error instanceof Error ? error.message : 'The hidden audio runtime failed.'
  }
}

function failure(
  code: TtsRuntimeError['code'],
  message: string
): TtsCommandResponse {
  return { ok: false, error: { code, message } }
}

/** Copies one append-ready buffer out of the live chunk list. */
function mergeChunks(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  if (chunks.length === 1) return copyBytes(chunks[0])

  const merged = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  )
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

function copyWordBoundary(boundary: WordBoundary): WordBoundary {
  return {
    word: boundary.word,
    startTime: boundary.startTime,
    endTime: boundary.endTime
  }
}

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function createAbortError(): DOMException {
  return new DOMException('The playback operation was replaced.', 'AbortError')
}
