import type { JSX } from 'preact'
import { useEffect, useMemo, useRef } from 'preact/hooks'

import {
  exampleSpeechState,
  stopExampleSpeech,
  toggleExampleSpeech
} from '@/content/modules/example-speech-controller'
import {
  mapExampleBoundariesToWords,
  splitExampleText
} from '@/content/modules/example-word-mapper'
import { disposeReading } from '@/content/modules/tts-player'
import { settingsRepository } from '@/storage'

let nextExampleId = 0

interface SpeakableExampleProps {
  text: string
  translation?: string
  size?: 'small' | 'normal'
}

/** Migrated example player with local spans driven by Edge WordBoundary events. */
export function SpeakableExample({
  text,
  translation,
  size = 'normal'
}: SpeakableExampleProps): JSX.Element {
  const sourceId = useRef(`dictionary-example-${++nextExampleId}`).current
  const speech = exampleSpeechState.value
  const isActive = speech.sourceId === sourceId
  const isPlaying = isActive && speech.playState === 'playing'
  const isStarting = isActive && speech.playState === 'starting'
  const { parts } = useMemo(() => splitExampleText(text), [text])
  const boundaryMap = useMemo(
    () => mapExampleBoundariesToWords(text, isActive ? speech.boundaries : []),
    [isActive, speech.boundaries, text]
  )
  const highlightedWord = isActive
    ? boundaryMap.get(speech.wordIndex) ?? -1
    : -1

  useEffect(() => () => {
    void stopExampleSpeech(sourceId)
  }, [sourceId])

  const toggle = async (): Promise<void> => {
    // The legacy audio controller allowed only one speech source. Dispose page
    // reading before a new example claims the single offscreen audio session.
    if (!isActive) await disposeReading()
    const settings = await settingsRepository.getTtsSettings()
    // Dictionary examples are English sentences, so they keep the English voice
    // even while the reader is set to read pages in another language.
    await toggleExampleSpeech(sourceId, text, {
      voice: settings.voiceByLanguage?.en ?? settings.voice,
      speed: settings.speed
    })
  }

  return (
    <div class={`echo-read-edge-speakable-example is-${size}`}>
      <div class="echo-read-edge-example-copy">
        <p>
          {parts.map((part) => part.wordIndex === null
            ? part.text
            : (
                <span class={part.wordIndex === highlightedWord ? 'is-speaking' : ''}>
                  {part.text}
                </span>
              ))}
        </p>
        {translation && <small>{translation}</small>}
      </div>
      <button
        type="button"
        class="echo-read-edge-example-speech"
        aria-label={isPlaying ? `Pause example: ${text}` : `Read example: ${text}`}
        title={isPlaying ? 'Pause example' : 'Read example'}
        disabled={isStarting}
        onClick={() => void toggle()}
      >
        {isPlaying ? <PauseIcon /> : <SpeakerIcon />}
      </button>
    </div>
  )
}

function SpeakerIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 5V4L7 9H3zm11 2.1v1.8c.58-.35 1-.98 1-1.9s-.42-1.55-1-1.9zm0-4.2v2.06c1.48.73 2.5 2.25 2.5 4.04s-1.02 3.31-2.5 4.04v2.06c2.6-.82 4.5-3.24 4.5-6.1S16.6 7.72 14 6.9z" />
    </svg>
  )
}

function PauseIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}
