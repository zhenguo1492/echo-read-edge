import type { SelectionInfo, SentencePosition } from '@/types'
import { TextPositionIndex } from '@/content/modules/text-position-index'

// The retained reader treats semicolons as bounded synthesis breaks in addition
// to conventional English and Chinese sentence-ending punctuation.
const SENTENCE_TERMINATORS = /[.!?。！？；;]/

/**
 * Abbreviations are retained from the legacy Speechify-inspired splitter. They
 * prevent common titles, dates, degrees, and technical references from creating
 * short and unnatural TTS requests at every period.
 */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'dr',
  'prof',
  'jr',
  'sr',
  'rev',
  'sgt',
  'col',
  'gen',
  'rep',
  'sen',
  'gov',
  'lt',
  'maj',
  'capt',
  'bsc',
  'msc',
  'phd',
  'md',
  'ba',
  'ma',
  'mm',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
  'sun',
  'mon',
  'tu',
  'tue',
  'tues',
  'wed',
  'th',
  'thu',
  'thur',
  'thurs',
  'fri',
  'sat',
  'al',
  'adj',
  'assn',
  'ave',
  'cell',
  'ch',
  'co',
  'cc',
  'corp',
  'dem',
  'dept',
  'ed',
  'eg',
  'eq',
  'eqs',
  'est',
  'etc',
  'ex',
  'ext',
  'fig',
  'figs',
  'ie',
  'inc',
  'mi',
  'mol',
  'mt',
  'mts',
  'no',
  'nos',
  'pl',
  'pop',
  'pp',
  'pt',
  'ref',
  'refs',
  'repr',
  'sec',
  'secs',
  'st',
  'trans',
  'univ',
  'viz',
  'vol',
  'vs',
  'v'
])

/**
 * Captures a stable snapshot of the current browser selection. The live Range is
 * cloned because page scripts may alter Selection after the toolbar event, while
 * its client rects are captured for later controller placement.
 */
export function getAccurateSelection(): SelectionInfo | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  return createSelectionInfoFromRange(selection.getRangeAt(0))
}

/**
 * Builds the same retained selection snapshot for modifier-key point selection.
 * This keeps Alt/Shift playback on the already tested block-aware segmentation
 * path instead of reviving the legacy player's separate position index.
 */
export function createSelectionInfoFromRange(range: Range): SelectionInfo | null {
  const rects = Array.from(range.getClientRects())
  if (rects.length === 0) return null

  const root = getIndexRoot(range)
  if (!root) return null
  const positionIndex = new TextPositionIndex()
  positionIndex.build(root)
  const offsets = positionIndex.getRangeOffsets(range)
  if (!offsets) return null

  const [selectionStart, selectionEnd] = offsets
  const rawText = positionIndex.getText().substring(selectionStart, selectionEnd)
  const leadingWhitespace = rawText.length - rawText.trimStart().length
  const trailingWhitespace = rawText.length - rawText.trimEnd().length
  const textStart = selectionStart + leadingWhitespace
  const textEnd = selectionEnd - trailingWhitespace
  if (textStart >= textEnd) return null

  const text = positionIndex.getText().substring(textStart, textEnd)
  const blockBoundaries = positionIndex
    .getBlockBoundaries()
    .filter((boundary) => boundary >= textStart && boundary < textEnd)
    .map((boundary) => boundary - textStart)
  const sentences = splitByBlockBoundaries(text, blockBoundaries).map(
    (sentence) => ({
      ...sentence,
      range: positionIndex.createRange(
        textStart + sentence.start,
        textStart + sentence.end
      )
    })
  )

  return {
    text,
    range: range.cloneRange(),
    rects,
    sentences
  }
}

/** Finds the smallest Element that can index both selection boundaries. */
function getIndexRoot(range: Range): Element | null {
  const commonAncestor = range.commonAncestorContainer
  return commonAncestor instanceof Element
    ? commonAncestor
    : commonAncestor.parentElement
}

/**
 * Splits plain text while preserving offsets into the original UTF-16 string.
 * Newlines remain whitespace rather than unconditional boundaries; callers that
 * know HTML block boundaries should use splitByBlockBoundaries instead.
 */
export function splitIntoSentences(text: string): SentencePosition[] {
  const sentences: SentencePosition[] = []
  let start = 0
  let index = 0

  const addSentence = (rawStart: number, rawEnd: number): void => {
    const rawText = text.substring(rawStart, rawEnd)
    const trimmedText = rawText.trim()
    if (!trimmedText) return

    const leadingWhitespace = rawText.length - rawText.trimStart().length
    const trailingWhitespace = rawText.length - rawText.trimEnd().length
    sentences.push({
      start: rawStart + leadingWhitespace,
      end: rawEnd - trailingWhitespace,
      text: trimmedText
    })
  }

  while (index < text.length) {
    const character = text[index]
    if (!SENTENCE_TERMINATORS.test(character)) {
      index += 1
      continue
    }

    // Chinese punctuation is self-delimiting and does not require a following
    // space or uppercase sentence starter.
    if (/[。！？；]/.test(character)) {
      addSentence(start, index + 1)
      index = skipWhitespace(text, index + 1)
      start = index
      continue
    }

    const isEndOfText = index === text.length - 1
    const nextCharacter = text[index + 1]
    const isFollowedByWhitespace = nextCharacter !== undefined && /\s/.test(nextCharacter)
    if (!isEndOfText && !isFollowedByWhitespace) {
      index += 1
      continue
    }

    const wordBefore = getWordBeforePeriod(text, index)
    if (isAbbreviation(wordBefore) || isDottedAbbreviation(wordBefore)) {
      index += 1
      continue
    }

    const nextWord = getNextWord(text, index)
    if (character === '.' && nextWord && !isSentenceStarter(nextWord)) {
      index += 1
      continue
    }

    addSentence(start, index + 1)
    index = skipWhitespace(text, index + 1)
    start = index
  }

  if (start < text.length) addSentence(start, text.length)
  return sentences
}

/** Applies a filtered-document base offset to plain-text sentence positions. */
export function analyzeSentences(text: string, baseOffset = 0): SentencePosition[] {
  return splitIntoSentences(text).map((sentence) => ({
    start: baseOffset + sentence.start,
    end: baseOffset + sentence.end,
    text: sentence.text
  }))
}

/**
 * Preserves explicit HTML block breaks supplied by the future text-position
 * index. Each boundary points at a synthetic newline separator in filtered text.
 */
export function splitByBlockBoundaries(
  text: string,
  blockBoundaries: readonly number[]
): SentencePosition[] {
  if (blockBoundaries.length === 0) return analyzeSentences(text)

  const sentences: SentencePosition[] = []
  let blockStart = 0
  for (const boundary of blockBoundaries) {
    if (boundary > blockStart) {
      const blockText = text.substring(blockStart, boundary)
      if (blockText.trim()) sentences.push(...analyzeSentences(blockText, blockStart))
    }
    blockStart = boundary + 1
  }

  if (blockStart < text.length) {
    const blockText = text.substring(blockStart)
    if (blockText.trim()) sentences.push(...analyzeSentences(blockText, blockStart))
  }
  return sentences
}

/** Returns whether a punctuation-adjacent token is a known abbreviation. */
export function isAbbreviation(word: string): boolean {
  return ABBREVIATIONS.has(word.replace(/[^\w]/g, '').toLowerCase())
}

/** Detects repeated-letter and common dotted abbreviations such as U.S. or e.g. */
export function isDottedAbbreviation(word: string): boolean {
  const cleaned = word.replace(/[^\w.]/g, '')
  if (/^([A-Za-z]\.)+$/.test(cleaned)) return true
  return ['e.g.', 'i.e.', 'vs.', 'etc.', 'a.m.', 'p.m.'].includes(cleaned.toLowerCase())
}

/**
 * Determines whether a following token plausibly begins a new sentence. Any
 * leading capital qualifies, including a lone letter: "A second one" and "I'm"
 * open sentences just as often as multi-letter words, and the abbreviation
 * checks that run before this one already protect "Dr." and "U.S." from
 * splitting on the token that follows them.
 */
export function isSentenceStarter(word: string): boolean {
  if (!word) return false
  if (/^[A-Z]/.test(word)) return true
  if (/^["'`]/.test(word)) return true
  return /^[\u4e00-\u9fff]/.test(word)
}

/** Extracts the non-whitespace token ending at the punctuation position. */
export function getWordBeforePeriod(text: string, position: number): string {
  let start = position
  while (start > 0 && /\S/.test(text[start - 1])) start -= 1
  return text.substring(start, position + 1)
}

/** Extracts the next non-whitespace token after a punctuation position. */
export function getNextWord(text: string, position: number): string {
  const start = skipWhitespace(text, position + 1)
  if (start >= text.length) return ''

  let end = start
  while (end < text.length && /\S/.test(text[end])) end += 1
  return text.substring(start, end)
}

/** Checks the live browser selection without allocating Range or rect snapshots. */
export function isValidSelection(): boolean {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
}

/** Clears only the browser's live selection; retained sentence state is separate. */
export function clearSelection(): void {
  window.getSelection()?.removeAllRanges()
}

function skipWhitespace(text: string, start: number): number {
  let index = start
  while (index < text.length && /\s/.test(text[index])) index += 1
  return index
}
