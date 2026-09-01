import { describe, expect, it } from 'vitest'

import { mapExampleBoundariesToWords, splitExampleText } from './example-word-mapper'

describe('example word mapper', () => {
  it('preserves visible punctuation while assigning stable word indexes', () => {
    expect(splitExampleText("Don't read, read twice.").parts).toEqual([
      { text: "Don't", wordIndex: 0 },
      { text: ' ', wordIndex: null },
      { text: 'read', wordIndex: 1 },
      { text: ', ', wordIndex: null },
      { text: 'read', wordIndex: 2 },
      { text: ' ', wordIndex: null },
      { text: 'twice', wordIndex: 3 },
      { text: '.', wordIndex: null }
    ])
  })

  it('maps repeated Edge boundaries to successive rendered words', () => {
    expect([...mapExampleBoundariesToWords('Read it, then read it.', [
      { word: 'Read', startTime: 0, endTime: 0.2 },
      { word: 'it', startTime: 0.2, endTime: 0.3 },
      { word: 'then', startTime: 0.3, endTime: 0.5 },
      { word: 'read', startTime: 0.5, endTime: 0.7 },
      { word: 'it', startTime: 0.7, endTime: 0.8 }
    ])]).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]])
  })
})
