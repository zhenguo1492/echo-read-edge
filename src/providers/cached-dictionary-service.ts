import type { DetailedDictionaryEntry } from '@/types'
import {
  createDictionaryCacheRecord,
  type DictionaryCacheRepository
} from '@/storage/dictionary-cache-repository'
const CACHE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

interface CacheableDictionaryProvider {
  readonly name: string
  readonly definitionLanguage: string
  lookup(word: string, signal: AbortSignal): Promise<DetailedDictionaryEntry>
}

/**
 * Frontend implementation of the old dict.lookup orchestration: persistent
 * cache first, fixed Provider second, and automatic lemma expansion.
 */
export class CachedDictionaryService {
  private readonly inFlight = new Map<string, Promise<DetailedDictionaryEntry>>()

  constructor(
    private readonly provider: CacheableDictionaryProvider,
    private readonly cache: DictionaryCacheRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  lookup(word: string, signal: AbortSignal): Promise<DetailedDictionaryEntry> {
    const normalizedWord = word.trim().toLowerCase().replace(/\u2019/g, "'")
    const existing = this.inFlight.get(normalizedWord)
    if (existing) return existing

    const task = this.lookupWithLemma(normalizedWord, signal).finally(() => {
      if (this.inFlight.get(normalizedWord) === task) this.inFlight.delete(normalizedWord)
    })
    this.inFlight.set(normalizedWord, task)
    return task
  }

  private async lookupWithLemma(
    normalizedWord: string,
    signal: AbortSignal
  ): Promise<DetailedDictionaryEntry> {
    const entry = await this.lookupBase(normalizedWord, signal)
    if (!entry.lemma || entry.lemma === normalizedWord) return entry

    const lemmaEntry = await this.lookupBase(entry.lemma, signal)
    return {
      ...lemmaEntry,
      originalWord: normalizedWord,
      lemma: entry.lemma,
      isLemmatized: true,
      inflectedData: entry
    }
  }

  private async lookupBase(
    normalizedWord: string,
    signal: AbortSignal
  ): Promise<DetailedDictionaryEntry> {
    // The definition language is part of the key so a reader who switches
    // targets reads that source's entries instead of the other source's.
    const cacheKey =
      `${this.provider.name}:${this.provider.definitionLanguage}:${normalizedWord}`
    const now = this.now()
    try {
      const cached = await this.cache.get(cacheKey)
      if (cached && Date.parse(cached.expiresAt) > now.getTime()) return cached.data
      if (cached) await this.cache.remove(cacheKey)
    } catch {
      // Cache corruption or an unavailable database must not disable lookup.
    }

    const entry = await this.provider.lookup(normalizedWord, signal)
    const expiresAt = new Date(now.getTime() + CACHE_LIFETIME_MS)
    try {
      await this.cache.put(createDictionaryCacheRecord(
        cacheKey,
        normalizedWord,
        this.provider.name,
        entry,
        now,
        expiresAt
      ))
    } catch {
      // A successful remote result remains useful even when persistence is full.
    }
    return entry
  }
}
