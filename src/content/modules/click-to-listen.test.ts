import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  beginPlayback,
  currentIndex,
  playState,
  resetPlayback,
  setSentences
} from '@/lib/store/playback-store'

const { pauseReadingMock, playSentenceMock, resumeReadingMock } = vi.hoisted(() => ({
  pauseReadingMock: vi.fn(async () => true),
  playSentenceMock: vi.fn(async () => true),
  resumeReadingMock: vi.fn(async () => true)
}))
const { clearHighlightsMock, renderHighlightsMock } = vi.hoisted(() => ({
  clearHighlightsMock: vi.fn(),
  renderHighlightsMock: vi.fn()
}))

vi.mock('./tts-player', () => ({
  pauseReading: pauseReadingMock,
  playSentence: playSentenceMock,
  resumeReading: resumeReadingMock
}))

vi.mock('./highlight-overlay', () => ({
  initializeHighlightOverlay: vi.fn(async () => ({
    clearHighlights: clearHighlightsMock,
    renderHighlights: renderHighlightsMock
  }))
}))

import {
  destroyClickToListen,
  findSentenceIndexAtPoint,
  hoveredSentenceIndex,
  initializeClickToListen,
  setClickToListenActivator
} from './click-to-listen'

const queue = [
  { start: 0, end: 6, text: 'First.' },
  { start: 7, end: 14, text: 'Second.' }
]

describe('click-to-listen', () => {
  beforeEach(() => {
    document.body.innerHTML = '<p>First. Second.</p>'
    resetPlayback()
    setSentences(queue)
    beginPlayback('click-session', [], 0)
    pauseReadingMock.mockClear()
    playSentenceMock.mockClear()
    resumeReadingMock.mockClear()
    clearHighlightsMock.mockClear()
    renderHighlightsMock.mockClear()
  })

  afterEach(() => {
    setClickToListenActivator(null)
    destroyClickToListen()
    hoveredSentenceIndex.value = null
  })

  it('finds any point inside a multi-rectangle sentence Range', () => {
    const ranges = [rangeWithRects([rect(10, 10, 50, 20), rect(10, 35, 80, 20)])]
    expect(findSentenceIndexAtPoint(ranges, 25, 45)).toBe(0)
    expect(findSentenceIndexAtPoint(ranges, 100, 45)).toBe(-1)
  })

  it('pauses the current sentence and plays another clicked sentence', async () => {
    const ranges = [
      rangeWithRects([rect(10, 10, 50, 20)]),
      rangeWithRects([rect(70, 10, 60, 20)])
    ]
    initializeClickToListen(() => ranges)

    window.dispatchEvent(pointerEvent('pointerdown', 20, 15))
    window.dispatchEvent(pointerEvent('pointerup', 20, 15))
    await vi.waitFor(() => expect(pauseReadingMock).toHaveBeenCalledOnce())

    window.dispatchEvent(pointerEvent('pointerdown', 80, 15))
    window.dispatchEvent(pointerEvent('pointerup', 80, 15))
    await vi.waitFor(() => expect(playSentenceMock).toHaveBeenCalledWith(1))
    expect(currentIndex.value).toBe(0)
  })

  it('leaves the shared hover layer alone while a modifier gesture is held', async () => {
    const ranges = [
      rangeWithRects([rect(10, 10, 50, 20)]),
      rangeWithRects([rect(70, 10, 60, 20)])
    ]
    initializeClickToListen(() => ranges)

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 80, clientY: 15 }))
    await vi.waitFor(() => expect(hoveredSentenceIndex.value).toBe(1))
    clearHighlightsMock.mockClear()

    // Alt hands the hover layer to modifier-selection, which paints the sentence
    // under the pointer even where no queued sentence exists.
    window.dispatchEvent(
      new MouseEvent('mousemove', { altKey: true, clientX: 400, clientY: 400 })
    )
    await flushFrames()

    expect(clearHighlightsMock).not.toHaveBeenCalled()
  })

  it('synchronizes source hover and supports activation before playback starts', async () => {
    resetPlayback()
    const ranges = [
      rangeWithRects([rect(10, 10, 50, 20)]),
      rangeWithRects([rect(70, 10, 60, 20)])
    ]
    const activate = vi.fn(async () => true)
    initializeClickToListen(() => ranges)
    setClickToListenActivator(activate)

    window.dispatchEvent(new MouseEvent('mousemove', {
      clientX: 80,
      clientY: 15
    }))
    await vi.waitFor(() => expect(hoveredSentenceIndex.value).toBe(1))
    expect(renderHighlightsMock).toHaveBeenCalledWith([ranges[1]], 'hover')

    window.dispatchEvent(pointerEvent('pointerdown', 80, 15))
    window.dispatchEvent(pointerEvent('pointerup', 80, 15))
    await vi.waitFor(() => expect(activate).toHaveBeenCalledWith(1, 'toggle'))
  })

  it('replays the clicked sentence from its start on a double click', async () => {
    const ranges = [
      rangeWithRects([rect(10, 10, 50, 20)]),
      rangeWithRects([rect(70, 10, 60, 20)])
    ]
    initializeClickToListen(() => ranges)

    window.dispatchEvent(pointerEvent('pointerdown', 20, 15))
    window.dispatchEvent(pointerEvent('pointerup', 20, 15))
    await vi.waitFor(() => expect(pauseReadingMock).toHaveBeenCalledOnce())

    window.dispatchEvent(pointerEvent('pointerdown', 20, 15))
    window.dispatchEvent(pointerEvent('pointerup', 20, 15))
    await vi.waitFor(() => expect(playSentenceMock).toHaveBeenCalledWith(0))
    expect(resumeReadingMock).not.toHaveBeenCalled()
    expect(pauseReadingMock).toHaveBeenCalledOnce()
  })

  it('drops the word the browser selects for a replaying double click', async () => {
    const ranges = [rangeWithRects([rect(10, 10, 50, 20)])]
    initializeClickToListen(() => ranges)

    window.dispatchEvent(pointerEvent('pointerdown', 20, 15))
    window.dispatchEvent(pointerEvent('pointerup', 20, 15))
    await vi.waitFor(() => expect(pauseReadingMock).toHaveBeenCalledOnce())

    selectParagraphText()
    window.dispatchEvent(pointerEvent('pointerdown', 20, 15))
    window.dispatchEvent(pointerEvent('pointerup', 20, 15))
    await vi.waitFor(() => expect(playSentenceMock).toHaveBeenCalledWith(0))
    expect(window.getSelection()?.toString() ?? '').toBe('')
  })

  it('keeps a slow second click on the same sentence a pause and resume toggle', async () => {
    const ranges = [rangeWithRects([rect(10, 10, 50, 20)])]
    initializeClickToListen(() => ranges)

    window.dispatchEvent(pointerEvent('pointerdown', 20, 15))
    window.dispatchEvent(pointerEvent('pointerup', 20, 15))
    await vi.waitFor(() => expect(pauseReadingMock).toHaveBeenCalledOnce())

    // Longer than the replay window, so the pair stays two independent clicks.
    playState.value = 'paused'
    await new Promise<void>((resolve) => setTimeout(resolve, 400))
    window.dispatchEvent(pointerEvent('pointerdown', 20, 15))
    window.dispatchEvent(pointerEvent('pointerup', 20, 15))
    await vi.waitFor(() => expect(resumeReadingMock).toHaveBeenCalledOnce())
    expect(playSentenceMock).not.toHaveBeenCalled()
  })
})

function selectParagraphText(): void {
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('p')!)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

async function flushFrames(): Promise<void> {
  for (let frame = 0; frame < 3; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await Promise.resolve()
  }
}

function rangeWithRects(rects: DOMRect[]): Range {
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('p')!)
  vi.spyOn(range, 'getClientRects').mockReturnValue(rects as unknown as DOMRectList)
  return range
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

function pointerEvent(type: string, clientX: number, clientY: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY
  })
}
