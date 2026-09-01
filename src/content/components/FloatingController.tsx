import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { TranslateIcon } from '@/content/components/TranslateIcon'
import { pageSelection } from '@/content/modules/page-selection'
import {
  changeTranslationTargetLanguage,
  translationTargetLanguage
} from '@/content/modules/translation-settings'
import {
  TRANSLATION_TARGET_LANGUAGES,
  translationTargetLabel
} from '@/lib/translation-languages'
import { languageBadge } from '@/lib/language-badges'
import { readingLanguage } from '@/content/modules/page-language'
import {
  PERSISTENT_CONTROLS_ATTRIBUTE,
  observeOutsidePress
} from '@/content/modules/outside-press'
import {
  calculateDragPosition,
  clampControllerPosition,
  exceedsDragThreshold,
  type ControllerPoint,
  type ControllerPointer
} from '@/content/modules/floating-controller-position'
import {
  pauseReading,
  playNextSentence,
  playPreviousSentence,
  resumeReading
} from '@/content/modules/tts-player'
import {
  activePlaybackId,
  clearPlaybackError,
  currentIndex,
  errorMessage,
  isPlaying,
  isStartingPlayback,
  progress,
  sentences
} from '@/lib/store/playback-store'

const BUTTON_SIZE = 24
const RING_RADIUS = 10
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface DragGesture {
  grabOffset: ControllerPointer
  origin: ControllerPointer
  moved: boolean
}

interface FloatingControllerProps {
  onPlaySelection(): Promise<void> | void
  onStop(): Promise<void> | void
  onTranslate(): void
  translationActive: boolean
}

/**
 * Ports the legacy floating controller as the page's reading control surface.
 * It is viewport-fixed rather than anchored to the queue's final line, so the
 * transport stays reachable after the read text scrolls away. Visibility is a
 * stored reader preference, so the panel outlives any one session and its
 * controls are disabled instead of hidden while there is nothing to act on.
 *
 * "Nothing to act on" is wider than the reading queue: selected text is a queue
 * the reader has not started yet, so the transport offers to read it rather than
 * making the reader return to the selection toolbar to begin. A fresh selection
 * outranks the queue that is playing, because selecting text is how this reader
 * asks for text to be read, and the queue it interrupts is the one it replaces.
 */
export function FloatingController({
  onPlaySelection,
  onStop,
  onTranslate,
  translationActive
}: FloatingControllerProps): JSX.Element {
  const [position, setPosition] = useState<ControllerPoint | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const gesture = useRef<DragGesture | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const languageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (event: MouseEvent): void => {
      const element = containerRef.current
      const current = gesture.current
      if (!element || !current) return

      const pointer = { x: event.clientX, y: event.clientY }
      // A press that has not travelled yet still belongs to the handle's click,
      // so the panel only follows the pointer once the gesture is a real drag.
      if (!current.moved && !exceedsDragThreshold(current.origin, pointer)) return

      current.moved = true
      setPosition(
        calculateDragPosition(
          pointer,
          current.grabOffset,
          { width: element.offsetWidth, height: element.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight }
        )
      )
    }
    const handleMouseUp = (): void => setIsDragging(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // A dragged panel keeps absolute coordinates, so a shrinking window would
  // otherwise leave it partly or wholly outside the viewport. Collapsing also
  // changes the panel's height, which can leave a low panel hanging below it.
  useEffect(() => {
    const reclamp = (): void => {
      const element = containerRef.current
      if (!element) return

      setPosition((current) =>
        current === null
          ? current
          : clampControllerPosition(
              current,
              { width: element.offsetWidth, height: element.offsetHeight },
              { width: window.innerWidth, height: window.innerHeight }
            )
      )
    }

    reclamp()
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [collapsed])

  // The menu is wider than the panel it hangs off, so it closes the way any
  // popup does: a press anywhere else, or Escape. The press is judged inside the
  // controller's own tree, because the panel lives in a closed shadow root where
  // a document listener sees only the host and would read the press that chooses
  // a language as an outside one.
  useEffect(() => {
    const anchor = languageRef.current
    if (!languageMenuOpen || !anchor) return

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLanguageMenuOpen(false)
    }
    const stopWatchingPresses = observeOutsidePress(
      anchor,
      (path) => path.includes(anchor),
      () => setLanguageMenuOpen(false)
    )

    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      stopWatchingPresses()
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [languageMenuOpen])

  const queue = sentences.value
  const hasSession = activePlaybackId.value !== null && queue.length > 0
  const hasSelection = pageSelection.value !== null
  // Synthesis of the first sentence runs before the session exists, so the wait
  // shows as loading; falling back to the disabled look reads as a dead button.
  const starting = isStartingPlayback.value
  const sentenceIndex = currentIndex.value
  // A pending selection takes the press, so the control keeps showing what the
  // press does — read that text — instead of the queue's own pause.
  const pausesQueue = isPlaying.value && !hasSelection
  const error = errorMessage.value
  const ring = calculateProgressRing(hasSession ? progress.value : 0)
  const language = translationTargetLanguage.value
  // A panel dragged to the left edge has no room on its usual side, so the menu
  // opens over the half of the viewport the panel does not sit in.
  const menuOnLeft = (position?.left ?? window.innerWidth) > window.innerWidth / 2

  const startDrag = (event: MouseEvent): void => {
    const element = containerRef.current
    if (!element) return

    // Every control keeps its own press; only the collapse handle may also
    // begin a drag, in either state. The press still suppresses its default,
    // because collapsing the page selection would retract the very text the
    // pressed control is about to read.
    const pressed = (event.target as HTMLElement | null)?.closest('button')
    if (pressed && !pressed.hasAttribute('data-drag-handle')) {
      event.preventDefault()
      return
    }

    // Without this the drag would also start a page text selection.
    event.preventDefault()
    const rect = element.getBoundingClientRect()
    gesture.current = {
      grabOffset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      origin: { x: event.clientX, y: event.clientY },
      moved: false
    }
    setIsDragging(true)
  }

  /** A handle answers its click only when the press did not move the panel. */
  const toggleCollapsed = (): void => {
    if (gesture.current?.moved) return
    setLanguageMenuOpen(false)
    setCollapsed((current) => !current)
  }

  const runTransport = (control: () => Promise<unknown> | void): void => {
    // Nothing else clears a control failure, so a stale message would otherwise
    // keep the ring red for the rest of the session.
    clearPlaybackError()
    void Promise.resolve(control()).catch((cause: unknown) => {
      console.error('[EchoRead Edge] A reading control failed.', cause)
    })
  }

  /** Selected text replaces the queue; without it the queue keeps its transport. */
  const handlePlay = (): void => {
    if (hasSelection) {
      runTransport(onPlaySelection)
      return
    }
    runTransport(pausesQueue ? pauseReading : resumeReading)
  }

  /** Choosing is also closing, because the list answers one press at a time. */
  const chooseLanguage = (languageCode: string): void => {
    setLanguageMenuOpen(false)
    void changeTranslationTargetLanguage(languageCode).catch((cause: unknown) => {
      console.error('[EchoRead Edge] The translation language could not be saved.', cause)
    })
  }

  const handleStop = (): void => {
    if (busy) return

    // Ending the session ends what its failure was about, and the stopped panel
    // disables its controls, so a retained message would stay red with no
    // control left to clear it.
    clearPlaybackError()
    setBusy(true)
    void Promise.resolve(onStop())
      .catch((cause: unknown) => {
        console.error('[EchoRead Edge] The reading session could not stop.', cause)
      })
      .finally(() => setBusy(false))
  }

  const atFirstSentence = !hasSession || sentenceIndex <= 0
  const atLastSentence = !hasSession || sentenceIndex >= queue.length - 1
  // The handle doubles as the panel's language mark: it is the one part of the
  // transport that is always on screen, and the language a page is read in is
  // what a reader checks before pressing play rather than while dragging.
  const reading = readingLanguage.value
  const badge = languageBadge(reading.code)
  const readingLanguageDescription = reading.detected
    ? `page language: ${badge.name}`
    : `reading language: ${badge.name} (page language not detected)`
  const positionStyle = position
    ? {
        left: `${position.left}px`,
        top: `${position.top}px`,
        // The stylesheet pins the default anchor to the right edge; leaving it
        // in place would stretch the panel between both edges once left is set.
        right: 'auto',
        transform: 'none'
      }
    : {}

  return (
    <div
      ref={containerRef}
      class={`echo-read-edge-controller${collapsed ? ' is-collapsed' : ''}${
        isDragging ? ' is-dragging' : ''
      }`}
      role="toolbar"
      aria-label="Reading controls"
      // The transport owns the panels its controls open, so its own presses
      // must never dismiss one out from under the press that follows.
      {...{ [PERSISTENT_CONTROLS_ATTRIBUTE]: true }}
      style={positionStyle}
      onMouseDown={startDrag}
    >
      <button
        type="button"
        data-drag-handle
        class="echo-read-edge-controller-handle"
        aria-label={`${
          collapsed ? 'Expand reading controls' : 'Collapse reading controls'
        } — ${readingLanguageDescription}`}
        aria-expanded={!collapsed}
        title={`${
          collapsed ? 'Expand' : 'Collapse'
        } — drag to move · ${readingLanguageDescription}`}
        onClick={toggleCollapsed}
      >
        {collapsed ? (
          <ChevronDownIcon />
        ) : (
          <span class="echo-read-edge-controller-badge">{badge.badge}</span>
        )}
      </button>
      <div class="echo-read-edge-controller-play">
        <ProgressRing
          dashArray={ring.dashArray}
          dashOffset={ring.dashOffset}
          error={error}
        />
        <button
          type="button"
          class={`echo-read-edge-controller-primary${error ? ' is-error' : ''}${
            starting ? ' is-loading' : ''
          }`}
          aria-label={playButtonLabel(starting, pausesQueue)}
          title={
            error ??
            playButtonTitle(hasSession, hasSelection, pausesQueue, starting)
          }
          disabled={starting || (!hasSession && !hasSelection)}
          onClick={handlePlay}
        >
          {starting ? <SpinnerIcon /> : pausesQueue ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>
      {!collapsed && (
        <>
          <div class="echo-read-edge-controller-nav">
            <button
              type="button"
              class="echo-read-edge-controller-step"
              aria-label="Previous sentence"
              title="Previous sentence"
              disabled={atFirstSentence}
              onClick={() => runTransport(playPreviousSentence)}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              class="echo-read-edge-controller-action is-stop"
              aria-label="Stop reading"
              title="Stop reading"
              disabled={(!hasSession && !starting) || busy}
              onClick={handleStop}
            >
              <StopIcon />
            </button>
            <button
              type="button"
              class="echo-read-edge-controller-step"
              aria-label="Next sentence"
              title="Next sentence"
              disabled={atLastSentence}
              onClick={() => runTransport(playNextSentence)}
            >
              <ChevronRightIcon />
            </button>
          </div>
          <div class="echo-read-edge-controller-translate" ref={languageRef}>
            <button
              type="button"
              class="echo-read-edge-controller-action"
              aria-label="Translate reading selection"
              title="Translate reading selection"
              aria-pressed={translationActive}
              disabled={!hasSession && !hasSelection}
              onClick={onTranslate}
            >
              <TranslateIcon />
            </button>
            <button
              type="button"
              class="echo-read-edge-controller-language"
              aria-label={`Translation language: ${translationTargetLabel(language)}`}
              aria-haspopup="menu"
              aria-expanded={languageMenuOpen}
              title={`Translation language: ${translationTargetLabel(language)}`}
              onClick={() => setLanguageMenuOpen((current) => !current)}
            >
              <ChevronDownIcon />
            </button>
            {languageMenuOpen && (
              <div
                class={`echo-read-edge-controller-menu ${
                  menuOnLeft ? 'is-left' : 'is-right'
                }`}
                role="menu"
                aria-label="Translation language"
              >
                {TRANSLATION_TARGET_LANGUAGES.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    role="menuitemradio"
                    data-language={option.code}
                    aria-label={option.label}
                    aria-checked={option.code === language}
                    onClick={() => chooseLanguage(option.code)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Names the action the press performs, which the icon shows and tests read. */
function playButtonLabel(starting: boolean, playing: boolean): string {
  if (starting) return 'Starting reading'
  return playing ? 'Pause reading' : 'Play reading'
}

/** Explains why the transport is inert before any text has been selected. */
function playButtonTitle(
  hasSession: boolean,
  hasSelection: boolean,
  playing: boolean,
  starting: boolean
): string {
  if (starting) return 'Starting playback'
  if (hasSelection) return 'Read selected text'
  if (!hasSession) return 'Select text to start reading'
  return playing ? 'Pause' : 'Play'
}

/** Maps queue progress onto the SVG ring's stroke dash geometry. */
export function calculateProgressRing(percent: number): {
  dashArray: number
  dashOffset: number
} {
  const ratio = Math.min(Math.max(percent, 0), 100) / 100
  return {
    dashArray: RING_CIRCUMFERENCE,
    dashOffset: RING_CIRCUMFERENCE * (1 - ratio)
  }
}

/** Queue progress around the primary button, shown collapsed or expanded. */
function ProgressRing({
  dashArray,
  dashOffset,
  error
}: {
  dashArray: number
  dashOffset: number
  error: string | null
}): JSX.Element {
  return (
    <svg
      class={`echo-read-edge-controller-ring${error ? ' is-error' : ''}`}
      viewBox={`0 0 ${BUTTON_SIZE} ${BUTTON_SIZE}`}
      aria-hidden="true"
    >
      <circle
        class="echo-read-edge-controller-ring-track"
        cx={BUTTON_SIZE / 2}
        cy={BUTTON_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke-width="2"
      />
      <circle
        class="echo-read-edge-controller-ring-value"
        cx={BUTTON_SIZE / 2}
        cy={BUTTON_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray={dashArray}
        stroke-dashoffset={error ? 0 : dashOffset}
      />
    </svg>
  )
}

/** A speaker, matching the selection toolbar, so both entry points read alike. */
function PlayIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="11 4 6 8 2 8 2 16 6 16 11 20 11 4" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

/** Turning arc for the wait between asking the engine and hearing the first word. */
function SpinnerIcon(): JSX.Element {
  return (
    <svg
      class="echo-read-edge-controller-spinner"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  )
}

function PauseIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

/** One chevron for one sentence, on the strip it shares with stop. */
function ChevronLeftIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function ChevronRightIcon(): JSX.Element {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

/** Filled square for ending the reading session while the panel stays open. */
function StopIcon(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}

/** Caret for the collapsed panel, for reopening it, and for the language list. */
function ChevronDownIcon(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
