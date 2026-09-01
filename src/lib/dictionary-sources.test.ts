import { describe, expect, it } from 'vitest'

import {
  DICTIONARY_SOURCES,
  dictionarySourceLabel,
  isDictionarySourceId,
  resolveDictionarySourceId
} from './dictionary-sources'

describe('dictionary sources', () => {
  it('keeps the Chinese-first source for every Chinese translation target', () => {
    expect(resolveDictionarySourceId('zh-CN')).toBe('youdao')
    expect(resolveDictionarySourceId('zh-TW')).toBe('youdao')
  })

  it('switches to the English source when the reader translates elsewhere', () => {
    expect(resolveDictionarySourceId('en')).toBe('free-dictionary')
    expect(resolveDictionarySourceId('ja')).toBe('free-dictionary')
    expect(resolveDictionarySourceId('fr')).toBe('free-dictionary')
  })

  it('falls back to the default target when the stored value is unusable', () => {
    expect(resolveDictionarySourceId(undefined)).toBe('youdao')
    expect(resolveDictionarySourceId('klingon')).toBe('youdao')
  })

  it('exposes one label and definition language per source', () => {
    expect(DICTIONARY_SOURCES.map((source) => source.id))
      .toEqual(['youdao', 'free-dictionary'])
    expect(dictionarySourceLabel('free-dictionary')).toBe('Free Dictionary')
    expect(dictionarySourceLabel('unknown')).toBe('unknown')
    expect(isDictionarySourceId('youdao')).toBe(true)
    expect(isDictionarySourceId('webster')).toBe(false)
  })
})
