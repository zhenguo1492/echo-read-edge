/**
 * Derives the base forms an inflected English word may have been built from.
 *
 * A monolingual source such as Free Dictionary only indexes headwords, so it
 * answers 404 for “billions” although it defines “billion”. A lookup that
 * misses walks these candidates in order and stops at the first one the source
 * actually defines, which keeps the guesswork off the common path where the
 * word is a headword already.
 */

/** Enough for the longest rule below while a walk stays a few requests. */
const MAX_CANDIDATES = 5
const MIN_CANDIDATE_LENGTH = 2

/** Forms no suffix rule can reach, limited to the ones readers actually meet. */
const IRREGULAR_LEMMAS: Record<string, string> = {
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  geese: 'goose', mice: 'mouse', people: 'person', lives: 'life', knives: 'knife',
  wives: 'wife', leaves: 'leaf', halves: 'half', selves: 'self', wolves: 'wolf',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', does: 'do', did: 'do', done: 'do',
  went: 'go', gone: 'go', ran: 'run', ate: 'eat', eaten: 'eat',
  took: 'take', taken: 'take', saw: 'see', seen: 'see', made: 'make', said: 'say',
  came: 'come', got: 'get', gotten: 'get', knew: 'know', known: 'know',
  thought: 'think', found: 'find', gave: 'give', given: 'give', told: 'tell',
  became: 'become', began: 'begin', begun: 'begin', wrote: 'write', written: 'write',
  held: 'hold', kept: 'keep', left: 'leave', meant: 'mean', met: 'meet', paid: 'pay',
  sent: 'send', built: 'build', bought: 'buy', brought: 'bring', caught: 'catch',
  chose: 'choose', chosen: 'choose', fell: 'fall', felt: 'feel', grew: 'grow',
  heard: 'hear', lost: 'lose', spoke: 'speak', spoken: 'speak', stood: 'stand'
}

/** A plural s that is part of the headword instead of an inflection. */
const NON_PLURAL_ENDING = /(?:ss|us|is|as)$/
const SIBILANT_PLURAL = /(?:s|x|z|ch|sh|o)es$/
const DOUBLED_CONSONANT = /([^aeiou])\1$/

/** Ordered base forms to try, most likely first, never including the word. */
export function englishLemmaCandidates(word: string): string[] {
  const normalized = word.trim().toLowerCase()
  if (normalized.length < 3) return []

  const irregular = IRREGULAR_LEMMAS[normalized]
  const candidates = [
    ...(irregular ? [irregular] : []),
    ...possessiveForms(normalized),
    ...pluralForms(normalized),
    ...pastForms(normalized),
    ...progressiveForms(normalized),
    ...comparativeForms(normalized),
    ...adverbForms(normalized)
  ]

  return [...new Set(candidates)]
    .filter((candidate) => candidate.length >= MIN_CANDIDATE_LENGTH && candidate !== normalized)
    .slice(0, MAX_CANDIDATES)
}

function possessiveForms(word: string): string[] {
  if (word.endsWith("'s")) return [word.slice(0, -2)]
  if (word.endsWith("s'")) return [word.slice(0, -2), word.slice(0, -1)]
  return []
}

function pluralForms(word: string): string[] {
  if (!word.endsWith('s') || NON_PLURAL_ENDING.test(word)) return []
  if (word.endsWith('ies') && word.length > 4) {
    return [`${word.slice(0, -3)}y`, `${word.slice(0, -3)}ie`]
  }
  if (word.endsWith('ves') && word.length > 4) {
    return [word.slice(0, -1), `${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`]
  }
  if (SIBILANT_PLURAL.test(word)) return [word.slice(0, -2), word.slice(0, -1)]
  return [word.slice(0, -1)]
}

function pastForms(word: string): string[] {
  if (!word.endsWith('ed') || word.length < 4) return []
  if (word.endsWith('ied')) return [`${word.slice(0, -3)}y`, word.slice(0, -1)]
  const stem = word.slice(0, -2)
  return [stem, word.slice(0, -1), ...undoubled(stem)]
}

function progressiveForms(word: string): string[] {
  if (!word.endsWith('ing') || word.length < 5) return []
  const stem = word.slice(0, -3)
  return [stem, `${stem}e`, ...undoubled(stem)]
}

function comparativeForms(word: string): string[] {
  if (word.endsWith('iest') && word.length > 5) return [`${word.slice(0, -4)}y`]
  if (word.endsWith('ier') && word.length > 4) return [`${word.slice(0, -3)}y`]
  if (word.endsWith('est') && word.length > 5) {
    const stem = word.slice(0, -3)
    return [stem, `${stem}e`, ...undoubled(stem)]
  }
  if (word.endsWith('er') && word.length > 4) {
    const stem = word.slice(0, -2)
    return [stem, word.slice(0, -1), ...undoubled(stem)]
  }
  return []
}

function adverbForms(word: string): string[] {
  if (word.endsWith('ily') && word.length > 4) return [`${word.slice(0, -3)}y`]
  if (word.endsWith('ly') && word.length > 4) return [word.slice(0, -2)]
  return []
}

/** English doubles a final consonant before a suffix, as in running → run. */
function undoubled(stem: string): string[] {
  return DOUBLED_CONSONANT.test(stem) ? [stem.slice(0, -1)] : []
}
