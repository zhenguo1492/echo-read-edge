import { describe, expect, it } from 'vitest'

import { englishLemmaCandidates } from './english-lemmas'

describe('englishLemmaCandidates', () => {
  it('strips a regular plural before any other guess', () => {
    expect(englishLemmaCandidates('billions')[0]).toBe('billion')
  })

  it('restores the y a plural consonant swap replaced', () => {
    expect(englishLemmaCandidates('studies')).toContain('study')
  })

  it('drops the sibilant es a plural adds', () => {
    expect(englishLemmaCandidates('boxes')).toContain('box')
  })

  it('offers the undoubled stem of a progressive form', () => {
    expect(englishLemmaCandidates('running')).toContain('run')
  })

  it('keeps the silent e a past tense swallowed', () => {
    expect(englishLemmaCandidates('used')).toContain('use')
  })

  it('restores the y an -ied past tense replaced', () => {
    expect(englishLemmaCandidates('studied')).toContain('study')
  })

  it('reads an irregular plural from the exception table first', () => {
    expect(englishLemmaCandidates('children')[0]).toBe('child')
  })

  it('resolves a comparative built on a y adjective', () => {
    expect(englishLemmaCandidates('happier')).toContain('happy')
  })

  it('drops the adverb suffix', () => {
    expect(englishLemmaCandidates('quickly')).toContain('quick')
  })

  it('drops a possessive apostrophe', () => {
    expect(englishLemmaCandidates("reader's")).toContain('reader')
  })

  it('leaves a word that is already a headword without candidates', () => {
    expect(englishLemmaCandidates('billion')).toEqual([])
    expect(englishLemmaCandidates('cat')).toEqual([])
  })

  it('never suggests the word itself, a blank, or a one-letter stem', () => {
    for (const word of ['as', 'is', 'bus', 'glass', 'ing', 'ed', 'a', '']) {
      const candidates = englishLemmaCandidates(word)
      expect(candidates).not.toContain(word)
      expect(candidates.every((candidate) => candidate.length >= 2)).toBe(true)
    }
  })

  it('stays short enough to keep a fallback walk cheap', () => {
    expect(englishLemmaCandidates('running').length).toBeLessThanOrEqual(5)
  })
})
