import { openEchoReadDatabase, STORE_NAMES } from './indexed-db'
import { forEachCursor, requestResult, transactionComplete } from './idb-request'
import type { WordOccurrence, WordRecord } from './records'

/** Bounds taken from the storage design so one page cannot grow a record freely. */
export const VOCABULARY_LIMITS = {
  maxContextLength: 500,
  maxSourceTitleLength: 200,
  maxPageSize: 200
} as const

const DEFAULT_PAGE_SIZE = 50
const WORD_PATTERN = /^[a-z]+(?:['’-][a-z]+)*$/u

/** A word the reader saved, together with the sentences it was met in. */
export interface SavedWord extends WordRecord {
  occurrences: WordOccurrence[]
}

export interface SaveWordInput {
  word: string
  /** The sentence the word was read in, captured at save time. */
  context?: string
  sourceUrl?: string
  sourceTitle?: string
}

export interface WordQuery {
  /** Matches any part of the saved word. */
  search?: string
  /** The vocabulary list is ordered by save time in both directions. */
  direction?: 'newest' | 'oldest'
  limit?: number
  /** Opaque continuation token returned by the previous page. */
  cursor?: string | null
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface VocabularyRepository {
  getWord(word: string): Promise<SavedWord | null>
  listWords(query?: WordQuery): Promise<Page<SavedWord>>
  saveWord(input: SaveWordInput): Promise<SavedWord>
  removeWord(wordId: string): Promise<void>
  removeWordByName(word: string): Promise<boolean>
  countWords(): Promise<number>
}

/**
 * Stores vocabulary in IndexedDB from trusted extension contexts only. A word
 * has exactly one canonical record; every sentence it was met in becomes a
 * separate occurrence written in the same transaction as the word itself.
 */
export class IndexedDbVocabularyRepository implements VocabularyRepository {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async getWord(word: string): Promise<SavedWord | null> {
    const normalizedWord = normalizeWord(word)
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(
      [STORE_NAMES.words, STORE_NAMES.occurrences],
      'readonly'
    )
    const record = await findWordRecord(transaction, normalizedWord)
    if (!record) return null
    return { ...record, occurrences: await readOccurrences(transaction, record.id) }
  }

  async listWords(query: WordQuery = {}): Promise<Page<SavedWord>> {
    const limit = boundedPageSize(query.limit)
    const search = query.search?.trim().toLowerCase() ?? ''
    const cursorKey = parseCursor(query.cursor)
    const isNewestFirst = query.direction !== 'oldest'
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(
      [STORE_NAMES.words, STORE_NAMES.occurrences],
      'readonly'
    )
    const index = transaction.objectStore(STORE_NAMES.words).index('createdAt')
    const range = cursorKey
      ? isNewestFirst
        ? IDBKeyRange.upperBound(cursorKey.createdAt)
        : IDBKeyRange.lowerBound(cursorKey.createdAt)
      : null

    // Records sharing one createdAt value are skipped until the previous page's
    // last record is seen again, so an exact timestamp collision cannot repeat
    // or drop a word between pages.
    let isSkipping = cursorKey !== null
    const records: WordRecord[] = []
    let nextCursor: string | null = null

    await forEachCursor<WordRecord>(
      index.openCursor(range, isNewestFirst ? 'prev' : 'next'),
      (record) => {
        if (isSkipping) {
          if (record.createdAt !== cursorKey?.createdAt) isSkipping = false
          else if (record.id === cursorKey.id) {
            isSkipping = false
            return
          } else return
        }
        if (!matchesSearch(record, search)) return
        if (records.length === limit) {
          nextCursor = createCursor(records[records.length - 1])
          return false
        }
        records.push(record)
      }
    )

    // Sentences are read only for the page being returned, never for the whole
    // list, so paging cost does not grow with the size of the vocabulary.
    const items: SavedWord[] = []
    for (const record of records) {
      items.push({
        ...record,
        occurrences: await readOccurrences(transaction, record.id)
      })
    }
    return { items, nextCursor }
  }

  /**
   * Creates the word and its first sentence together, or adds another sentence
   * to a word the reader already saved. The same sentence from the same page is
   * kept once instead of growing on every repeated save.
   */
  async saveWord(input: SaveWordInput): Promise<SavedWord> {
    const normalizedWord = normalizeWord(input.word)
    const savedAt = this.clock().toISOString()
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(
      [STORE_NAMES.words, STORE_NAMES.occurrences],
      'readwrite'
    )
    const existing = await findWordRecord(transaction, normalizedWord)
    const record = existing
      ? { ...existing, updatedAt: savedAt }
      : createWordRecord(input, normalizedWord, savedAt)
    transaction.objectStore(STORE_NAMES.words).put(record)

    const occurrence = createOccurrence(record.id, input, savedAt)
    const stored = existing ? await readOccurrences(transaction, record.id) : []
    if (occurrence && !stored.some((item) => isSameOccurrence(item, occurrence))) {
      transaction.objectStore(STORE_NAMES.occurrences).put(occurrence)
      stored.unshift(occurrence)
    }

    await transactionComplete(transaction)
    return { ...record, occurrences: stored }
  }

  async removeWord(wordId: string): Promise<void> {
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(
      [STORE_NAMES.words, STORE_NAMES.occurrences],
      'readwrite'
    )
    transaction.objectStore(STORE_NAMES.words).delete(wordId)
    await deleteOccurrencesOf(transaction, wordId)
    await transactionComplete(transaction)
  }

  /** Content scripts know the word a reader unsaved, never its generated ID. */
  async removeWordByName(word: string): Promise<boolean> {
    const normalizedWord = normalizeWord(word)
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(
      [STORE_NAMES.words, STORE_NAMES.occurrences],
      'readwrite'
    )
    const record = await findWordRecord(transaction, normalizedWord)
    if (!record) return false

    transaction.objectStore(STORE_NAMES.words).delete(record.id)
    await deleteOccurrencesOf(transaction, record.id)
    await transactionComplete(transaction)
    return true
  }

  async countWords(): Promise<number> {
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(STORE_NAMES.words, 'readonly')
    return await requestResult(transaction.objectStore(STORE_NAMES.words).count())
  }
}

export const vocabularyRepository: VocabularyRepository =
  new IndexedDbVocabularyRepository()

/** Rejects anything that is not a plain English word before it reaches a key. */
export function normalizeWord(word: string): string {
  const normalizedWord = word.trim().toLowerCase()
  if (!WORD_PATTERN.test(normalizedWord)) {
    throw new TypeError(`${word} is not a word that can be saved.`)
  }
  return normalizedWord
}

function createWordRecord(
  input: SaveWordInput,
  normalizedWord: string,
  savedAt: string
): WordRecord {
  return {
    id: crypto.randomUUID(),
    word: input.word.trim(),
    normalizedWord,
    createdAt: savedAt,
    updatedAt: savedAt,
    schemaVersion: 1
  }
}

/** Returns null when the save carried neither a sentence nor a source page. */
function createOccurrence(
  wordId: string,
  input: SaveWordInput,
  savedAt: string
): WordOccurrence | null {
  const occurrence: WordOccurrence = {
    id: crypto.randomUUID(),
    wordId,
    ...optionalText('context', truncate(input.context, VOCABULARY_LIMITS.maxContextLength)),
    ...optionalText('sourceUrl', input.sourceUrl),
    ...optionalText(
      'sourceTitle',
      truncate(input.sourceTitle, VOCABULARY_LIMITS.maxSourceTitleLength)
    ),
    createdAt: savedAt
  }
  return occurrence.context || occurrence.sourceUrl ? occurrence : null
}

/** Saving the same word twice on one page must not duplicate its sentence. */
function isSameOccurrence(left: WordOccurrence, right: WordOccurrence): boolean {
  return left.context === right.context && left.sourceUrl === right.sourceUrl
}

/** Omits the key entirely so IndexedDB never stores an explicit undefined field. */
function optionalText<K extends string>(
  key: K,
  value: string | undefined
): Record<K, string> | Record<string, never> {
  const trimmed = value?.trim()
  return trimmed ? ({ [key]: trimmed } as Record<K, string>) : {}
}

function truncate(value: string | undefined, maximum: number): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > maximum ? trimmed.slice(0, maximum) : trimmed
}

function matchesSearch(record: WordRecord, search: string): boolean {
  return !search || record.normalizedWord.includes(search)
}

function boundedPageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_PAGE_SIZE
  }
  return Math.min(limit, VOCABULARY_LIMITS.maxPageSize)
}

function createCursor(record: WordRecord): string {
  return `${record.createdAt}|${record.id}`
}

function parseCursor(cursor: string | null | undefined): {
  createdAt: string
  id: string
} | null {
  if (!cursor) return null
  const separator = cursor.indexOf('|')
  if (separator <= 0) return null
  return {
    createdAt: cursor.slice(0, separator),
    id: cursor.slice(separator + 1)
  }
}

function findWordRecord(
  transaction: IDBTransaction,
  normalizedWord: string
): Promise<WordRecord | null> {
  const index = transaction.objectStore(STORE_NAMES.words).index('normalizedWord')
  return requestResult<WordRecord | undefined>(
    index.get(normalizedWord) as IDBRequest<WordRecord | undefined>
  ).then((record) => record ?? null)
}

/** Newest sentence first, so a list row can show the most recent one it has. */
async function readOccurrences(
  transaction: IDBTransaction,
  wordId: string
): Promise<WordOccurrence[]> {
  const index = transaction.objectStore(STORE_NAMES.occurrences).index('wordId')
  const occurrences = await requestResult<WordOccurrence[]>(
    index.getAll(IDBKeyRange.only(wordId)) as IDBRequest<WordOccurrence[]>
  )
  return occurrences.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

async function deleteOccurrencesOf(
  transaction: IDBTransaction,
  wordId: string
): Promise<void> {
  const index = transaction.objectStore(STORE_NAMES.occurrences).index('wordId')
  await forEachCursor<WordOccurrence>(
    index.openCursor(IDBKeyRange.only(wordId)),
    (_occurrence, cursor) => {
      cursor.delete()
    }
  )
}
