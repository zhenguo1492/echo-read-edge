import { useEffect, useRef, useState } from 'preact/hooks'

export interface AnchoredPanelPosition {
  left: number
  top: number
  showAbove: boolean
  arrowLeft: number
  maxHeight: number
}

interface PanelSize {
  width: number
  height: number
}

interface ViewportSize {
  width: number
  height: number
}

const VIEWPORT_MARGIN = 10
const ARROW_GAP = 10
const DEFAULT_PANEL_SIZE: PanelSize = { width: 427, height: 540 }

/** Places every selection panel around the center of its focused text Range. */
export function calculateAnchoredPanelPosition(
  anchor: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width'>,
  panel: PanelSize,
  viewport: ViewportSize,
  avoidance: Pick<DOMRect, 'top' | 'bottom'> = anchor
): AnchoredPanelPosition {
  const width = Math.min(panel.width, Math.max(0, viewport.width - VIEWPORT_MARGIN * 2))
  const anchorCenterX = anchor.left + anchor.width / 2
  const maximumLeft = Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN)
  const left = clamp(anchorCenterX - width / 2, VIEWPORT_MARGIN, maximumLeft)
  // Keep the arrow tip on the anchor even when the panel itself must move away
  // from a viewport edge. Clamping this offset would make the arrow point at an
  // arbitrary panel inset instead of the selected text.
  const arrowLeft = anchorCenterX - left

  const spaceBelow = Math.max(
    0,
    viewport.height - avoidance.bottom - ARROW_GAP - VIEWPORT_MARGIN
  )
  const spaceAbove = Math.max(0, avoidance.top - ARROW_GAP - VIEWPORT_MARGIN)
  const showAbove = spaceBelow < panel.height && spaceAbove > spaceBelow
  const availableHeight = showAbove ? spaceAbove : spaceBelow
  const maxHeight = Math.max(0, Math.min(540, availableHeight))
  const renderedHeight = Math.min(panel.height, maxHeight)
  const top = showAbove
    ? Math.max(VIEWPORT_MARGIN, avoidance.top - ARROW_GAP - renderedHeight)
    : avoidance.bottom + ARROW_GAP

  return { left, top, showAbove, arrowLeft, maxHeight }
}

/** Tracks anchor, viewport, page-layout, and rendered-panel size changes. */
export function useAnchoredPanelPosition(
  range: Range,
  panel: HTMLElement | null,
  avoidanceRange: Range = range
): AnchoredPanelPosition {
  const measuredSize = useRef<PanelSize>(DEFAULT_PANEL_SIZE)
  const [position, setPosition] = useState(() => calculateForCurrentViewport(
    range,
    measuredSize.current,
    avoidanceRange
  ))

  useEffect(() => {
    let frame: number | null = null
    const update = (): void => {
      frame = null
      if (panel) {
        const rect = panel.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          measuredSize.current = { width: rect.width, height: rect.height }
        }
      }
      setPosition(calculateForCurrentViewport(
        range,
        measuredSize.current,
        avoidanceRange
      ))
    }
    const schedule = (): void => {
      if (frame !== null) return
      frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    window.visualViewport?.addEventListener('resize', schedule)

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(schedule)
    if (panel) observer?.observe(panel)
    const anchorElement = getRangeAnchorElement(range)
    if (anchorElement) observer?.observe(anchorElement)
    const avoidanceElement = getRangeAnchorElement(avoidanceRange)
    if (avoidanceElement && avoidanceElement !== anchorElement) {
      observer?.observe(avoidanceElement)
    }

    return () => {
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [avoidanceRange, panel, range])

  return position
}

function calculateForCurrentViewport(
  range: Range,
  panel: PanelSize,
  avoidanceRange: Range
): AnchoredPanelPosition {
  return calculateAnchoredPanelPosition(
    range.getBoundingClientRect(),
    panel,
    {
      width: window.visualViewport?.width ?? window.innerWidth,
      height: window.visualViewport?.height ?? window.innerHeight
    },
    avoidanceRange.getBoundingClientRect()
  )
}

function getRangeAnchorElement(range: Range): Element | null {
  const container = range.commonAncestorContainer
  return container instanceof Element ? container : container.parentElement
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
