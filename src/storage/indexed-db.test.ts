import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_NAMES,
  closeEchoReadDatabase,
  openEchoReadDatabase
} from './indexed-db'

class MockNameList {
  constructor(private readonly names: string[]) {}

  contains(name: string): boolean {
    return this.names.includes(name)
  }
}

class MockObjectStore {
  readonly indexes = new Map<
    string,
    { keyPath: string | string[]; options?: IDBIndexParameters }
  >()

  get indexNames(): DOMStringList {
    return new MockNameList([...this.indexes.keys()]) as unknown as DOMStringList
  }

  createIndex(
    name: string,
    keyPath: string | string[],
    options?: IDBIndexParameters
  ): IDBIndex {
    this.indexes.set(name, { keyPath, options })
    return {} as IDBIndex
  }
}

class MockDatabase {
  readonly stores = new Map<string, MockObjectStore>()
  readonly close = vi.fn()
  onversionchange: ((event: IDBVersionChangeEvent) => void) | null = null

  get objectStoreNames(): DOMStringList {
    return new MockNameList([...this.stores.keys()]) as unknown as DOMStringList
  }

  createObjectStore(name: string): IDBObjectStore {
    const store = new MockObjectStore()
    this.stores.set(name, store)
    return store as unknown as IDBObjectStore
  }
}

class MockTransaction {
  constructor(private readonly database: MockDatabase) {}

  objectStore(name: string): IDBObjectStore {
    const store = this.database.stores.get(name)
    if (!store) throw new Error(`Missing mock store: ${name}`)
    return store as unknown as IDBObjectStore
  }
}

interface MockOpenScenario {
  database?: MockDatabase
  blocked?: boolean
  error?: Error
  upgrade?: boolean
}

class MockFactory {
  readonly open = vi.fn((name: string, version?: number) => {
    const scenario = this.scenarios.shift() ?? {}
    const database = scenario.database ?? new MockDatabase()
    const request = {
      result: database as unknown as IDBDatabase,
      transaction: new MockTransaction(database) as unknown as IDBTransaction,
      error: scenario.error ?? null,
      onupgradeneeded: null,
      onblocked: null,
      onerror: null,
      onsuccess: null
    } as unknown as IDBOpenDBRequest

    queueMicrotask(() => {
      if (scenario.blocked) {
        request.onblocked?.(new Event('blocked') as IDBVersionChangeEvent)
      }
      if (scenario.error) {
        request.onerror?.(new Event('error'))
        return
      }
      if (scenario.upgrade !== false) {
        request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
      }
      request.onsuccess?.(new Event('success'))
    })

    expect(name).toBe(DATABASE_NAME)
    expect(version).toBe(DATABASE_VERSION)
    return request
  })

  constructor(private readonly scenarios: MockOpenScenario[]) {}
}

describe('EchoRead IndexedDB schema', () => {
  afterEach(() => closeEchoReadDatabase())

  it('creates the four version-one stores and their indexes', async () => {
    const database = new MockDatabase()
    const factory = new MockFactory([{ database }])

    await openEchoReadDatabase({ factory: factory as unknown as IDBFactory })

    expect([...database.stores.keys()]).toEqual(Object.values(STORE_NAMES))
    expect([...database.stores.get(STORE_NAMES.words)!.indexes]).toEqual([
      ['normalizedWord', { keyPath: 'normalizedWord', options: { unique: true } }],
      ['createdAt', { keyPath: 'createdAt', options: undefined }],
      ['updatedAt', { keyPath: 'updatedAt', options: undefined }]
    ])
    expect([...database.stores.get(STORE_NAMES.occurrences)!.indexes]).toEqual([
      ['wordId', { keyPath: 'wordId', options: undefined }],
      ['sourceUrl', { keyPath: 'sourceUrl', options: undefined }],
      ['createdAt', { keyPath: 'createdAt', options: undefined }],
      ['wordIdSourceUrl', { keyPath: ['wordId', 'sourceUrl'], options: undefined }]
    ])
    expect([...database.stores.get(STORE_NAMES.dictionaryCache)!.indexes]).toEqual([
      ['normalizedWord', { keyPath: 'normalizedWord', options: undefined }],
      ['expiresAt', { keyPath: 'expiresAt', options: undefined }]
    ])
  })

  it('preserves existing stores and indexes during a repeated migration', async () => {
    const database = new MockDatabase()
    const words = database.createObjectStore(STORE_NAMES.words) as unknown as MockObjectStore
    words.createIndex('normalizedWord', 'normalizedWord', { unique: true })
    const factory = new MockFactory([{ database }])

    await openEchoReadDatabase({ factory: factory as unknown as IDBFactory })

    expect(database.stores.get(STORE_NAMES.words)).toBe(words)
    expect(words.indexes.size).toBe(3)
    expect(database.stores.size).toBe(4)
  })

  it('shares one open request between concurrent callers', async () => {
    const factory = new MockFactory([{}])
    const first = openEchoReadDatabase({ factory: factory as unknown as IDBFactory })
    const second = openEchoReadDatabase({ factory: factory as unknown as IDBFactory })

    const [firstDatabase, secondDatabase] = await Promise.all([first, second])

    expect(firstDatabase).toBe(secondDatabase)
    expect(factory.open).toHaveBeenCalledTimes(1)
  })

  it('closes a stale connection and opens a new one after versionchange', async () => {
    const firstDatabase = new MockDatabase()
    const secondDatabase = new MockDatabase()
    const factory = new MockFactory([
      { database: firstDatabase },
      { database: secondDatabase, upgrade: false }
    ])

    await openEchoReadDatabase({ factory: factory as unknown as IDBFactory })
    firstDatabase.onversionchange?.({} as IDBVersionChangeEvent)
    const reopened = await openEchoReadDatabase({ factory: factory as unknown as IDBFactory })

    expect(firstDatabase.close).toHaveBeenCalledOnce()
    expect(reopened).toBe(secondDatabase)
    expect(factory.open).toHaveBeenCalledTimes(2)
  })

  it('reports blocked upgrades while leaving the request pending', async () => {
    const onBlocked = vi.fn()
    const factory = new MockFactory([{ blocked: true }])

    await openEchoReadDatabase({
      factory: factory as unknown as IDBFactory,
      onBlocked
    })

    expect(onBlocked).toHaveBeenCalledOnce()
  })

  it('rejects an open error and permits a later retry', async () => {
    const failure = new Error('Database unavailable')
    const successfulDatabase = new MockDatabase()
    const factory = new MockFactory([
      { error: failure },
      { database: successfulDatabase }
    ])

    await expect(
      openEchoReadDatabase({ factory: factory as unknown as IDBFactory })
    ).rejects.toBe(failure)
    await expect(
      openEchoReadDatabase({ factory: factory as unknown as IDBFactory })
    ).resolves.toBe(successfulDatabase)
    expect(factory.open).toHaveBeenCalledTimes(2)
  })

  it('rejects direct access from a normal web-page context', async () => {
    await expect(openEchoReadDatabase()).rejects.toThrow(
      'available only to trusted extension contexts'
    )
  })
})
