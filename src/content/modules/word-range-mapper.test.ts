import { beforeEach, describe, expect, it } from 'vitest'

import { createWordRanges } from './word-range-mapper'

describe('word Range mapper', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('maps repeated words sequentially across nested text nodes', () => {
    const paragraph = document.createElement('p')
    paragraph.append('Read ')
    const emphasis = document.createElement('strong')
    emphasis.textContent = 'this'
    paragraph.append(emphasis, ' and read this again.')
    document.body.append(paragraph)

    const sentenceRange = document.createRange()
    sentenceRange.selectNodeContents(paragraph)
    const ranges = createWordRanges(sentenceRange, [
      boundary('Read'),
      boundary('this'),
      boundary('and'),
      boundary('read'),
      boundary('this'),
      boundary('again')
    ])

    expect(ranges.map((range) => range?.toString())).toEqual([
      'Read',
      'this',
      'and',
      'read',
      'this',
      'again'
    ])
    expect(ranges[1]?.startContainer).toBe(emphasis.firstChild)
  })

  it('matches smart quotes and spoken abbreviation expansions', () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'The “doctor” said etc.'
    document.body.append(paragraph)
    const sentenceRange = document.createRange()
    sentenceRange.selectNodeContents(paragraph)

    const ranges = createWordRanges(sentenceRange, [
      boundary('The'),
      boundary('"doctor"'),
      boundary('said'),
      boundary('etcetera')
    ])

    expect(ranges.map((range) => range?.toString())).toEqual([
      'The',
      'doctor',
      'said',
      'etc.'
    ])
  })

  it('excludes sibling text outside a partial sentence Range', () => {
    const paragraph = document.createElement('p')
    paragraph.append('Prefix ')
    const emphasis = document.createElement('em')
    emphasis.textContent = 'Read'
    const suffix = document.createTextNode(' this suffix')
    paragraph.append(emphasis, suffix)
    document.body.append(paragraph)

    const sentenceRange = document.createRange()
    sentenceRange.setStart(emphasis.firstChild!, 0)
    sentenceRange.setEnd(suffix, 5)
    const ranges = createWordRanges(sentenceRange, [boundary('Read'), boundary('this')])

    expect(sentenceRange.toString()).toBe('Read this')
    expect(ranges.map((range) => range?.toString())).toEqual(['Read', 'this'])
  })

  it('retains null slots when provider metadata cannot match page text', () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Known final'
    document.body.append(paragraph)
    const sentenceRange = document.createRange()
    sentenceRange.selectNodeContents(paragraph)

    const ranges = createWordRanges(sentenceRange, [
      boundary('Known'),
      boundary('missing'),
      boundary('final')
    ])

    expect(ranges[0]?.toString()).toBe('Known')
    expect(ranges[1]).toBeNull()
    expect(ranges[2]?.toString()).toBe('final')
  })
})

function boundary(word: string): { word: string; startTime: number; endTime: number } {
  return { word, startTime: 0, endTime: 1 }
}
