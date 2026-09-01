/**
 * Geometry for the draggable reading controller.
 *
 * The controller is viewport-fixed and may be dragged anywhere, so every
 * candidate origin passes through the same clamp. Viewport size is a parameter
 * rather than a `window` read, which keeps the math testable without stubbing
 * globals and lets a caller re-clamp against a resized viewport.
 */

export interface ControllerPoint {
  left: number
  top: number
}

export interface ControllerSize {
  width: number
  height: number
}

export interface ControllerPointer {
  x: number
  y: number
}

/** Matches the selection toolbar so extension surfaces keep one edge inset. */
export const CONTROLLER_VIEWPORT_MARGIN = 8

/** Keeps the whole panel inside the viewport, including after a window resize. */
export function clampControllerPosition(
  point: ControllerPoint,
  size: ControllerSize,
  viewport: ControllerSize,
  margin: number = CONTROLLER_VIEWPORT_MARGIN
): ControllerPoint {
  return {
    left: clamp(point.left, size.width, viewport.width, margin),
    top: clamp(point.top, size.height, viewport.height, margin)
  }
}

/**
 * Distance a pointer must travel before a press becomes a drag. Without it a
 * handle could not both move the panel and answer a plain click.
 */
export const CONTROLLER_DRAG_THRESHOLD = 4

/** Reports whether a press has travelled far enough to count as a drag. */
export function exceedsDragThreshold(
  origin: ControllerPointer,
  pointer: ControllerPointer,
  threshold: number = CONTROLLER_DRAG_THRESHOLD
): boolean {
  return Math.hypot(pointer.x - origin.x, pointer.y - origin.y) > threshold
}

/** Converts a pointer position and the grab offset into a clamped panel origin. */
export function calculateDragPosition(
  pointer: ControllerPointer,
  grabOffset: ControllerPointer,
  size: ControllerSize,
  viewport: ControllerSize,
  margin: number = CONTROLLER_VIEWPORT_MARGIN
): ControllerPoint {
  return clampControllerPosition(
    { left: pointer.x - grabOffset.x, top: pointer.y - grabOffset.y },
    size,
    viewport,
    margin
  )
}

/**
 * A viewport smaller than the panel would otherwise produce an upper bound below
 * the margin, so the lower bound wins and the panel stays reachable.
 */
function clamp(
  value: number,
  size: number,
  extent: number,
  margin: number
): number {
  const upperBound = Math.max(margin, extent - size - margin)
  return Math.min(Math.max(value, margin), upperBound)
}
