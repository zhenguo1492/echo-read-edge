import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectionInfo } from '@/types'

const { getAccurateSelectionMock, isValidSelectionMock } = vi.hoisted(() => ({
  getAccurateSelectionMock: vi.fn(),
  isValidSelectionMock: vi.fn()
}))

vi.mock('@/content/modules/selection-handler', () => ({
  getAccurateSelection: getAccurateSelectionMock,
  isValidSelection: isValidSelectionMock
}))

import {
  destroyPageSelection,
  initializePageSelection
} from '@/content/modules/page-selection'

import {
  SelectionToolbar,
  calculateToolbarPosition
} from './SelectionToolbar'

let container: HTMLDivElement

describe('SelectionToolbar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getAccurateSelectionMock.mockReset()
    isValidSelectionMock.mockReset().mockReturnValue(true)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

    container = document.createElement('div')
    document.body.appendChild(container)
    initializePageSelection()
  })

  afterEach(() => {
    act(() => render(null, container))
    destroyPageSelection()
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('positions beside the right-most rect on the final selection line', () => {
    const position = calculateToolbarPosition([
      new DOMRect(100, 100, 50, 20),
      new DOMRect(50, 150, 40, 20),
      new DOMRect(200, 150, 50, 20)
    ])

    expect(position).toEqual({ x: 254, y: 150 })
  })

  it('moves before the final text when there is no room after it', () => {
    expect(
      calculateToolbarPosition([new DOMRect(790, 570, 30, 20)])
    ).toEqual({
      x: 766,
      y: 570
    })
    expect(calculateToolbarPosition([])).toBeNull()
  })

  it('shows after mouseup, preserves the selection on press, and invokes play', async () => {
    const selection = createSelectionInfo()
    const onPlay = vi.fn()
    getAccurateSelectionMock.mockReturnValue(selection)

    act(() => render(<SelectionToolbar onPlay={onPlay} />, container))
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(10)
    })

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Read selected text"]'
    )
    expect(button).not.toBeNull()

    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true
    })
    act(() => {
      button?.dispatchEvent(mouseDown)
    })
    expect(mouseDown.defaultPrevented).toBe(true)

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onPlay).toHaveBeenCalledWith(selection)
    expect(container.querySelector('button')).toBeNull()
  })

  it('hides when selectionchange reports that the live selection collapsed', async () => {
    getAccurateSelectionMock.mockReturnValue(createSelectionInfo())
    act(() => render(<SelectionToolbar onPlay={vi.fn()} />, container))
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(10)
    })
    expect(container.querySelector('button')).not.toBeNull()

    isValidSelectionMock.mockReturnValue(false)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
    })
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(container.querySelector('button')).toBeNull()
  })

  it('uses the shared translation glyph instead of a letter label', async () => {
    getAccurateSelectionMock.mockReturnValue(createSelectionInfo())
    act(() => render(
      <SelectionToolbar onPlay={vi.fn()} onTranslate={vi.fn()} />,
      container
    ))
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(10)
    })

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Translate selected text"]'
    )
    expect(button?.querySelector('svg')).not.toBeNull()
    expect(button?.textContent).toBe('')
  })

  it('shows only the dictionary action for a selected word', async () => {
    const selection = createSelectionInfo('Reader')
    const onPlay = vi.fn()
    const onTranslate = vi.fn()
    const onOpenDictionary = vi.fn()
    getAccurateSelectionMock.mockReturnValue(selection)
    act(() => render(
      <SelectionToolbar
        onPlay={onPlay}
        onTranslate={onTranslate}
        onOpenDictionary={onOpenDictionary}
      />,
      container
    ))
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(10)
    })

    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.querySelector('button[aria-label="Read selected text"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Translate selected text"]')).toBeNull()

    const dictionaryButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open dictionary"]'
    )
    expect(dictionaryButton).not.toBeNull()
    act(() => {
      dictionaryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onOpenDictionary).toHaveBeenCalledWith('reader', expect.any(Range))
    expect(onPlay).not.toHaveBeenCalled()
    expect(onTranslate).not.toHaveBeenCalled()
  })

  it('supports one-letter dictionary words', async () => {
    getAccurateSelectionMock.mockReturnValue(createSelectionInfo('I'))
    act(() => render(
      <SelectionToolbar onPlay={vi.fn()} onOpenDictionary={vi.fn()} />,
      container
    ))
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(10)
    })
    expect(container.querySelector('button[aria-label="Open dictionary"]')).not.toBeNull()

    getAccurateSelectionMock.mockReturnValue(null)
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(10)
    })
    expect(container.querySelector('button')).toBeNull()
  })
})

function createSelectionInfo(text = 'Read this selection.'): SelectionInfo {
  return {
    text,
    range: document.createRange(),
    rects: [new DOMRect(100, 100, 120, 20)],
    sentences: [
      {
        start: 0,
        end: text.length,
        text
      }
    ]
  }
}
