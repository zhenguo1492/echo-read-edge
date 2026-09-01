import { signal } from '@preact/signals'

import type { SelectionInfo } from '@/types'
import {
  getAccurateSelection,
  isValidSelection
} from '@/content/modules/selection-handler'

// Web pages commonly update Selection at the end of their own mouseup handler,
// so the snapshot is deferred by one short task like the legacy toolbar.
const SETTLE_DELAY = 10
const COLLAPSE_DELAY = 100

/**
 * The readable text the reader has selected on the page, or null when there is
 * none. Every surface that offers to act on selected text answers "is there
 * something to read?" from this one snapshot: the selection toolbar decides
 * whether to appear, and the floating controller decides whether its transport
 * is inert. Without a shared answer the controller could only see a queue that
 * playback had already started, so it stayed disabled over selected text.
 */
export const pageSelection = signal<SelectionInfo | null>(null)

let settleTimer: number | null = null
let collapseTimer: number | null = null
let repositionFrame: number | null = null

/** Starts tracking the live browser selection for the whole page session. */
export function initializePageSelection(): void {
  destroyPageSelection()

  document.addEventListener('mouseup', handleMouseUp)
  document.addEventListener('selectionchange', handleSelectionChange)
  window.addEventListener('scroll', handleViewportChange, { passive: true })
  window.addEventListener('resize', handleViewportChange)
}

export function destroyPageSelection(): void {
  document.removeEventListener('mouseup', handleMouseUp)
  document.removeEventListener('selectionchange', handleSelectionChange)
  window.removeEventListener('scroll', handleViewportChange)
  window.removeEventListener('resize', handleViewportChange)
  clearPageSelection()
}

/**
 * Drops the snapshot once an action has consumed the selection. The pending
 * mouseup snapshot is cancelled with it, because the click that consumes a
 * selection arrives while that timer is still waiting to read the same one.
 */
export function clearPageSelection(): void {
  cancelPendingUpdates()
  pageSelection.value = null
}

function handleMouseUp(): void {
  cancelSettleTimer()
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    captureSelection()
  }, SETTLE_DELAY)
}

/**
 * Only removal is handled here. A selection being extended fires this event on
 * every mouse move, and re-reading the geometry that often would rebuild the
 * text index for a selection the reader has not finished making.
 */
function handleSelectionChange(): void {
  if (collapseTimer !== null) window.clearTimeout(collapseTimer)
  collapseTimer = window.setTimeout(() => {
    collapseTimer = null
    if (!isValidSelection()) pageSelection.value = null
  }, COLLAPSE_DELAY)
}

/** Selection geometry is only valid for the present rendering of the page. */
function handleViewportChange(): void {
  if (repositionFrame !== null) return
  repositionFrame = window.requestAnimationFrame(() => {
    repositionFrame = null
    if (isValidSelection()) captureSelection()
    else pageSelection.value = null
  })
}

function captureSelection(): void {
  const selection = getAccurateSelection()
  pageSelection.value = selection && selection.text.trim() ? selection : null
}

function cancelPendingUpdates(): void {
  cancelSettleTimer()
  if (collapseTimer !== null) {
    window.clearTimeout(collapseTimer)
    collapseTimer = null
  }
  if (repositionFrame !== null) {
    window.cancelAnimationFrame(repositionFrame)
    repositionFrame = null
  }
}

function cancelSettleTimer(): void {
  if (settleTimer === null) return

  window.clearTimeout(settleTimer)
  settleTimer = null
}
