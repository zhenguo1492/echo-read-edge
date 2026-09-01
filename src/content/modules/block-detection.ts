/** Semantic content blocks retained from the legacy modifier-click modules. */
export const SEMANTIC_BLOCK_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TD',
  'TH',
  'BLOCKQUOTE',
  'FIGCAPTION',
  'DT',
  'DD',
  'PRE',
  'DETAILS',
  'SUMMARY'
])

const BLOCK_DISPLAY_VALUES = new Set([
  'block',
  'flex',
  'grid',
  'list-item',
  'table-cell'
])

export function isPointInRange(x: number, y: number, range: Range | null): boolean {
  if (!range) return false
  return Array.from(range.getClientRects()).some(
    (rect) =>
      x >= rect.left - 2 &&
      x <= rect.right + 2 &&
      y >= rect.top - 2 &&
      y <= rect.bottom + 2
  )
}

/** Returns the nearest useful text block without selecting a page-wide wrapper. */
export function findBlockElement(startElement: HTMLElement): HTMLElement | null {
  let element: HTMLElement | null = startElement
  while (element && element !== document.body) {
    if (
      SEMANTIC_BLOCK_TAGS.has(element.tagName) ||
      BLOCK_DISPLAY_VALUES.has(getComputedStyle(element).display)
    ) {
      return isLargeContainer(element) ? null : element
    }
    element = element.parentElement
  }
  return null
}

export function isLargeContainer(element: HTMLElement, maximumBlocks = 3): boolean {
  let blocks = 0
  for (const child of element.children) {
    if (
      SEMANTIC_BLOCK_TAGS.has(child.tagName) ||
      BLOCK_DISPLAY_VALUES.has(getComputedStyle(child).display)
    ) {
      blocks += 1
      if (blocks > maximumBlocks) return true
    }
  }
  return false
}
