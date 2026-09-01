import { describe, expect, it } from 'vitest'

import {
  CONTROLLER_DRAG_THRESHOLD,
  CONTROLLER_VIEWPORT_MARGIN,
  calculateDragPosition,
  clampControllerPosition,
  exceedsDragThreshold
} from './floating-controller-position'

const PANEL = { width: 44, height: 160 }
const VIEWPORT = { width: 1024, height: 768 }

describe('clampControllerPosition', () => {
  it('returns a point that already fits unchanged', () => {
    expect(
      clampControllerPosition({ left: 300, top: 200 }, PANEL, VIEWPORT)
    ).toEqual({ left: 300, top: 200 })
  })

  it('pulls negative coordinates back to the margin', () => {
    expect(
      clampControllerPosition({ left: -120, top: -40 }, PANEL, VIEWPORT)
    ).toEqual({
      left: CONTROLLER_VIEWPORT_MARGIN,
      top: CONTROLLER_VIEWPORT_MARGIN
    })
  })

  it('keeps the far edges inside the viewport', () => {
    expect(
      clampControllerPosition({ left: 5000, top: 5000 }, PANEL, VIEWPORT)
    ).toEqual({
      left: VIEWPORT.width - PANEL.width - CONTROLLER_VIEWPORT_MARGIN,
      top: VIEWPORT.height - PANEL.height - CONTROLLER_VIEWPORT_MARGIN
    })
  })

  it('never produces a negative origin when the viewport is smaller than the panel', () => {
    expect(
      clampControllerPosition({ left: 400, top: 400 }, PANEL, {
        width: 30,
        height: 50
      })
    ).toEqual({
      left: CONTROLLER_VIEWPORT_MARGIN,
      top: CONTROLLER_VIEWPORT_MARGIN
    })
  })

  it('accepts a custom margin', () => {
    expect(
      clampControllerPosition({ left: -10, top: 5000 }, PANEL, VIEWPORT, 0)
    ).toEqual({
      left: 0,
      top: VIEWPORT.height - PANEL.height
    })
  })
})

describe('calculateDragPosition', () => {
  it('subtracts the grab offset before clamping', () => {
    expect(
      calculateDragPosition(
        { x: 500, y: 300 },
        { x: 20, y: 10 },
        PANEL,
        VIEWPORT
      )
    ).toEqual({ left: 480, top: 290 })
  })

  it('clamps a corner drag exactly like the raw difference would', () => {
    const pointer = { x: 1020, y: 760 }
    const grabOffset = { x: 4, y: 6 }

    expect(calculateDragPosition(pointer, grabOffset, PANEL, VIEWPORT)).toEqual(
      clampControllerPosition(
        { left: pointer.x - grabOffset.x, top: pointer.y - grabOffset.y },
        PANEL,
        VIEWPORT
      )
    )
  })
})

describe('exceedsDragThreshold', () => {
  it('treats a press that barely moves as a click', () => {
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false)
    expect(
      exceedsDragThreshold(
        { x: 100, y: 100 },
        { x: 100 + CONTROLLER_DRAG_THRESHOLD, y: 100 }
      )
    ).toBe(false)
  })

  it('counts travel in any direction, including diagonal', () => {
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 92, y: 100 })).toBe(true)
    expect(exceedsDragThreshold({ x: 100, y: 100 }, { x: 104, y: 104 })).toBe(true)
  })

  it('accepts a custom threshold', () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 6, y: 0 }, 10)).toBe(false)
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 12, y: 0 }, 10)).toBe(true)
  })
})
