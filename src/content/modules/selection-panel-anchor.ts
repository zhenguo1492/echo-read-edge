interface TextSlice {
  node: Text
  text: string
  nodeStart: number
  combinedStart: number
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu

/** Returns the final visible word in a selection for multi-sentence panel focus. */
export function getLastWordRange(selectionRange: Range): Range {
  const slices = collectSelectedText(selectionRange)
  const combinedText = slices.map((slice) => slice.text).join('')
  const matches = [...combinedText.matchAll(WORD_PATTERN)]
  const match = matches[matches.length - 1]
  if (!match || match.index === undefined) return selectionRange.cloneRange()

  const start = resolveBoundary(slices, match.index)
  const end = resolveBoundary(slices, match.index + match[0].length, true)
  if (!start || !end) return selectionRange.cloneRange()

  const wordRange = document.createRange()
  try {
    wordRange.setStart(start.node, start.offset)
    wordRange.setEnd(end.node, end.offset)
    return wordRange
  } catch {
    return selectionRange.cloneRange()
  }
}

function collectSelectedText(range: Range): TextSlice[] {
  const root = range.commonAncestorContainer
  const textNodes = root instanceof Text
    ? [root]
    : collectTextNodes(root)
  const slices: TextSlice[] = []
  let combinedStart = 0

  for (const node of textNodes) {
    if (!intersects(range, node)) continue
    const nodeStart = node === range.startContainer ? range.startOffset : 0
    const nodeEnd = node === range.endContainer ? range.endOffset : node.data.length
    if (nodeStart >= nodeEnd) continue
    const text = node.data.slice(nodeStart, nodeEnd)
    slices.push({ node, text, nodeStart, combinedStart })
    combinedStart += text.length
  }

  return slices
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    nodes.push(current as Text)
    current = walker.nextNode()
  }
  return nodes
}

function intersects(range: Range, node: Text): boolean {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}

function resolveBoundary(
  slices: readonly TextSlice[],
  offset: number,
  preferPrevious = false
): { node: Text; offset: number } | null {
  for (const slice of slices) {
    const sliceEnd = slice.combinedStart + slice.text.length
    if (
      offset < sliceEnd ||
      (offset === sliceEnd && (preferPrevious || slice === slices[slices.length - 1]))
    ) {
      return {
        node: slice.node,
        offset: slice.nodeStart + offset - slice.combinedStart
      }
    }
  }
  return null
}
