import type { DetailedDictionaryEntry } from '@/types'

/**
 * The canonical record for one normalized vocabulary word. A saved word keeps
 * no dictionary data: definitions stay in the dictionary cache and are looked
 * up again on demand, so the vocabulary list holds only what the reader met.
 */
export interface WordRecord {
  id: string
  word: string
  normalizedWord: string
  createdAt: string
  updatedAt: string
  schemaVersion: number
}

/**
 * The sentence a word was read in, captured separately from the canonical word
 * record so one word can carry every page it was met on.
 */
export interface WordOccurrence {
  id: string
  wordId: string
  context?: string
  sourceUrl?: string
  sourceTitle?: string
  createdAt: string
}

/** A normalized dictionary response retained until its explicit expiry time. */
export interface DictionaryCacheRecord {
  cacheKey: string
  normalizedWord: string
  provider: string
  data: DetailedDictionaryEntry
  createdAt: string
  expiresAt: string
}

/** Versioned database metadata that does not belong to a vocabulary record. */
export interface MetadataRecord {
  key: string
  value: unknown
  updatedAt: string
}
