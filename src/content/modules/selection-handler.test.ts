import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  analyzeSentences,
  clearSelection,
  getAccurateSelection,
  isAbbreviation,
  isDottedAbbreviation,
  isValidSelection,
  splitByBlockBoundaries,
  splitIntoSentences
} from './selection-handler'
import { TextPositionIndex } from './text-position-index'

describe('selection sentence handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('preserves trimmed UTF-16 offsets for English sentences', () => {
    expect(splitIntoSentences('  Hello world.  Next sentence!  ')).toEqual([
      {
        start: 2,
        end: 14,
        text: 'Hello world.'
      },
      {
        start: 16,
        end: 30,
        text: 'Next sentence!'
      }
    ])
  })

  it('does not split titles, dotted abbreviations, or decimal numbers', () => {
    expect(splitIntoSentences('Dr. Smith arrived. He stayed.')).toEqual([
      { start: 0, end: 18, text: 'Dr. Smith arrived.' },
      { start: 19, end: 29, text: 'He stayed.' }
    ])

    expect(splitIntoSentences('The U.S. team won. It celebrated.')).toEqual([
      { start: 0, end: 18, text: 'The U.S. team won.' },
      { start: 19, end: 33, text: 'It celebrated.' }
    ])

    expect(splitIntoSentences('Version 1.5 is ready. Use it.')).toEqual([
      { start: 0, end: 21, text: 'Version 1.5 is ready.' },
      { start: 22, end: 29, text: 'Use it.' }
    ])
  })

  it('splits before sentences opening with a single capital letter', () => {
    expect(splitIntoSentences('It lives here. A second one follows.')).toEqual([
      { start: 0, end: 14, text: 'It lives here.' },
      { start: 15, end: 36, text: 'A second one follows.' }
    ])

    expect(splitIntoSentences("She left. I'm staying.")).toEqual([
      { start: 0, end: 9, text: 'She left.' },
      { start: 10, end: 22, text: "I'm staying." }
    ])

    expect(splitIntoSentences('Revenue rose in Q1. Q2 looked better.')).toEqual([
      { start: 0, end: 19, text: 'Revenue rose in Q1.' },
      { start: 20, end: 37, text: 'Q2 looked better.' }
    ])
  })

  it('splits Chinese terminators without requiring spaces or uppercase text', () => {
    expect(splitIntoSentences('你好世界。下一句！最后一段；结束')).toEqual([
      { start: 0, end: 5, text: '你好世界。' },
      { start: 5, end: 9, text: '下一句！' },
      { start: 9, end: 14, text: '最后一段；' },
      { start: 14, end: 16, text: '结束' }
    ])
  })

  it('applies absolute offsets and explicit HTML block boundaries', () => {
    expect(analyzeSentences('First. Second.', 40)).toEqual([
      { start: 40, end: 46, text: 'First.' },
      { start: 47, end: 54, text: 'Second.' }
    ])

    const text = 'First block without punctuation\nSecond block. Tail.'
    const boundary = text.indexOf('\n')
    expect(splitByBlockBoundaries(text, [boundary])).toEqual([
      {
        start: 0,
        end: boundary,
        text: 'First block without punctuation'
      },
      {
        start: boundary + 1,
        end: text.indexOf(' Tail.'),
        text: 'Second block.'
      },
      {
        start: text.indexOf('Tail.'),
        end: text.length,
        text: 'Tail.'
      }
    ])
  })

  it('retains the legacy abbreviation classifications', () => {
    expect(isAbbreviation('Dr.')).toBe(true)
    expect(isAbbreviation('FIG.')).toBe(true)
    expect(isAbbreviation('finished')).toBe(false)
    expect(isDottedAbbreviation('U.S.A.')).toBe(true)
    expect(isDottedAbbreviation('e.g.')).toBe(true)
    expect(isDottedAbbreviation('word.')).toBe(false)
  })

  it('captures a cloned Range and can validate and clear the live selection', () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Hello. Next.'
    document.body.append(paragraph)
    const textNode = paragraph.firstChild!
    const range = document.createRange()
    range.selectNodeContents(textNode)
    const rect = new DOMRect(10, 20, 30, 40)
    const removeAllRanges = vi.fn()
    vi.spyOn(range, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'Hello. Next.',
      getRangeAt: vi.fn(() => range),
      removeAllRanges
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(selection)

    expect(isValidSelection()).toBe(true)
    const captured = getAccurateSelection()
    expect(captured?.text).toBe('Hello. Next.')
    expect(captured?.range).not.toBe(range)
    expect(captured?.rects).toEqual([rect])
    expect(
      captured?.sentences.map(({ range: sentenceRange, ...sentence }) => ({
        ...sentence,
        rangeText: sentenceRange?.toString()
      }))
    ).toEqual([
      {
        start: 0,
        end: 6,
        text: 'Hello.',
        rangeText: 'Hello.'
      },
      {
        start: 7,
        end: 12,
        text: 'Next.',
        rangeText: 'Next.'
      }
    ])

    clearSelection()
    expect(removeAllRanges).toHaveBeenCalledOnce()
  })

  it('maps sentences across multiple list items to their own DOM ranges', () => {
    const list = document.createElement('ul')
    list.innerHTML =
      '<li>Each longURL must be hashed to one hashValue.</li>' +
      '<li>Each hashValue can be mapped back to the longURL.</li>'
    document.body.append(list)

    const firstText = list.children[0].firstChild!
    const secondText = list.children[1].firstChild!
    const range = document.createRange()
    range.setStart(firstText, 0)
    range.setEnd(secondText, secondText.textContent!.length)
    vi.spyOn(range, 'getClientRects').mockReturnValue([
      new DOMRect(40, 40, 500, 24),
      new DOMRect(40, 72, 520, 24)
    ] as unknown as DOMRectList)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => range.toString(),
      getRangeAt: () => range
    } as unknown as Selection)

    expect(range.commonAncestorContainer).toBe(list)
    const positionIndex = new TextPositionIndex()
    positionIndex.build(list)
    expect(positionIndex.getText()).toBe(
      'Each longURL must be hashed to one hashValue.\n' +
        'Each hashValue can be mapped back to the longURL.'
    )
    expect(positionIndex.getRangeOffsets(range)).toEqual([
      0,
      positionIndex.getText().length
    ])
    const captured = getAccurateSelection()
    expect(captured?.text).toBe(
      'Each longURL must be hashed to one hashValue.\n' +
        'Each hashValue can be mapped back to the longURL.'
    )
    expect(
      captured?.sentences.map((sentence) => ({
        text: sentence.text,
        rangeText: sentence.range?.toString()
      }))
    ).toEqual([
      {
        text: 'Each longURL must be hashed to one hashValue.',
        rangeText: 'Each longURL must be hashed to one hashValue.'
      },
      {
        text: 'Each hashValue can be mapped back to the longURL.',
        rangeText: 'Each hashValue can be mapped back to the longURL.'
      }
    ])
  })
})
