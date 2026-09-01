interface IndexedTextNode {
  node: Text
  start: number
  end: number
}

const BLOCK_ELEMENTS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'article',
  'section',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'td',
  'th',
  'figure',
  'figcaption',
  'address',
  'details',
  'summary'
])

const BLOCK_DISPLAY_VALUES = new Set([
  'block',
  'flex',
  'grid',
  'list-item',
  'table-cell'
])

/**
 * Minimal port of the legacy CharacterPositionIndex used by selection reading.
 * Synthetic newlines make DOM block transitions part of the same coordinate
 * space used for sentence splitting and Range reconstruction.
 */
export class TextPositionIndex {
  private nodes: IndexedTextNode[] = []
  private text = ''
  private blockBoundaries: number[] = []

  build(contentElement: Element): void {
    this.nodes = []
    this.text = ''
    this.blockBoundaries = []
    let position = 0
    let lastBlockElement: Element | null = null

    for (const node of collectTextNodes(contentElement)) {
      const parent = node.parentElement
      if (!parent || parent.closest('#echo-read-edge-content-root')) continue
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME'].includes(parent.tagName)) continue
      if (parent.closest('.katex-mathml')) continue
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') continue

      const currentBlockElement = findBlockParent(node)
      if (
        lastBlockElement &&
        currentBlockElement &&
        lastBlockElement !== currentBlockElement
      ) {
        if (!this.text.endsWith('\n')) {
          this.text += '\n'
          position += 1
        }
        this.blockBoundaries.push(position - 1)
      }
      lastBlockElement = currentBlockElement

      const nodeText = node.data
      this.nodes.push({ node, start: position, end: position + nodeText.length })
      this.text += nodeText
      position += nodeText.length
    }
  }

  getText(): string {
    return this.text
  }

  getBlockBoundaries(): readonly number[] {
    return this.blockBoundaries
  }

  /** Resolves selection boundaries even when the Range starts on an Element. */
  getRangeOffsets(range: Range): [number, number] | null {
    const exactStart = this.nodes.find(
      ({ node }) => node === range.startContainer
    )
    const exactEnd = this.nodes.find(({ node }) => node === range.endContainer)
    if (exactStart && exactEnd) {
      const start = exactStart.start + range.startOffset
      const end = exactEnd.start + range.endOffset
      return start < end ? [start, end] : null
    }

    // Element-boundary selections cannot be matched by node identity. In that
    // less common case, use the first and last intersecting indexed text nodes.
    const selectedNodes = this.nodes.filter(({ node }) => {
      try {
        return range.intersectsNode(node)
      } catch {
        return false
      }
    })
    const first = selectedNodes[0]
    const last = selectedNodes[selectedNodes.length - 1]
    if (!first || !last) return null

    const start =
      range.startContainer === first.node
        ? first.start + range.startOffset
        : first.start
    const end =
      range.endContainer === last.node
        ? last.start + range.endOffset
        : last.end
    return start < end ? [start, end] : null
  }

  createRange(start: number, end: number): Range | null {
    if (start < 0 || end > this.text.length || start >= end) return null
    const startNode = this.findNodeAtPosition(start)
    const endNode = this.findNodeAtPosition(end - 1)
    if (!startNode || !endNode) return null

    const range = document.createRange()
    try {
      range.setStart(startNode.node, start - startNode.start)
      range.setEnd(endNode.node, end - endNode.start)
      return range
    } catch {
      return null
    }
  }

  private findNodeAtPosition(position: number): IndexedTextNode | null {
    let left = 0
    let right = this.nodes.length - 1
    while (left <= right) {
      const middle = Math.floor((left + right) / 2)
      const node = this.nodes[middle]
      if (position < node.start) right = middle - 1
      else if (position >= node.end) left = middle + 1
      else return node
    }
    return null
  }
}

function findBlockParent(node: Node): Element | null {
  let current = node.parentElement
  while (current) {
    if (BLOCK_ELEMENTS.has(current.tagName.toLowerCase())) return current
    if (BLOCK_DISPLAY_VALUES.has(getComputedStyle(current).display)) return current
    current = current.parentElement
  }
  return null
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = []
  for (const child of root.childNodes) {
    if (child instanceof Text) nodes.push(child)
    else nodes.push(...collectTextNodes(child))
  }
  return nodes
}
