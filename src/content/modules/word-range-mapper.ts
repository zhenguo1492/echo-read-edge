import type { WordTimestamp } from '@/types'

interface TextSegment {
  node: Text
  nodeStart: number
  nodeEnd: number
  textStart: number
  textEnd: number
}

export interface WordMatch {
  index: number
  length: number
}

const TTS_ABBREVIATIONS: Record<string, string[]> = {
  etcetera: ['etc.', 'etc'],
  versus: ['vs.', 'vs'],
  doctor: ['dr.', 'dr'],
  mister: ['mr.', 'mr'],
  missus: ['mrs.', 'mrs'],
  miss: ['ms.', 'ms'],
  professor: ['prof.', 'prof'],
  saint: ['st.', 'st'],
  junior: ['jr.', 'jr'],
  senior: ['sr.', 'sr'],
  dot: ['.']
}

/**
 * Ports the retained legacy timestamp-to-Range behavior onto one selected
 * sentence Range. Matching is sequential so repeated words map to their spoken
 * occurrence, and every output slot retains the corresponding boundary index.
 */
export function createWordRanges(
  sentenceRange: Range,
  timestamps: readonly WordTimestamp[]
): Array<Range | null> {
  const segments = collectTextSegments(sentenceRange)
  const sentenceText = segments
    .map(({ node, nodeStart, nodeEnd }) => node.data.substring(nodeStart, nodeEnd))
    .join('')
  const ranges: Array<Range | null> = []
  let searchStart = 0

  for (const timestamp of timestamps) {
    const spokenWord = timestamp.word.trim()
    const match = spokenWord
      ? findWordMatch(sentenceText, spokenWord, searchStart)
      : null
    if (!match) {
      ranges.push(null)
      continue
    }

    ranges.push(
      createRangeFromSegments(segments, match.index, match.index + match.length)
    )
    searchStart = match.index + match.length
  }
  return ranges
}

function collectTextSegments(range: Range): TextSegment[] {
  const root = range.commonAncestorContainer
  const textNodes: Text[] = []
  if (root instanceof Text) {
    textNodes.push(root)
  } else {
    collectDescendantTextNodes(root, textNodes)
  }

  const segments: TextSegment[] = []
  let textOffset = 0
  for (const node of textNodes) {
    if (!node.isConnected || !rangesIntersectTextNode(range, node)) continue
    const nodeStart = node === range.startContainer ? range.startOffset : 0
    const nodeEnd = node === range.endContainer ? range.endOffset : node.data.length
    if (nodeEnd <= nodeStart) continue

    const length = nodeEnd - nodeStart
    segments.push({
      node,
      nodeStart,
      nodeEnd,
      textStart: textOffset,
      textEnd: textOffset + length
    })
    textOffset += length
  }
  return segments
}

function collectDescendantTextNodes(node: Node, output: Text[]): void {
  for (const child of node.childNodes) {
    if (child instanceof Text) output.push(child)
    else collectDescendantTextNodes(child, output)
  }
}

/**
 * Uses boundary comparisons because some DOM implementations expose an
 * incomplete Range.intersectsNode() for text nested below the common ancestor.
 */
function rangesIntersectTextNode(range: Range, node: Text): boolean {
  const nodeRange = document.createRange()
  nodeRange.selectNodeContents(node)
  return (
    nodeRange.compareBoundaryPoints(Range.END_TO_START, range) < 0 &&
    nodeRange.compareBoundaryPoints(Range.START_TO_END, range) > 0
  )
}

function createRangeFromSegments(
  segments: readonly TextSegment[],
  start: number,
  end: number
): Range | null {
  const startSegment = segments.find(
    (segment) => start >= segment.textStart && start < segment.textEnd
  )
  const endSegment = [...segments].reverse().find(
    (segment) => end > segment.textStart && end <= segment.textEnd
  )
  if (!startSegment || !endSegment || end <= start) return null

  const range = document.createRange()
  range.setStart(
    startSegment.node,
    startSegment.nodeStart + start - startSegment.textStart
  )
  range.setEnd(
    endSegment.node,
    endSegment.nodeStart + end - endSegment.textStart
  )
  return range
}

/** Uses the legacy ordered strategies while returning the actual page length. */
export function findWordMatch(
  text: string,
  word: string,
  searchStart: number
): WordMatch | null {
  if (!/\w/.test(word)) {
    const punctuationIndex = text.indexOf(word, searchStart)
    if (punctuationIndex >= 0) return { index: punctuationIndex, length: word.length }
  }

  const boundaryIndex = findAtWordBoundary(text, word, searchStart)
  if (boundaryIndex >= 0) return { index: boundaryIndex, length: word.length }

  const cleanWord = word.replace(/^[^\w]+|[^\w]+$/g, '')
  if (cleanWord && cleanWord !== word) {
    const cleanIndex = findAtWordBoundary(text, cleanWord, searchStart)
    if (cleanIndex >= 0) return { index: cleanIndex, length: cleanWord.length }
  }

  const normalizedText = normalizeQuotes(text)
  const normalizedWord = normalizeQuotes(word)
  const normalizedIndex = normalizedText
    .toLowerCase()
    .indexOf(normalizedWord.toLowerCase(), searchStart)
  if (normalizedIndex >= 0) {
    return { index: normalizedIndex, length: normalizedWord.length }
  }

  const abbreviation = TTS_ABBREVIATIONS[word.toLowerCase()]
  if (abbreviation) {
    const lowerText = text.toLowerCase()
    for (const candidate of abbreviation) {
      const index = lowerText.indexOf(candidate, searchStart)
      if (index >= 0) return { index, length: candidate.length }
    }
  }
  return null
}

function findAtWordBoundary(text: string, word: string, searchStart: number): number {
  const lowerText = text.toLowerCase()
  const lowerWord = word.toLowerCase()
  let position = searchStart

  while (position < text.length) {
    const index = lowerText.indexOf(lowerWord, position)
    if (index < 0) return -1
    const before = index > 0 ? text[index - 1] : ' '
    const after = index + word.length < text.length ? text[index + word.length] : ' '
    if (!/\w/.test(before) && !/\w/.test(after)) return index
    position = index + 1
  }
  return -1
}

function normalizeQuotes(value: string): string {
  return value
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
}
