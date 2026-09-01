import { beforeEach, describe, expect, it } from 'vitest'

import { selectSelectionHighlightRanges } from './selection-highlight'

describe('selection highlight ranges', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('keeps every selected sentence while nothing plays and nothing is hovered', () => {
    const ranges = createSentenceRanges(3)

    const painted = selectSelectionHighlightRanges(ranges, {
      activeIndex: null,
      hoveredIndex: null
    })

    expect(painted).toEqual(ranges)
  })

  it('leaves the playing sentence to the sentence layer', () => {
    const ranges = createSentenceRanges(3)

    const painted = selectSelectionHighlightRanges(ranges, {
      activeIndex: 1,
      hoveredIndex: null
    })

    expect(painted).toEqual([ranges[0], ranges[2]])
  })

  it('leaves the pointed sentence to the hover layer', () => {
    const ranges = createSentenceRanges(3)

    const painted = selectSelectionHighlightRanges(ranges, {
      activeIndex: 0,
      hoveredIndex: 2
    })

    expect(painted).toEqual([ranges[1]])
  })

  it('skips missing and detached sentence ranges', () => {
    const ranges = createSentenceRanges(2)
    const detached = document.createRange()
    detached.selectNodeContents(document.createElement('p'))

    const painted = selectSelectionHighlightRanges(
      [ranges[0], null, detached, undefined, ranges[1]],
      { activeIndex: null, hoveredIndex: null }
    )

    expect(painted).toEqual(ranges)
  })

  it('paints nothing when the session holds no sentences', () => {
    expect(
      selectSelectionHighlightRanges([], { activeIndex: 0, hoveredIndex: null })
    ).toEqual([])
  })
})

function createSentenceRanges(count: number): Range[] {
  return Array.from({ length: count }, (_unused, index) => {
    const paragraph = document.createElement('p')
    paragraph.textContent = `Sentence ${index}.`
    document.body.append(paragraph)
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    return range
  })
}
