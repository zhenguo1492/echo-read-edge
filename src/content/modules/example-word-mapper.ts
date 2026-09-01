import type { WordTimestamp } from '@/types'
import { findWordMatch } from './word-range-mapper'

export interface ExampleTextPart {
  text: string
  wordIndex: number | null
}

interface ExampleWordPosition {
  start: number
  end: number
  wordIndex: number
}

/** Splits visible text without changing punctuation or whitespace. */
export function splitExampleText(text: string): {
  parts: ExampleTextPart[]
  words: ExampleWordPosition[]
} {
  const parts: ExampleTextPart[] = []
  const words: ExampleWordPosition[] = []
  const pattern = /[A-Za-z0-9]+(?:['\u2019][A-Za-z0-9]+)*/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push({ text: text.substring(cursor, match.index), wordIndex: null })
    }
    const wordIndex = words.length
    parts.push({ text: match[0], wordIndex })
    words.push({ start: match.index, end: match.index + match[0].length, wordIndex })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ text: text.substring(cursor), wordIndex: null })
  return { parts, words }
}

/** Maps Edge boundary indexes to rendered word spans using the page reader matcher. */
export function mapExampleBoundariesToWords(
  text: string,
  boundaries: readonly WordTimestamp[]
): Map<number, number> {
  const { words } = splitExampleText(text)
  const mapping = new Map<number, number>()
  let searchStart = 0

  boundaries.forEach((boundary, boundaryIndex) => {
    const match = findWordMatch(text, boundary.word.trim(), searchStart)
    if (!match) return
    const matchEnd = match.index + match.length
    const word = words.find((candidate) => (
      candidate.start < matchEnd && candidate.end > match.index
    ))
    if (word) mapping.set(boundaryIndex, word.wordIndex)
    searchStart = matchEnd
  })
  return mapping
}
