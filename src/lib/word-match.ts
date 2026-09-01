/**
 * Matches one spoken word against the text it was synthesized from.
 *
 * The rules are shared by the page reader, which turns a match into a DOM Range,
 * and by the dictionary examples, which highlight their own spans instead.
 */

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
