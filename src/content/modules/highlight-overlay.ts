/**
 * Page-text highlight rendering retained from the legacy EchoRead extension.
 *
 * The manager prefers the existing CSS Paint Worklet because it paints behind
 * page text without inserting wrapper elements into the document. A small DOM
 * overlay remains available for browsers or pages where Paint Worklets cannot
 * be initialized. Removed pronunciation-assessment highlight modes are omitted.
 */

export type ReadingHighlightType = 'sentence' | 'word' | 'hover' | 'selection'

interface HighlightRenderer {
  renderHighlights(ranges: readonly Range[], type: ReadingHighlightType): void
  clearHighlights(type: ReadingHighlightType): void
  clearAllHighlights(): void
  scrollToHighlight(type?: ReadingHighlightType): void
  destroy(): void
}

interface ElementHighlightData {
  sentence: RectData[]
  word: RectData[]
  hover: RectData[]
  selection: RectData[]
}

interface RectData {
  x: number
  y: number
  width: number
  height: number
}

const WORKLET_PROPERTIES: Record<ReadingHighlightType, string> = {
  sentence: '--echoHighlightSentenceInfo',
  word: '--echoHighlightWordInfo',
  hover: '--echoHighlightHoverInfo',
  selection: '--echoHighlightSelectionInfo'
}

/**
 * The reader distinguishes three page-text states at a glance: gray marks the
 * sentences the session still covers, blue marks the sentence being spoken, and
 * green marks the sentence the pointer would activate.
 */
const FALLBACK_COLORS: Record<ReadingHighlightType, string> = {
  sentence: 'rgba(96, 165, 250, 0.25)',
  word: 'rgba(59, 130, 246, 0.5)',
  hover: 'rgba(134, 239, 172, 0.3)',
  selection: 'rgba(209, 213, 219, 0.45)'
}

/**
 * Paints Range rectangles into the background of their nearest block element.
 * Original inline background declarations are saved and restored exactly when
 * the final EchoRead highlight is removed from that element.
 */
class PaintWorkletHighlightRenderer implements HighlightRenderer {
  private readonly ranges = new Map<ReadingHighlightType, readonly Range[]>()
  private readonly elements = new Map<HTMLElement, ElementHighlightData>()
  private readonly originalStyles = new Map<
    HTMLElement,
    { backgroundImage: string; backgroundOrigin: string }
  >()
  private updateFrame: number | null = null

  constructor() {
    window.addEventListener('scroll', this.schedulePositionUpdate, { passive: true })
    window.addEventListener('resize', this.schedulePositionUpdate, { passive: true })
  }

  renderHighlights(
    ranges: readonly Range[],
    type: ReadingHighlightType
  ): void {
    this.clearHighlights(type)
    const validRanges = ranges.filter(isRangeConnected)
    this.ranges.set(type, validRanges)
    for (const range of validRanges) this.applyRange(range, type)
  }

  clearHighlights(type: ReadingHighlightType): void {
    this.ranges.delete(type)
    for (const [element, data] of [...this.elements]) {
      data[type] = []
      element.style.setProperty(WORKLET_PROPERTIES[type], '')
      if (hasNoRects(data)) this.cleanupElement(element)
    }
  }

  clearAllHighlights(): void {
    for (const type of Object.keys(WORKLET_PROPERTIES) as ReadingHighlightType[]) {
      this.clearHighlights(type)
    }
  }

  scrollToHighlight(type: ReadingHighlightType = 'sentence'): void {
    scrollFirstRangeIntoView(this.ranges.get(type))
  }

  destroy(): void {
    if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame)
    this.updateFrame = null
    window.removeEventListener('scroll', this.schedulePositionUpdate)
    window.removeEventListener('resize', this.schedulePositionUpdate)
    for (const element of [...this.elements.keys()]) this.cleanupElement(element)
    this.ranges.clear()
  }

  private readonly schedulePositionUpdate = (): void => {
    if (this.updateFrame !== null) return
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      const snapshot = [...this.ranges.entries()]
      for (const [type, ranges] of snapshot) this.renderHighlights(ranges, type)
    })
  }

  private applyRange(range: Range, type: ReadingHighlightType): void {
    const target = findBlockElement(range)
    const targetRect = target.getBoundingClientRect()
    const rects = getVisibleClientRects(range).map((rect) => ({
      x: rect.left - targetRect.left,
      y: rect.top - targetRect.top,
      width: rect.width,
      height: rect.height
    }))
    if (rects.length === 0) return

    let data = this.elements.get(target)
    if (!data) {
      data = { sentence: [], word: [], hover: [], selection: [] }
      this.elements.set(target, data)
      this.prepareElement(target)
    }
    data[type].push(...rects)
    target.style.setProperty(WORKLET_PROPERTIES[type], serializeRects(data[type]))
  }

  private prepareElement(element: HTMLElement): void {
    this.originalStyles.set(element, {
      backgroundImage: element.style.backgroundImage,
      backgroundOrigin: element.style.backgroundOrigin
    })
    element.style.setProperty('--echoSentenceColorDark', FALLBACK_COLORS.sentence)
    element.style.setProperty('--echoSentenceColorLight', FALLBACK_COLORS.sentence)
    element.style.setProperty('--echoWordColorDark', FALLBACK_COLORS.word)
    element.style.setProperty('--echoWordColorLight', FALLBACK_COLORS.word)
    element.style.setProperty('--echoHoverColorDark', FALLBACK_COLORS.hover)
    element.style.setProperty('--echoHoverColorLight', FALLBACK_COLORS.hover)
    element.style.setProperty('--echoSelectionColorDark', FALLBACK_COLORS.selection)
    element.style.setProperty('--echoSelectionColorLight', FALLBACK_COLORS.selection)
    element.style.setProperty('--echoElemColor', findOpaqueBackground(element))
    element.style.setProperty('--echoElemMatrix', '1,0,0,1,0,0')
    element.style.backgroundOrigin = 'border-box'

    const originalImage = this.originalStyles.get(element)?.backgroundImage
    element.style.backgroundImage = originalImage
      ? `paint(echoHighlighter), ${originalImage}`
      : 'paint(echoHighlighter)'
  }

  private cleanupElement(element: HTMLElement): void {
    for (const property of Object.values(WORKLET_PROPERTIES)) {
      element.style.removeProperty(property)
    }
    for (const property of [
      '--echoSentenceColorDark',
      '--echoSentenceColorLight',
      '--echoWordColorDark',
      '--echoWordColorLight',
      '--echoHoverColorDark',
      '--echoHoverColorLight',
      '--echoSelectionColorDark',
      '--echoSelectionColorLight',
      '--echoElemColor',
      '--echoElemMatrix'
    ]) {
      element.style.removeProperty(property)
    }

    const original = this.originalStyles.get(element)
    element.style.backgroundImage = original?.backgroundImage ?? ''
    element.style.backgroundOrigin = original?.backgroundOrigin ?? ''
    this.originalStyles.delete(element)
    this.elements.delete(element)
  }
}

/**
 * Draws fixed, pointer-transparent rectangles when CSS Paint is unavailable.
 * Fixed positioning lets client rectangles remain correct while the page scrolls;
 * resize and scroll events simply rebuild the small active highlight set.
 */
class DomOverlayHighlightRenderer implements HighlightRenderer {
  private readonly ranges = new Map<ReadingHighlightType, readonly Range[]>()
  private overlay: HTMLDivElement | null = null
  private updateFrame: number | null = null

  constructor() {
    window.addEventListener('scroll', this.schedulePositionUpdate, { passive: true })
    window.addEventListener('resize', this.schedulePositionUpdate, { passive: true })
  }

  renderHighlights(
    ranges: readonly Range[],
    type: ReadingHighlightType
  ): void {
    this.clearElements(type)
    const validRanges = ranges.filter(isRangeConnected)
    this.ranges.set(type, validRanges)
    const overlay = this.getOrCreateOverlay()

    for (const range of validRanges) {
      for (const rect of getVisibleClientRects(range)) {
        const element = document.createElement('div')
        element.dataset.echoReadHighlight = type
        Object.assign(element.style, {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          borderRadius: '3px',
          background: FALLBACK_COLORS[type],
          pointerEvents: 'none'
        })
        overlay.appendChild(element)
      }
    }
  }

  clearHighlights(type: ReadingHighlightType): void {
    this.ranges.delete(type)
    this.clearElements(type)
  }

  clearAllHighlights(): void {
    this.ranges.clear()
    this.overlay?.replaceChildren()
  }

  scrollToHighlight(type: ReadingHighlightType = 'sentence'): void {
    scrollFirstRangeIntoView(this.ranges.get(type))
  }

  destroy(): void {
    if (this.updateFrame !== null) cancelAnimationFrame(this.updateFrame)
    this.updateFrame = null
    window.removeEventListener('scroll', this.schedulePositionUpdate)
    window.removeEventListener('resize', this.schedulePositionUpdate)
    this.overlay?.remove()
    this.overlay = null
    this.ranges.clear()
  }

  private readonly schedulePositionUpdate = (): void => {
    if (this.updateFrame !== null) return
    this.updateFrame = requestAnimationFrame(() => {
      this.updateFrame = null
      const snapshot = [...this.ranges.entries()]
      for (const [type, ranges] of snapshot) this.renderHighlights(ranges, type)
    })
  }

  private getOrCreateOverlay(): HTMLDivElement {
    if (this.overlay?.isConnected) return this.overlay
    const overlay = document.createElement('div')
    overlay.id = 'echo-read-edge-highlight-overlay'
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483645',
      overflow: 'visible',
      pointerEvents: 'none'
    })
    document.documentElement.appendChild(overlay)
    this.overlay = overlay
    return overlay
  }

  private clearElements(type: ReadingHighlightType): void {
    this.overlay
      ?.querySelectorAll(`[data-echo-read-highlight="${type}"]`)
      .forEach((element) => element.remove())
  }
}

let activeRenderer: HighlightRenderer | null = null
let pendingRenderer: Promise<HighlightRenderer> | null = null
let rendererGeneration = 0

/**
 * Initializes the preferred renderer once and returns its stable facade.
 *
 * Hover feedback calls this on every pointer frame, so the in-flight promise is
 * shared: without it the frames dispatched while the worklet module loads each
 * build their own renderer, and those rivals then paint and tear down the same
 * page elements from separate bookkeeping.
 */
export async function initializeHighlightOverlay(): Promise<HighlightRenderer> {
  if (activeRenderer) return activeRenderer
  if (!pendingRenderer) {
    const requestedGeneration = rendererGeneration
    pendingRenderer = createRenderer().then((renderer) => {
      pendingRenderer = null
      if (requestedGeneration !== rendererGeneration) {
        // destroyHighlightOverlay() ran while this renderer was still loading.
        renderer.destroy()
        return renderer
      }
      activeRenderer = renderer
      return renderer
    })
  }
  return await pendingRenderer
}

async function createRenderer(): Promise<HighlightRenderer> {
  if (supportsPaintWorklet()) {
    try {
      await getPaintWorklet().addModule(chrome.runtime.getURL('highlight-worklet.js'))
      return new PaintWorkletHighlightRenderer()
    } catch {
      // A page or browser may expose Paint Worklet while refusing the extension
      // module. The overlay fallback preserves reading feedback in that case.
    }
  }

  return new DomOverlayHighlightRenderer()
}

/** Returns the initialized renderer without starting asynchronous work. */
export function getHighlightOverlay(): HighlightRenderer | null {
  return activeRenderer
}

/** Removes every extension-owned page style, overlay element, and listener. */
export function destroyHighlightOverlay(): void {
  rendererGeneration += 1
  pendingRenderer = null
  activeRenderer?.destroy()
  activeRenderer = null
}

function supportsPaintWorklet(): boolean {
  return typeof CSS !== 'undefined' && 'paintWorklet' in CSS
}

function getPaintWorklet(): { addModule(url: string): Promise<void> } {
  return (CSS as typeof CSS & {
    paintWorklet: { addModule(url: string): Promise<void> }
  }).paintWorklet
}

function getVisibleClientRects(range: Range): DOMRect[] {
  return [...range.getClientRects()].filter((rect) => rect.width >= 2 && rect.height >= 2)
}

function isRangeConnected(range: Range): boolean {
  return range.startContainer.isConnected && range.endContainer.isConnected
}

function findBlockElement(range: Range): HTMLElement {
  let element =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement

  while (element && element !== document.body) {
    const display = getComputedStyle(element).display
    if (['block', 'flex', 'grid', 'list-item', 'table-cell'].includes(display)) {
      return element
    }
    element = element.parentElement
  }
  return document.body
}

function findOpaqueBackground(element: HTMLElement): string {
  let candidate: HTMLElement | null = element
  while (candidate) {
    const color = getComputedStyle(candidate).backgroundColor
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
      return color
    }
    candidate = candidate.parentElement
  }
  return 'rgb(255, 255, 255)'
}

function serializeRects(rects: readonly RectData[]): string {
  return rects
    .flatMap(({ x, y, width, height }) => [x, y, width, height])
    .map((value) => value.toFixed(1))
    .join(',')
}

function hasNoRects(data: ElementHighlightData): boolean {
  return (
    data.sentence.length === 0 &&
    data.word.length === 0 &&
    data.hover.length === 0 &&
    data.selection.length === 0
  )
}

function scrollFirstRangeIntoView(ranges: readonly Range[] | undefined): void {
  const range = ranges?.find(isRangeConnected)
  if (!range) return
  const rect = range.getBoundingClientRect()
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return
  window.scrollTo({
    top: window.scrollY + rect.top - window.innerHeight / 3,
    behavior: 'smooth'
  })
}
