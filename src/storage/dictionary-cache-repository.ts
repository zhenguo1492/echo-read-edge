import type { DetailedDictionaryEntry } from '@/types'
import { openEchoReadDatabase, STORE_NAMES } from './indexed-db'
import { requestResult, transactionComplete } from './idb-request'
import type { DictionaryCacheRecord } from './records'

export interface DictionaryCacheRepository {
  get(cacheKey: string): Promise<DictionaryCacheRecord | null>
  put(record: DictionaryCacheRecord): Promise<void>
  remove(cacheKey: string): Promise<void>
}

/** IndexedDB implementation used only by trusted extension contexts. */
export class IndexedDbDictionaryCacheRepository implements DictionaryCacheRepository {
  async get(cacheKey: string): Promise<DictionaryCacheRecord | null> {
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(STORE_NAMES.dictionaryCache, 'readonly')
    const request = transaction.objectStore(STORE_NAMES.dictionaryCache).get(cacheKey)
    const value = await requestResult<DictionaryCacheRecord | undefined>(request)
    return value ?? null
  }

  async put(record: DictionaryCacheRecord): Promise<void> {
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(STORE_NAMES.dictionaryCache, 'readwrite')
    transaction.objectStore(STORE_NAMES.dictionaryCache).put(record)
    await transactionComplete(transaction)
  }

  async remove(cacheKey: string): Promise<void> {
    const database = await openEchoReadDatabase()
    const transaction = database.transaction(STORE_NAMES.dictionaryCache, 'readwrite')
    transaction.objectStore(STORE_NAMES.dictionaryCache).delete(cacheKey)
    await transactionComplete(transaction)
  }
}

export function createDictionaryCacheRecord(
  cacheKey: string,
  normalizedWord: string,
  provider: string,
  data: DetailedDictionaryEntry,
  createdAt: Date,
  expiresAt: Date
): DictionaryCacheRecord {
  return {
    cacheKey,
    normalizedWord,
    provider,
    data,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  }
}
