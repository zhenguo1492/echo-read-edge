import type { SelectionInfo } from '@/types'
import { findBlockElement, isPointInRange } from './block-detection'
import { initializeHighlightOverlay } from './highlight-overlay'
import { createSelectionInfoFromRange } from './selection-handler'

type ModifierMode = 'sentence' | 'paragraph' | 'word'

interface PointSelection {
  mode: ModifierMode
  range: Range
  selection?: SelectionInfo
  word?: string
}

export interface ModifierSelectionActions {
  onRead(selection: SelectionInfo): void | Promise<void>
  onOpenDictionary(word: string, range: Range): void
}

/**
 * Consolidates the three legacy listeners while retaining their exact gestures:
 * Alt targets a sentence, Shift targets a paragraph, and Ctrl targets a word.
 * Selection extraction stays separate from playback and dictionary Providers.
 */
class ModifierSelectionController {
  private activeMode: ModifierMode | null = null
  private hovered: PointSelection | null = null
  private updateFrame: number | null = null
  private lastPointer: MouseEvent | null = null

  constructor(private readonly actions: ModifierSelectionActions) {}

  initialize(): void {
    document.addEventListener('keydown', this.handleKeyDown)
    document.addEventListener('keyup', this.handleKeyUp)
    document.addEventListener('mousemove', this.handleMouseMove, { passive: true })
    document.addEventListener('click', this.handleClick)
    document.addEventListener('contextmenu', this.handleContextMenu)
    window.addEventListener('blur', this.handleBlur)
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown)
    document.removeEventListener('keyup', this.handleKeyUp)
    document.removeEventListener('mousemove', this.handleMouseMove)
    document.removeEventListener('click', this.handleClick)
    document.removeEventListener('contextmenu', this.handleContextMenu)
    window.removeEventListener('blur', this.handleBlur)
    if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame)
    this.reset()
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const mode = modeFromKeyboardEvent(event)
    if (!mode) return
    this.activeMode = mode
    document.body.dataset.echoReadModifier = mode
    if (mode === 'sentence') event.preventDefault()
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (
      (this.activeMode === 'sentence' && event.key === 'Alt') ||
      (this.activeMode === 'paragraph' && event.key === 'Shift') ||
      (this.activeMode === 'word' && event.key === 'Control')
    ) {
      this.reset()
    }
  }

  private readonly handleBlur = (): void => this.reset()

  private readonly handleMouseMove = (event: MouseEvent): void => {
    const mode = modeFromMouseEvent(event)
    if (!mode || isExtensionUiEvent(event) || isEditableTarget(event.target)) {
      if (!mode) {
        if (this.activeMode || this.hovered) this.reset()
      } else this.clearHover()
      return
    }

    this.activeMode = mode
    document.body.dataset.echoReadModifier = mode
    if (this.hovered?.mode === mode && isPointInRange(event.clientX, event.clientY, this.hovered.range)) {
      return
    }

    this.lastPointer = event
    if (this.updateFrame !== null) return
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      const pointer = this.lastPointer
      if (!pointer || this.activeMode !== mode) return
      const selection = getPointSelection(mode, pointer.clientX, pointer.clientY)
      this.hovered = selection
      void initializeHighlightOverlay().then((overlay) => {
        if (this.hovered === selection && selection) {
          overlay.renderHighlights([selection.range], 'hover')
        } else if (!selection) {
          overlay.clearHighlights('hover')
        }
      })
    })
  }

  private readonly handleClick = (event: MouseEvent): void => {
    if (event.button !== 0 || isExtensionUiEvent(event)) return
    const mode = modeFromMouseEvent(event)
    if (!mode || mode !== this.activeMode) return
    this.activate(event, mode)
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if (!event.ctrlKey || isExtensionUiEvent(event)) return
    this.activate(event, 'word')
  }

  private activate(event: MouseEvent, mode: ModifierMode): void {
    const pointSelection =
      this.hovered?.mode === mode
        ? this.hovered
        : getPointSelection(mode, event.clientX, event.clientY)
    if (!pointSelection) return

    event.preventDefault()
    event.stopPropagation()
    window.getSelection()?.removeAllRanges()
    if (mode === 'word' && pointSelection.word) {
      this.actions.onOpenDictionary(pointSelection.word, pointSelection.range.cloneRange())
    } else if (pointSelection.selection) {
      void Promise.resolve(this.actions.onRead(pointSelection.selection)).catch((error: unknown) => {
        console.error('[EchoRead Edge] Modifier selection could not start playback.', error)
      })
    }
    this.reset()
  }

  private clearHover(): void {
    this.hovered = null
    void initializeHighlightOverlay().then((overlay) => overlay.clearHighlights('hover'))
  }

  private reset(): void {
    this.activeMode = null
    this.lastPointer = null
    delete document.body.dataset.echoReadModifier
    this.clearHover()
  }
}

let activeController: ModifierSelectionController | null = null

export function initializeModifierSelection(actions: ModifierSelectionActions): void {
  activeController?.destroy()
  activeController = new ModifierSelectionController(actions)
  activeController.initialize()
}

export function destroyModifierSelection(): void {
  activeController?.destroy()
  activeController = null
}

export function getPointSelection(
  mode: ModifierMode,
  x: number,
  y: number
): PointSelection | null {
  const caret = caretRangeFromPoint(x, y)
  if (!caret || !(caret.startContainer instanceof Text)) return null

  if (mode === 'word') {
    const range = getWordRange(caret.startContainer, caret.startOffset)
    const word = range?.toString()
    return range && word ? { mode, range, word: word.toLowerCase() } : null
  }

  const startElement = caret.startContainer.parentElement
  const block = startElement ? findBlockElement(startElement) : null
  if (!block) return null
  const blockRange = document.createRange()
  blockRange.selectNodeContents(block)
  const blockSelection = createSelectionInfoFromRange(blockRange)
  if (!blockSelection) return null

  if (mode === 'paragraph') {
    return { mode, range: blockRange, selection: blockSelection }
  }

  const sentence = blockSelection.sentences.find((candidate) => {
    const range = candidate.range
    return Boolean(
      range &&
      range.isPointInRange(caret.startContainer, caret.startOffset)
    )
  })
  if (!sentence?.range) return null
  const selection = createSelectionInfoFromRange(sentence.range)
  return selection
    ? { mode, range: sentence.range.cloneRange(), selection }
    : null
}

/** Retains the legacy dictionary gesture: at least two contiguous ASCII letters. */
export function getWordRange(textNode: Text, caretOffset: number): Range | null {
  const text = textNode.data
  const tokenPattern = /[A-Za-z]{2,}/g
  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index
    const end = start + match[0].length
    if (caretOffset < start || caretOffset > end) continue
    const range = document.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, end)
    return range
  }
  return null
}

function modeFromKeyboardEvent(event: KeyboardEvent): ModifierMode | null {
  if (event.key === 'Control') return 'word'
  if (event.key === 'Shift') return 'paragraph'
  if (event.key === 'Alt') return 'sentence'
  return null
}

function modeFromMouseEvent(event: MouseEvent): ModifierMode | null {
  if (event.ctrlKey) return 'word'
  if (event.shiftKey) return 'paragraph'
  if (event.altKey) return 'sentence'
  return null
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  if (typeof document.caretRangeFromPoint === 'function') {
    return document.caretRangeFromPoint(x, y)
  }
  const position = document.caretPositionFromPoint?.(x, y)
  if (!position) return null
  const range = document.createRange()
  range.setStart(position.offsetNode, position.offset)
  range.collapse(true)
  return range
}

function isExtensionUiEvent(event: Event): boolean {
  return event.composedPath().some(
    (target) => target instanceof HTMLElement && target.id === 'echo-read-edge-content-root'
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select'))
  )
}
