import { beforeEach, describe, expect, it } from 'vitest'

import {
  activePlaybackId,
  applyTtsRuntimeEvent,
  beginPlayback,
  clearActivePlaybackSession,
  clearPlaybackError,
  currentIndex,
  isStartingPlayback,
  currentSentence,
  currentWordIndex,
  errorMessage,
  isIdle,
  isPaused,
  isPlaying,
  nextSentence,
  playState,
  previousSentence,
  progress,
  resetPlayback,
  sentenceStatuses,
  sentenceWordTimestamps,
  sentences,
  setCurrentWordIndex,
  setPlaybackError,
  setPlaybackStarting,
  setSentences,
  wordTimestamps
} from './playback-store'

const QUEUE = [
  { start: 0, end: 6, text: 'First.' },
  { start: 7, end: 14, text: 'Second.' },
  { start: 15, end: 21, text: 'Third.' }
]

describe('playback store', () => {
  beforeEach(() => {
    resetPlayback()
    clearPlaybackError()
  })

  /**
   * The first sentence is synthesized before any playback ID exists, so the
   * marker is what tells a control "the engine was asked" apart from "there is
   * nothing to play".
   */
  it('reports a pending start until the session begins or the queue resets', () => {
    setSentences(QUEUE)
    setPlaybackStarting(true)
    expect(isStartingPlayback.value).toBe(true)

    beginPlayback('pending-session')
    expect(isStartingPlayback.value).toBe(false)

    setPlaybackStarting(true)
    resetPlayback()
    expect(isStartingPlayback.value).toBe(false)
  })

  it('owns a sentence copy and initializes observable sentence states', () => {
    const queue = [...QUEUE]
    setSentences(queue)
    queue.push({ start: 22, end: 29, text: 'Fourth.' })

    expect(sentences.value).toEqual(QUEUE)
    expect(sentenceStatuses.value).toEqual(['waiting', 'waiting', 'waiting'])
    expect(sentenceWordTimestamps.value).toEqual({})
    expect(currentSentence.value?.text).toBe('First.')
    expect(progress.value).toBeCloseTo(100 / 3)
  })

  it('navigates locally without destroying the retained playback session', () => {
    setSentences(QUEUE)
    beginPlayback('navigation-session', [], 0)

    expect(nextSentence()).toBe(true)
    expect(currentIndex.value).toBe(1)
    expect(currentSentence.value?.text).toBe('Second.')
    expect(activePlaybackId.value).toBe('navigation-session')
    expect(nextSentence()).toBe(true)
    expect(nextSentence()).toBe(false)
    expect(progress.value).toBe(100)

    expect(previousSentence()).toBe(true)
    expect(currentIndex.value).toBe(1)
    expect(previousSentence()).toBe(true)
    expect(previousSentence()).toBe(false)
    expect(activePlaybackId.value).toBe('navigation-session')
  })

  it('combines startup and incremental boundaries for one indexed sentence', () => {
    setSentences(QUEUE)
    beginPlayback(
      'playback-1',
      [{ word: 'Second', startTime: 0.1, endTime: 0.4 }],
      1
    )

    expect(currentIndex.value).toBe(1)
    expect(playState.value).toBe('playing')
    expect(activePlaybackId.value).toBe('playback-1')
    expect(sentenceStatuses.value).toEqual(['waiting', 'playing', 'waiting'])

    expect(
      applyTtsRuntimeEvent({
        action: 'tts:boundaries',
        playbackId: 'playback-1',
        sentenceIndex: 1,
        wordBoundaries: [{ word: 'sentence', startTime: 0.5, endTime: 0.9 }]
      })
    ).toBe(true)
    expect(wordTimestamps.value).toEqual([
      { word: 'Second', startTime: 0.1, endTime: 0.4 },
      { word: 'sentence', startTime: 0.5, endTime: 0.9 }
    ])
    expect(sentenceWordTimestamps.value[1]).toEqual(wordTimestamps.value)
  })

  it('accepts active-word events only for known words in the playing sentence', () => {
    setSentences(QUEUE)
    beginPlayback(
      'active-word-session',
      [
        { word: 'First', startTime: 0.1, endTime: 0.3 },
        { word: 'sentence', startTime: 0.35, endTime: 0.7 }
      ],
      0
    )

    expect(
      applyTtsRuntimeEvent({
        action: 'tts:word',
        playbackId: 'active-word-session',
        sentenceIndex: 0,
        wordIndex: 1
      })
    ).toBe(true)
    expect(currentWordIndex.value).toBe(1)

    expect(
      applyTtsRuntimeEvent({
        action: 'tts:word',
        playbackId: 'active-word-session',
        sentenceIndex: 1,
        wordIndex: 0
      })
    ).toBe(false)
    expect(
      applyTtsRuntimeEvent({
        action: 'tts:word',
        playbackId: 'active-word-session',
        sentenceIndex: 0,
        wordIndex: 2
      })
    ).toBe(false)
    expect(currentWordIndex.value).toBe(1)
  })

  it('adopts sentence indexes from state events and marks the prior sentence played', () => {
    setSentences(QUEUE)
    beginPlayback('indexed-session', [], 0)

    expect(
      applyTtsRuntimeEvent({
        action: 'tts:state',
        playbackId: 'indexed-session',
        state: 'synthesizing',
        sentenceIndex: 1
      })
    ).toBe(true)
    expect(currentIndex.value).toBe(1)
    expect(sentenceStatuses.value).toEqual(['played', 'synthesizing', 'waiting'])

    applyTtsRuntimeEvent({
      action: 'tts:state',
      playbackId: 'indexed-session',
      state: 'playing',
      sentenceIndex: 1
    })
    expect(isPlaying.value).toBe(true)
    expect(sentenceStatuses.value[1]).toBe('playing')

    applyTtsRuntimeEvent({
      action: 'tts:state',
      playbackId: 'indexed-session',
      state: 'paused',
      sentenceIndex: 1
    })
    expect(isPaused.value).toBe(true)
    expect(sentenceStatuses.value[1]).toBe('paused')
  })

  it('stores non-current boundaries and restores them when that sentence becomes active', () => {
    setSentences(QUEUE)
    beginPlayback('timing-session', [
      { word: 'First', startTime: 0.1, endTime: 0.3 }
    ])

    applyTtsRuntimeEvent({
      action: 'tts:boundaries',
      playbackId: 'timing-session',
      sentenceIndex: 1,
      wordBoundaries: [{ word: 'Second', startTime: 0.2, endTime: 0.5 }]
    })
    expect(currentIndex.value).toBe(0)
    expect(wordTimestamps.value).toEqual([
      { word: 'First', startTime: 0.1, endTime: 0.3 }
    ])

    applyTtsRuntimeEvent({
      action: 'tts:state',
      playbackId: 'timing-session',
      state: 'playing',
      sentenceIndex: 1
    })
    expect(currentIndex.value).toBe(1)
    expect(wordTimestamps.value).toEqual([
      { word: 'Second', startTime: 0.2, endTime: 0.5 }
    ])

    previousSentence()
    expect(wordTimestamps.value).toEqual([
      { word: 'First', startTime: 0.1, endTime: 0.3 }
    ])
  })

  it('ignores stale events from a replaced playback ID and invalid sentence indexes', () => {
    setSentences(QUEUE)
    beginPlayback('current-playback')

    expect(
      applyTtsRuntimeEvent({
        action: 'tts:boundaries',
        playbackId: 'stale-playback',
        sentenceIndex: 0,
        wordBoundaries: [{ word: 'stale', startTime: 0, endTime: 1 }]
      })
    ).toBe(false)
    expect(
      applyTtsRuntimeEvent({
        action: 'tts:state',
        playbackId: 'current-playback',
        state: 'playing',
        sentenceIndex: 99
      })
    ).toBe(false)
    expect(currentIndex.value).toBe(0)
    expect(wordTimestamps.value).toEqual([])
  })

  it('retains stopped and ended sessions until explicit disposal', () => {
    setSentences(QUEUE)
    beginPlayback('retained-session', [], 2)

    applyTtsRuntimeEvent({
      action: 'tts:state',
      playbackId: 'retained-session',
      state: 'ended',
      sentenceIndex: 2
    })
    expect(isIdle.value).toBe(true)
    expect(activePlaybackId.value).toBe('retained-session')
    expect(sentenceStatuses.value[2]).toBe('played')
    expect(currentWordIndex.value).toBe(-1)

    clearActivePlaybackSession()
    expect(activePlaybackId.value).toBeNull()
    expect(sentences.value).toEqual(QUEUE)
    expect(currentIndex.value).toBe(2)
  })

  it('records typed stop errors and rejects boundary events while idle', () => {
    setSentences(QUEUE)
    beginPlayback('failed-playback')

    expect(
      applyTtsRuntimeEvent({
        action: 'tts:state',
        playbackId: 'failed-playback',
        state: 'stopped',
        sentenceIndex: 0,
        error: {
          code: 'connection-failed',
          message: 'Edge TTS is currently unavailable.'
        }
      })
    ).toBe(true)
    expect(errorMessage.value).toBe('Edge TTS is currently unavailable.')
    expect(sentenceStatuses.value[0]).toBe('failed')
    expect(activePlaybackId.value).toBe('failed-playback')
    expect(isIdle.value).toBe(true)

    expect(
      applyTtsRuntimeEvent({
        action: 'tts:boundaries',
        playbackId: 'failed-playback',
        sentenceIndex: 0,
        wordBoundaries: [{ word: 'late', startTime: 1, endTime: 2 }]
      })
    ).toBe(false)
  })

  it('bounds the highlighted word index and retains errors across a full reset', () => {
    setSentences(QUEUE)
    beginPlayback('word-index', [
      { word: 'one', startTime: 0, endTime: 0.2 },
      { word: 'two', startTime: 0.3, endTime: 0.5 }
    ])

    setCurrentWordIndex(1)
    expect(currentWordIndex.value).toBe(1)
    setCurrentWordIndex(2)
    expect(currentWordIndex.value).toBe(-1)
    setCurrentWordIndex(-2)
    expect(currentWordIndex.value).toBe(-1)

    setPlaybackError('Keep this error visible.')
    resetPlayback()
    expect(errorMessage.value).toBe('Keep this error visible.')
    expect(sentences.value).toEqual([])
    expect(sentenceStatuses.value).toEqual([])
    expect(sentenceWordTimestamps.value).toEqual({})
    expect(activePlaybackId.value).toBeNull()
  })
})
