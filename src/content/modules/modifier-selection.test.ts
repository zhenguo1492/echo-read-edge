import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { clearHighlights, renderHighlights } = vi.hoisted(() => ({
  clearHighlights: vi.fn(),
  renderHighlights: vi.fn()
}))

vi.mock('./highlight-overlay', () => ({
  initializeHighlightOverlay: vi.fn(async () => ({
    clearHighlights,
    renderHighlights
  }))
}))

import {
  destroyModifierSelection,
  getPointSelection,
  getWordRange,
  initializeModifierSelection
} from './modifier-selection'

beforeEach(() => {
  clearHighlights.mockClear()
  renderHighlights.mockClear()
})

afterEach(() => {
  destroyModifierSelection()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('modifier selection word detection', () => {
  it('selects plain English words containing at least two letters', () => {
    const text = document.createTextNode("A reader's well-known choice.")
    document.body.appendChild(text)

    expect(getWordRange(text, 4)?.toString()).toBe('reader')
    expect(getWordRange(text, 13)?.toString()).toBe('well')
    expect(getWordRange(text, 0)).toBeNull()
  })

  it('does not treat punctuation or non-English text as a dictionary word', () => {
    const text = document.createTextNode('read, 中文。')
    document.body.appendChild(text)

    expect(getWordRange(text, 4)?.toString()).toBe('read')
    expect(getWordRange(text, 7)).toBeNull()
  })
})

describe('modifier selection gestures', () => {
  it('does not clear another feature hover during ordinary mouse movement', async () => {
    initializeModifierSelection({ onRead: vi.fn(), onOpenDictionary: vi.fn() })

    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    await Promise.resolve()

    expect(clearHighlights).not.toHaveBeenCalled()
  })

  it('reads the sentence under an Alt+click and prevents page navigation', () => {
    const link = document.createElement('a')
    link.href = 'https://example.com/'
    link.textContent = 'First sentence. Second sentence.'
    const paragraph = document.createElement('p')
    paragraph.append(link)
    document.body.append(paragraph)
    const text = link.firstChild as Text
    setCaretPoint(text, 20)
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
      new DOMRect(10, 10, 240, 20)
    ] as unknown as DOMRectList)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges: vi.fn()
    } as unknown as Selection)
    const onRead = vi.fn()

    expect(getPointSelection('sentence', 20, 20)?.selection?.text).toBe(
      'Second sentence.'
    )

    initializeModifierSelection({ onRead, onOpenDictionary: vi.fn() })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }))
    expect(document.body.dataset.echoReadModifier).toBe('sentence')
    const click = new MouseEvent('click', {
      altKey: true,
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 20,
      clientY: 20
    })
    expect(click.altKey).toBe(true)
    expect(click.button).toBe(0)
    link.dispatchEvent(click)

    expect(onRead).toHaveBeenCalledOnce()
    expect(click.defaultPrevented).toBe(true)
    expect(onRead.mock.calls[0][0].text).toBe('Second sentence.')
    expect(onRead.mock.calls[0][0].sentences).toHaveLength(1)
  })

  it('opens the dictionary for a Ctrl+click and prevents page navigation', () => {
    const link = document.createElement('a')
    link.href = 'https://example.com/reader'
    link.textContent = 'Open reader details'
    document.body.append(link)
    const text = link.firstChild as Text
    setCaretPoint(text, 7)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges: vi.fn()
    } as unknown as Selection)
    const onOpenDictionary = vi.fn()

    expect(getPointSelection('word', 20, 20)?.word).toBe('reader')

    initializeModifierSelection({ onRead: vi.fn(), onOpenDictionary })
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Control', bubbles: true })
    )
    expect(document.body.dataset.echoReadModifier).toBe('word')
    const click = new MouseEvent('click', {
      ctrlKey: true,
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 20,
      clientY: 20
    })
    expect(click.ctrlKey).toBe(true)
    expect(click.button).toBe(0)
    link.dispatchEvent(click)

    expect(onOpenDictionary).toHaveBeenCalledOnce()
    expect(click.defaultPrevented).toBe(true)
    expect(onOpenDictionary.mock.calls[0][0]).toBe('reader')
    expect(onOpenDictionary.mock.calls[0][1].toString()).toBe('reader')
  })
})

function setCaretPoint(textNode: Text, offset: number): void {
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: vi.fn(() => {
      const range = document.createRange()
      range.setStart(textNode, offset)
      range.collapse(true)
      return range
    })
  })
}
