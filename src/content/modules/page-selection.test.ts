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
  clearPageSelection,
  destroyPageSelection,
  initializePageSelection,
  pageSelection
} from './page-selection'

describe('page selection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getAccurateSelectionMock.mockReset()
    isValidSelectionMock.mockReset().mockReturnValue(true)
    initializePageSelection()
  })

  afterEach(() => {
    destroyPageSelection()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('captures the selection once the page has settled after mouseup', () => {
    const selection = createSelectionInfo()
    getAccurateSelectionMock.mockReturnValue(selection)

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(pageSelection.value).toBeNull()

    vi.advanceTimersByTime(10)
    expect(pageSelection.value).toBe(selection)
  })

  it('keeps no snapshot for a missing or blank selection', () => {
    getAccurateSelectionMock.mockReturnValue(createSelectionInfo('   '))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.advanceTimersByTime(10)
    expect(pageSelection.value).toBeNull()

    getAccurateSelectionMock.mockReturnValue(null)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.advanceTimersByTime(10)
    expect(pageSelection.value).toBeNull()
  })

  it('drops the snapshot when the live selection collapses', () => {
    getAccurateSelectionMock.mockReturnValue(createSelectionInfo())
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.advanceTimersByTime(10)

    isValidSelectionMock.mockReturnValue(false)
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(100)
    expect(pageSelection.value).toBeNull()
  })

  it('re-reads the selection geometry after the viewport moves', () => {
    const first = createSelectionInfo()
    getAccurateSelectionMock.mockReturnValue(first)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.advanceTimersByTime(10)

    const scrolled = createSelectionInfo()
    getAccurateSelectionMock.mockReturnValue(scrolled)
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(20)
    expect(pageSelection.value).toBe(scrolled)

    isValidSelectionMock.mockReturnValue(false)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(20)
    expect(pageSelection.value).toBeNull()
  })

  /**
   * The click that consumes a selection arrives while the mouseup snapshot is
   * still pending, so a clear that only emptied the signal would be overwritten
   * by the timer a moment later.
   */
  it('cancels a pending snapshot when the selection is consumed', () => {
    getAccurateSelectionMock.mockReturnValue(createSelectionInfo())
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    clearPageSelection()

    vi.advanceTimersByTime(10)
    expect(pageSelection.value).toBeNull()
  })

  it('stops tracking and forgets the selection once destroyed', () => {
    getAccurateSelectionMock.mockReturnValue(createSelectionInfo())
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.advanceTimersByTime(10)
    expect(pageSelection.value).not.toBeNull()

    destroyPageSelection()
    expect(pageSelection.value).toBeNull()

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    vi.advanceTimersByTime(10)
    expect(pageSelection.value).toBeNull()
  })
})

function createSelectionInfo(text = 'Read this selection.'): SelectionInfo {
  return {
    text,
    range: document.createRange(),
    rects: [new DOMRect(100, 100, 120, 20)],
    sentences: [{ start: 0, end: text.length, text }]
  }
}
