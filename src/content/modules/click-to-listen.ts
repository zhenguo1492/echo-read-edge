import { effect, signal } from '@preact/signals'

import {
  activePlaybackId,
  currentIndex,
  playState,
  sentences
} from '@/lib/store/playback-store'
import {
  pauseReading,
  playSentence,
  resumeReading
} from './tts-player'
import { initializeHighlightOverlay } from './highlight-overlay'

interface HoveredSentence {
  index: number
  range: Range
  element: HTMLElement
  previousCursor: string
}

interface PendingClick extends HoveredSentence {
  originX: number
  originY: number
}

/**
 * `toggle` keeps the single-click pause and resume semantics, while `restart`
 * replays the whole sentence from its beginning for a double click.
 */
export type ActivationIntent = 'toggle' | 'restart'

type SentenceRangeProvider = () => readonly (Range | null)[]
type SentenceActivator = (
  index: number,
  intent: ActivationIntent
) => boolean | Promise<boolean>

/** A second click on the same sentence within this window replays it. */
const DOUBLE_CLICK_WINDOW_MS = 350

/** Larger pointer travel is a drag, so it can never complete a double click. */
const DOUBLE_CLICK_MOVEMENT_LIMIT_PX = 4

/** Shared hover index keeps source sentences and translated lines synchronized. */
export const hoveredSentenceIndex = signal<number | null>(null)

/**
 * Minimal port of the legacy click-to-listen manager. It uses the stable Ranges
 * already created for the active selection instead of rebuilding a document-wide
 * character index, preserving exact selection semantics across nested elements.
 */
class ClickToListenManager {
  private enabled = false
  private hovered: HoveredSentence | null = null
  private pendingClick: PendingClick | null = null
  private lastClick: { index: number; time: number } | null = null
  private updateFrame: number | null = null
  private lastPointer: { x: number; y: number; target: EventTarget | null } | null = null
  private disposeEffect: (() => void) | null = null
  private contextActivator: SentenceActivator | null = null

  constructor(private readonly getSentenceRanges: SentenceRangeProvider) {}

  initialize(): void {
    this.disposeEffect = effect(() => {
      const hasRetainedQueue =
        Boolean(activePlaybackId.value) && sentences.value.length > 0
      this.refreshEnabled(hasRetainedQueue)
    })
  }

  setContextActivator(activator: SentenceActivator | null): void {
    if (this.contextActivator !== activator) this.clearHover()
    this.contextActivator = activator
    const hasRetainedQueue =
      Boolean(activePlaybackId.value) && sentences.value.length > 0
    this.refreshEnabled(hasRetainedQueue)
  }

  destroy(): void {
    this.contextActivator = null
    this.disable()
    this.disposeEffect?.()
    this.disposeEffect = null
  }

  private refreshEnabled(hasRetainedQueue: boolean): void {
    if (hasRetainedQueue || this.contextActivator) this.enable()
    else this.disable()
  }

  private enable(): void {
    if (this.enabled) return
    this.enabled = true
    window.addEventListener('mousemove', this.handleMouseMove, { passive: true })
    window.addEventListener('pointerdown', this.handlePointerDown, { capture: true })
  }

  private disable(): void {
    if (!this.enabled) return
    this.enabled = false
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('pointerdown', this.handlePointerDown, { capture: true })
    window.removeEventListener('pointerup', this.handlePointerUp, { capture: true })
    if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame)
    this.updateFrame = null
    this.pendingClick = null
    this.lastClick = null
    this.clearHover()
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    // Alt, Shift, and Ctrl hand the shared hover layer to modifier-selection.
    // Continuing here would clear the sentence it just painted, so the highlight
    // would only flicker while the reader moves across the page.
    if (hasModifierGesture(event)) return

    this.lastPointer = { x: event.clientX, y: event.clientY, target: event.target }
    if (this.updateFrame !== null) return
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      const pointer = this.lastPointer
      if (pointer) this.updateHover(pointer.x, pointer.y, pointer.target)
    })
  }

  private updateHover(x: number, y: number, target: EventTarget | null): void {
    if (isExtensionUiTarget(target)) return

    const index = findSentenceIndexAtPoint(this.getSentenceRanges(), x, y)
    if (index < 0) {
      this.clearHover()
      return
    }
    if (this.hovered?.index === index) return

    this.clearHover()
    const range = this.getSentenceRanges()[index]
    const element = target instanceof HTMLElement ? target : range?.startContainer.parentElement
    if (!range || !element) return

    this.hovered = {
      index,
      range,
      element,
      previousCursor: element.style.cursor
    }
    element.style.cursor = 'pointer'
    hoveredSentenceIndex.value = index
    if (this.contextActivator || index !== currentIndex.value) {
      void initializeHighlightOverlay().then((overlay) => {
        if (this.hovered?.index === index) overlay.renderHighlights([range], 'hover')
      })
    }
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isExtensionUiTarget(event.target)
    ) {
      return
    }

    const index = findSentenceIndexAtPoint(
      this.getSentenceRanges(),
      event.clientX,
      event.clientY
    )
    const range = this.getSentenceRanges()[index]
    const element = event.target instanceof HTMLElement
      ? event.target
      : range?.startContainer.parentElement
    if (index < 0 || !range || !element) return

    this.pendingClick = {
      index,
      range,
      element,
      previousCursor: element.style.cursor,
      originX: event.clientX,
      originY: event.clientY
    }
    window.addEventListener('pointerup', this.handlePointerUp, {
      once: true,
      capture: true
    })
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const clicked = this.pendingClick
    this.pendingClick = null
    if (!clicked) return

    const stationary = isStationaryClick(clicked, event)
    const intent = this.resolveActivationIntent(clicked.index, stationary)
    if (intent === 'restart') {
      // A double click makes the browser select the word underneath it. The
      // replay is not a text selection, so that word is dropped before the
      // selection toolbar can read it.
      clearDocumentSelection()
    } else if (hasNonCollapsedSelection()) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const activator = this.contextActivator ?? activateSentence
    void Promise.resolve(activator(clicked.index, intent)).then((applied) => {
      if (!applied) {
        console.warn('[EchoRead Edge] The clicked sentence could not start playback.')
      }
    })
  }

  /** Treats a quick, stationary repeat click on one sentence as a replay. */
  private resolveActivationIntent(
    index: number,
    stationary: boolean
  ): ActivationIntent {
    const previous = this.lastClick
    this.lastClick = stationary ? { index, time: Date.now() } : null
    if (!stationary || !previous || previous.index !== index) return 'toggle'
    return Date.now() - previous.time <= DOUBLE_CLICK_WINDOW_MS
      ? 'restart'
      : 'toggle'
  }

  private clearHover(): void {
    if (this.hovered) this.hovered.element.style.cursor = this.hovered.previousCursor
    this.hovered = null
    hoveredSentenceIndex.value = null
    void initializeHighlightOverlay().then((overlay) => {
      overlay.clearHighlights('hover')
    })
  }
}

let activeManager: ClickToListenManager | null = null

export function initializeClickToListen(
  getSentenceRanges: SentenceRangeProvider
): void {
  activeManager?.destroy()
  activeManager = new ClickToListenManager(getSentenceRanges)
  activeManager.initialize()
}

export function destroyClickToListen(): void {
  activeManager?.destroy()
  activeManager = null
}

/** Enables source-sentence hover and click while a non-playing translation is open. */
export function setClickToListenActivator(activator: SentenceActivator | null): void {
  activeManager?.setContextActivator(activator)
}

/** Finds a sentence by its rendered Range rectangles without changing page DOM. */
export function findSentenceIndexAtPoint(
  ranges: readonly (Range | null)[],
  x: number,
  y: number
): number {
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]
    if (!range?.startContainer.isConnected) continue
    for (const rect of range.getClientRects()) {
      if (
        rect.width >= 2 &&
        rect.height >= 2 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return index
      }
    }
  }
  return -1
}

/** Applies the same pause, resume, or navigation semantics for page and panel clicks. */
export async function activateSentence(
  sentenceIndex: number,
  intent: ActivationIntent = 'toggle'
): Promise<boolean> {
  if (intent === 'restart') return await playSentence(sentenceIndex)
  if (sentenceIndex !== currentIndex.value) return await playSentence(sentenceIndex)
  if (playState.value === 'playing') return await pauseReading()
  if (playState.value === 'paused') return await resumeReading()
  return await playSentence(sentenceIndex)
}

function isStationaryClick(origin: PendingClick, event: PointerEvent): boolean {
  return (
    Math.abs(event.clientX - origin.originX) <= DOUBLE_CLICK_MOVEMENT_LIMIT_PX &&
    Math.abs(event.clientY - origin.originY) <= DOUBLE_CLICK_MOVEMENT_LIMIT_PX
  )
}

function clearDocumentSelection(): void {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) selection.removeAllRanges()
}

function hasNonCollapsedSelection(): boolean {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
}

function hasModifierGesture(event: MouseEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
}

function isExtensionUiTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('#echo-read-edge-content-root'))
  )
}
