import { describe, expect, it } from 'vitest'

import type { DetailedDictionaryEntry } from '@/types'
import {
  getAvailableDictionaryTabs,
  selectDictionaryTab
} from './dictionary-tabs'

function createEntry(
  overrides: Partial<DetailedDictionaryEntry> = {}
): DetailedDictionaryEntry {
  return {
    word: 'read',
    examTypes: [],
    meanings: [],
    examples: [],
    phrases: [],
    synonyms: [],
    discriminate: [],
    collins: [],
    ...overrides
  }
}

describe('getAvailableDictionaryTabs', () => {
  it('lists only the sections the entry has content for, in display order', () => {
    const entry = createEntry({
      phrases: [{ phrase: 'read up', meaning: 'to study' }],
      meanings: [{ partOfSpeech: 'verb', definition: 'To interpret written text.' }]
    })

    expect(getAvailableDictionaryTabs(entry)).toEqual(['meanings', 'phrases'])
  })

  it('returns no tab for an entry without any section', () => {
    expect(getAvailableDictionaryTabs(createEntry())).toEqual([])
  })
})

describe('selectDictionaryTab', () => {
  it('keeps the active tab while the entry still has it', () => {
    expect(selectDictionaryTab(['meanings', 'examples'], 'examples')).toBe('examples')
  })

  it('falls back to the first available tab', () => {
    expect(selectDictionaryTab(['collins', 'examples'], 'phrases')).toBe('collins')
  })

  it('falls back to meanings when the entry has no section at all', () => {
    expect(selectDictionaryTab([], 'phrases')).toBe('meanings')
  })
})
