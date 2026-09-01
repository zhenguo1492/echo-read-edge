import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  destroyHighlightOverlay,
  getHighlightOverlay,
  initializeHighlightOverlay
} from './highlight-overlay'

afterEach(() => {
  destroyHighlightOverlay()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('highlight overlay initialization', () => {
  it('shares one renderer across initializations started before the worklet loads', async () => {
    const addModule = vi.fn(
      async () => await new Promise<void>((resolve) => setTimeout(resolve, 5))
    )
    vi.stubGlobal('CSS', { paintWorklet: { addModule } })
    vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => path } })

    const [first, second, third] = await Promise.all([
      initializeHighlightOverlay(),
      initializeHighlightOverlay(),
      initializeHighlightOverlay()
    ])

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(getHighlightOverlay()).toBe(first)
    expect(addModule).toHaveBeenCalledOnce()
  })

  it('keeps a single DOM overlay when the paint worklet is unavailable', async () => {
    vi.stubGlobal('CSS', {})

    const [first, second] = await Promise.all([
      initializeHighlightOverlay(),
      initializeHighlightOverlay()
    ])
    document.body.innerHTML = '<p>First sentence.</p>'
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('p')!)
    vi.spyOn(range, 'getClientRects').mockReturnValue([
      new DOMRect(10, 10, 120, 20)
    ] as unknown as DOMRectList)
    first.renderHighlights([range], 'hover')

    expect(second).toBe(first)
    expect(
      document.querySelectorAll('#echo-read-edge-highlight-overlay')
    ).toHaveLength(1)
  })

  it('does not resurrect a renderer that was destroyed while initializing', async () => {
    vi.stubGlobal('CSS', {})

    const pending = initializeHighlightOverlay()
    destroyHighlightOverlay()
    await pending

    expect(getHighlightOverlay()).toBeNull()
  })
})
