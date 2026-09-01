import type { DetailedDictionaryEntry } from '@/types'

export type DictionaryProviderErrorCode =
  | 'invalid-word'
  | 'not-found'
  | 'unavailable'

export class DictionaryProviderError extends Error {
  constructor(
    readonly code: DictionaryProviderErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DictionaryProviderError'
  }
}

export interface DictionaryProvider {
  readonly name: string
  /** Language this source writes its definitions in, used to namespace caches. */
  readonly definitionLanguage: string
  lookup(word: string, signal: AbortSignal): Promise<DetailedDictionaryEntry>
}

const VALID_WORD = /^[A-Za-z]+(?:['-][A-Za-z]+)*$/
const MIN_WORD_LENGTH = 2
const MAX_WORD_LENGTH = 64

/**
 * Every source indexes single English headwords, so one shared rule keeps a
 * lookup from turning a Provider's fixed host into an arbitrary path or query.
 */
export function normalizeDictionaryWord(word: string): string {
  const normalizedWord = word.trim().toLowerCase().replace(/\u2019/g, "'")
  if (
    !VALID_WORD.test(normalizedWord) ||
    normalizedWord.length < MIN_WORD_LENGTH ||
    normalizedWord.length > MAX_WORD_LENGTH
  ) {
    throw new DictionaryProviderError('invalid-word', 'Enter one valid English word.')
  }
  return normalizedWord
}
