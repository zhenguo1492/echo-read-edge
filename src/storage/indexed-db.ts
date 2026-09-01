export const DATABASE_NAME = 'EchoReadDB'
export const DATABASE_VERSION = 1

export const STORE_NAMES = {
  words: 'words',
  occurrences: 'occurrences',
  dictionaryCache: 'dictionaryCache',
  metadata: 'metadata'
} as const

export interface OpenDatabaseOptions {
  /** Allows deterministic tests without changing the production IndexedDB global. */
  factory?: IDBFactory
  /** Reports another extension context that is preventing a schema upgrade. */
  onBlocked?: () => void
}

let sharedDatabase: IDBDatabase | null = null
let pendingOpen: Promise<IDBDatabase> | null = null

/**
 * Opens the shared extension database and applies every schema migration inside
 * the browser-owned versionchange transaction. Concurrent callers share one
 * request, while a suspended service worker can safely create a fresh connection.
 */
export function openEchoReadDatabase(
  options: OpenDatabaseOptions = {}
): Promise<IDBDatabase> {
  if (sharedDatabase) return Promise.resolve(sharedDatabase)
  if (pendingOpen) return pendingOpen

  // A content script inherits the page URL even though it can see chrome.runtime.
  // Requiring the extension origin keeps direct database access in trusted
  // extension pages and the service worker. Tests use an injected factory.
  if (!options.factory && globalThis.location?.protocol !== 'chrome-extension:') {
    return Promise.reject(
      new Error('The EchoRead database is available only to trusted extension contexts.')
    )
  }

  const factory = options.factory ?? globalThis.indexedDB
  if (!factory) {
    return Promise.reject(new Error('IndexedDB is unavailable in this extension context.'))
  }

  pendingOpen = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      const transaction = request.transaction
      if (!transaction) {
        throw new Error('IndexedDB did not provide an upgrade transaction.')
      }

      applySchema(database, transaction)
    }

    request.onblocked = () => options.onBlocked?.()

    request.onerror = () => {
      pendingOpen = null
      reject(request.error ?? new Error('IndexedDB could not be opened.'))
    }

    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        if (sharedDatabase === database) sharedDatabase = null
      }

      sharedDatabase = database
      pendingOpen = null
      resolve(database)
    }
  })

  return pendingOpen
}

/** Closes the cached connection so tests, upgrades, and shutdown paths can reopen it. */
export function closeEchoReadDatabase(): void {
  sharedDatabase?.close()
  sharedDatabase = null
  pendingOpen = null
}

/**
 * Creates only missing stores and indexes. This keeps the migration idempotent
 * for partially initialized development databases without deleting user data.
 */
function applySchema(database: IDBDatabase, transaction: IDBTransaction): void {
  const words = getOrCreateStore(database, transaction, STORE_NAMES.words, {
    keyPath: 'id'
  })
  createIndexIfMissing(words, 'normalizedWord', 'normalizedWord', { unique: true })
  createIndexIfMissing(words, 'createdAt', 'createdAt')
  createIndexIfMissing(words, 'updatedAt', 'updatedAt')

  const occurrences = getOrCreateStore(
    database,
    transaction,
    STORE_NAMES.occurrences,
    { keyPath: 'id' }
  )
  createIndexIfMissing(occurrences, 'wordId', 'wordId')
  createIndexIfMissing(occurrences, 'sourceUrl', 'sourceUrl')
  createIndexIfMissing(occurrences, 'createdAt', 'createdAt')
  createIndexIfMissing(occurrences, 'wordIdSourceUrl', ['wordId', 'sourceUrl'])

  const dictionaryCache = getOrCreateStore(
    database,
    transaction,
    STORE_NAMES.dictionaryCache,
    { keyPath: 'cacheKey' }
  )
  createIndexIfMissing(dictionaryCache, 'normalizedWord', 'normalizedWord')
  createIndexIfMissing(dictionaryCache, 'expiresAt', 'expiresAt')

  getOrCreateStore(database, transaction, STORE_NAMES.metadata, { keyPath: 'key' })
}

function getOrCreateStore(
  database: IDBDatabase,
  transaction: IDBTransaction,
  name: string,
  options: IDBObjectStoreParameters
): IDBObjectStore {
  return database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, options)
}

function createIndexIfMissing(
  store: IDBObjectStore,
  name: string,
  keyPath: string | string[],
  options?: IDBIndexParameters
): void {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options)
}
