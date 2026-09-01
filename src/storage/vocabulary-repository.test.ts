import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeEchoReadDatabase, openEchoReadDatabase } from './indexed-db'
import { IndexedDbVocabularyRepository } from './vocabulary-repository'

let clockTime = Date.UTC(2026, 0, 1, 9, 0, 0)

function nextSaveTime(): Date {
  clockTime += 60_000
  return new Date(clockTime)
}

function createRepository(): IndexedDbVocabularyRepository {
  return new IndexedDbVocabularyRepository(nextSaveTime)
}

beforeEach(async () => {
  clockTime = Date.UTC(2026, 0, 1, 9, 0, 0)
  // happy-dom has no IndexedDB engine, so the repository runs against the real
  // algorithms provided by fake-indexeddb instead of a hand-written stub.
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  closeEchoReadDatabase()
  const factory = new IDBFactory()
  await openEchoReadDatabase({ factory })
})

afterEach(() => {
  closeEchoReadDatabase()
  vi.unstubAllGlobals()
})

describe('IndexedDbVocabularyRepository', () => {
  it('saves the word and the sentence it was read in, and nothing else', async () => {
    const repository = createRepository()

    const saved = await repository.saveWord({
      word: 'Resilient',
      context: 'The city proved resilient after the storm.',
      sourceUrl: 'https://example.com/article',
      sourceTitle: 'A resilient city'
    })

    expect(saved.normalizedWord).toBe('resilient')
    expect(saved.word).toBe('Resilient')
    expect(await repository.countWords()).toBe(1)
    expect(saved.occurrences).toHaveLength(1)
    expect(saved.occurrences[0].context)
      .toBe('The city proved resilient after the storm.')
    expect(saved.occurrences[0].sourceTitle).toBe('A resilient city')
    expect(Object.keys(saved).sort()).toEqual([
      'createdAt',
      'id',
      'normalizedWord',
      'occurrences',
      'schemaVersion',
      'updatedAt',
      'word'
    ])
  })

  it('keeps one word record while adding a sentence for every page', async () => {
    const repository = createRepository()

    const first = await repository.saveWord({
      word: 'resilient',
      context: 'The city proved resilient after the storm.',
      sourceUrl: 'https://example.com/one'
    })
    const second = await repository.saveWord({
      word: 'resilient',
      context: 'A resilient design survives its first release.',
      sourceUrl: 'https://example.com/two'
    })

    expect(second.id).toBe(first.id)
    expect(await repository.countWords()).toBe(1)
    expect(second.occurrences.map((item) => item.sourceUrl))
      .toEqual(['https://example.com/two', 'https://example.com/one'])
    expect(second.createdAt).not.toBe(second.updatedAt)
  })

  it('does not repeat the same sentence when one page is saved twice', async () => {
    const repository = createRepository()
    const save = {
      word: 'resilient',
      context: 'The city proved resilient after the storm.',
      sourceUrl: 'https://example.com/one'
    }

    await repository.saveWord(save)
    const second = await repository.saveWord(save)

    expect(second.occurrences).toHaveLength(1)
  })

  it('applies the documented per-record storage limits', async () => {
    const repository = createRepository()

    const saved = await repository.saveWord({
      word: 'bounded',
      context: 'y'.repeat(900),
      sourceTitle: 't'.repeat(400),
      sourceUrl: 'https://example.com/bounded'
    })

    expect(saved.occurrences[0].context).toHaveLength(500)
    expect(saved.occurrences[0].sourceTitle).toHaveLength(200)
  })

  it('lists saved words newest first and can page through them', async () => {
    const repository = createRepository()
    for (const word of ['alpha', 'bravo', 'charlie', 'delta']) {
      await repository.saveWord({ word, sourceUrl: `https://example.com/${word}` })
    }

    const firstPage = await repository.listWords({ limit: 2 })
    expect(firstPage.items.map((item) => item.word)).toEqual(['delta', 'charlie'])
    expect(firstPage.nextCursor).not.toBeNull()

    const secondPage = await repository.listWords({
      limit: 2,
      cursor: firstPage.nextCursor
    })
    expect(secondPage.items.map((item) => item.word)).toEqual(['bravo', 'alpha'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('lists saved words oldest first when the reader reverses the order', async () => {
    const repository = createRepository()
    for (const word of ['alpha', 'bravo', 'charlie']) {
      await repository.saveWord({ word })
    }

    const page = await repository.listWords({ direction: 'oldest' })
    expect(page.items.map((item) => item.word)).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('pages correctly when several words share one save timestamp', async () => {
    const fixedTime = new Date(Date.UTC(2026, 0, 2, 8, 0, 0))
    const repository = new IndexedDbVocabularyRepository(() => fixedTime)
    for (const word of ['alpha', 'bravo', 'charlie']) {
      await repository.saveWord({ word })
    }

    const firstPage = await repository.listWords({ limit: 2 })
    const secondPage = await repository.listWords({
      limit: 2,
      cursor: firstPage.nextCursor
    })
    const listed = [...firstPage.items, ...secondPage.items].map((item) => item.word)

    expect(listed).toHaveLength(3)
    expect([...listed].sort()).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('searches any part of the saved word', async () => {
    const repository = createRepository()
    await repository.saveWord({ word: 'resilient' })
    await repository.saveWord({ word: 'brittle' })

    expect((await repository.listWords({ search: 'sili' })).items).toHaveLength(1)
    expect((await repository.listWords({ search: 'RESILIENT' })).items).toHaveLength(1)
    expect((await repository.listWords({ search: 'absent' })).items).toHaveLength(0)
  })

  it('removes a word and its sentences in the same transaction', async () => {
    const repository = createRepository()
    const saved = await repository.saveWord({
      word: 'ephemeral',
      sourceUrl: 'https://example.com/one'
    })
    await repository.saveWord({ word: 'ephemeral', sourceUrl: 'https://example.com/two' })

    await repository.removeWord(saved.id)

    expect(await repository.countWords()).toBe(0)
    expect(await repository.getWord('ephemeral')).toBeNull()
  })

  it('removes a word by name and reports whether it existed', async () => {
    const repository = createRepository()
    await repository.saveWord({ word: 'transient' })

    expect(await repository.removeWordByName('Transient')).toBe(true)
    expect(await repository.removeWordByName('transient')).toBe(false)
    expect(await repository.getWord('transient')).toBeNull()
  })

  it('rejects input that is not a plain English word', async () => {
    const repository = createRepository()
    await expect(repository.saveWord({ word: 'two words' })).rejects.toThrow(TypeError)
    await expect(repository.saveWord({ word: '<script>' })).rejects.toThrow(TypeError)
  })
})
