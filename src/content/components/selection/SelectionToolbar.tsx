import type { ComponentChildren, JSX } from 'preact'

import { TranslateIcon } from '@/content/components/TranslateIcon'
import type { SelectionInfo } from '@/types'
import {
  clearPageSelection,
  pageSelection
} from '@/content/modules/page-selection'

const TOOLBAR_SIZE = 20
const VIEWPORT_MARGIN = 8
const SELECTION_GAP = 4

interface SelectionToolbarProps {
  onPlay(selection: SelectionInfo): void | Promise<void>
  onTranslate?(selection: SelectionInfo): void
  onOpenDictionary?(word: string, range: Range): void
}

/**
 * Shows dictionary lookup for a selected English word, or the retained text
 * actions for longer selections. Removed legacy actions stay absent.
 *
 * The toolbar owns no selection state of its own. It is the near affordance for
 * the same page selection the floating controller offers from the corner, and
 * two trackers would let one surface act on text the other had already seen go.
 */
export function SelectionToolbar({
  onPlay,
  onTranslate,
  onOpenDictionary
}: SelectionToolbarProps): JSX.Element | null {
  const selection = pageSelection.value
  if (!selection) return null

  const selectedWord = getSelectedWord(selection)
  const actionCount = selectedWord
    ? (onOpenDictionary ? 1 : 0)
    : 1 + (onTranslate ? 1 : 0)
  if (actionCount === 0) return null

  const position = calculateToolbarPosition(
    selection.rects,
    actionCount * TOOLBAR_SIZE + (actionCount - 1) * 2
  )
  if (!position) return null

  // An action consumes the selection it was offered for, so the toolbar closes
  // with it instead of hovering over text the reader has moved on from.
  const handlePlay = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    clearPageSelection()
    void Promise.resolve(onPlay(selection)).catch((error: unknown) => {
      console.error(
        '[EchoRead Edge] Selected text could not start playback.',
        error
      )
    })
  }

  const handleTranslate = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    clearPageSelection()
    onTranslate?.(selection)
  }

  const handleDictionary = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!selectedWord) return

    const range = selection.range.cloneRange()
    clearPageSelection()
    onOpenDictionary?.(selectedWord, range)
  }

  return (
    <div
      class="echo-read-edge-root"
      role="toolbar"
      aria-label="Selected text actions"
      style={{
        position: 'fixed',
        zIndex: 2147483647,
        left: `${position.x}px`,
        top: `${position.y}px`,
        display: 'flex',
        gap: '2px',
        width: 'max-content',
        height: `${TOOLBAR_SIZE}px`
      }}
      onMouseDown={(event) => {
        // Prevent the button press from collapsing the page selection before the
        // captured SelectionInfo is passed to the reader controller.
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {!selectedWord && (
        <button
          type="button"
          aria-label="Read selected text"
          title="Read selected text"
          onClick={handlePlay}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: `${TOOLBAR_SIZE}px`,
            height: `${TOOLBAR_SIZE}px`,
            padding: 0,
            border: '1px solid rgb(255 255 255 / 30%)',
            borderRadius: '999px',
            color: '#ffffff',
            background: '#2563eb',
            boxShadow: '0 4px 12px rgb(15 23 42 / 24%)',
            cursor: 'pointer'
          }}
        >
          <SpeakerIcon />
        </button>
      )}
      {!selectedWord && onTranslate && (
        <ToolbarAction label="Translate selected text" onClick={handleTranslate}>
          <TranslateIcon />
        </ToolbarAction>
      )}
      {onOpenDictionary && selectedWord && (
        <ToolbarAction label="Open dictionary" onClick={handleDictionary}>D</ToolbarAction>
      )}
    </div>
  )
}

/** Positions the compact button directly after the selection's visual end. */
export function calculateToolbarPosition(
  rects: readonly DOMRect[],
  toolbarWidth = TOOLBAR_SIZE
): { x: number; y: number } | null {
  const lastRect = findLastValidRect(rects)
  if (!lastRect) return null

  let x = lastRect.right + SELECTION_GAP
  if (x + toolbarWidth > window.innerWidth - VIEWPORT_MARGIN) {
    x = lastRect.left - toolbarWidth - SELECTION_GAP
  }
  x = clamp(
    x,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, window.innerWidth - toolbarWidth - VIEWPORT_MARGIN)
  )

  const y = clamp(
    lastRect.top + (lastRect.height - TOOLBAR_SIZE) / 2,
    VIEWPORT_MARGIN,
    Math.max(VIEWPORT_MARGIN, window.innerHeight - TOOLBAR_SIZE - VIEWPORT_MARGIN)
  )
  return { x, y }
}

function getSelectedWord(selection: SelectionInfo): string | null {
  const text = selection.text.trim()
  return /^[A-Za-z]+(?:['\u2019-][A-Za-z]+)*$/.test(text)
    ? text.toLowerCase()
    : null
}

function ToolbarAction({
  label,
  children,
  onClick
}: {
  label: string
  children: ComponentChildren
  onClick(event: MouseEvent): void
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: `${TOOLBAR_SIZE}px`,
        height: `${TOOLBAR_SIZE}px`,
        padding: 0,
        border: '1px solid rgb(255 255 255 / 30%)',
        borderRadius: '999px',
        color: '#ffffff',
        background: '#2563eb',
        boxShadow: '0 4px 12px rgb(15 23 42 / 24%)',
        cursor: 'pointer',
        font: '700 10px/18px Inter, system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {children}
    </button>
  )
}

/** Finds the right-most rect on the lowest rendered selection line. */
function findLastValidRect(rects: readonly DOMRect[]): DOMRect | null {
  const validRects = rects.filter((rect) => rect.width >= 4 && rect.height >= 8)
  const candidates = validRects.length > 0 ? validRects : rects
  if (candidates.length === 0) return null

  const maximumBottom = Math.max(...candidates.map((rect) => rect.bottom))
  const lastLine = candidates.filter(
    (rect) => Math.abs(rect.bottom - maximumBottom) < 5
  )
  return lastLine.reduce((rightMost, rect) =>
    rect.right > rightMost.right ? rect : rightMost
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function SpeakerIcon(): JSX.Element {
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
