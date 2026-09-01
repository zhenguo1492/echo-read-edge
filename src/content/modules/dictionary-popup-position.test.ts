import { describe, expect, it } from 'vitest'

import { calculateDictionaryPopupPosition } from './dictionary-popup-position'

describe('dictionary popup position', () => {
  it('centers the popup arrow over the word and shows below when it fits', () => {
    expect(calculateDictionaryPopupPosition(
      new DOMRect(400, 100, 80, 20),
      { width: 320, height: 240 },
      { width: 1000, height: 800 }
    )).toEqual({
      left: 280,
      top: 130,
      showAbove: false,
      arrowLeft: 160,
      maxHeight: 540
    })
  })

  it('uses the measured height to place a tall popup above the word', () => {
    expect(calculateDictionaryPopupPosition(
      new DOMRect(400, 650, 40, 20),
      { width: 427, height: 300 },
      { width: 1000, height: 800 }
    )).toEqual({
      left: 206.5,
      top: 340,
      showAbove: true,
      arrowLeft: 213.5,
      maxHeight: 540
    })
  })

  it('keeps the arrow aimed at the anchor when the panel is clamped at an edge', () => {
    expect(calculateDictionaryPopupPosition(
      new DOMRect(4, 300, 20, 20),
      { width: 427, height: 900 },
      { width: 440, height: 500 }
    )).toEqual({
      left: 10,
      top: 10,
      showAbove: true,
      arrowLeft: 4,
      maxHeight: 280
    })
  })

  it('places the panel outside the full sentence while anchoring its final word', () => {
    expect(calculateDictionaryPopupPosition(
      new DOMRect(400, 180, 50, 20),
      { width: 320, height: 100 },
      { width: 1000, height: 250 },
      new DOMRect(100, 100, 350, 100)
    )).toEqual({
      left: 265,
      top: 10,
      showAbove: true,
      arrowLeft: 160,
      maxHeight: 80
    })
  })
})
