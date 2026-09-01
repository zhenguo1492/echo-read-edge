/**
 * Chooses which sentences of the active reading session receive the persistent
 * selection highlight.
 *
 * Playback clears the native browser selection, so the selection layer is the
 * only remaining feedback about how much text the session still covers. The
 * three page-text states stay mutually exclusive here: the playing sentence
 * belongs to the sentence layer, the pointed sentence belongs to the hover
 * layer, and every other selected sentence belongs to this one. Stacking two
 * translucent layers over the same text would otherwise blend into a fourth
 * color that means nothing to the reader.
 */

export interface SelectionHighlightState {
  /** Sentence owning the playing highlight, or null while playback is idle. */
  activeIndex: number | null
  /** Sentence owning the hover highlight, or null while the pointer is away. */
  hoveredIndex: number | null
}

export function selectSelectionHighlightRanges(
  ranges: readonly (Range | null | undefined)[],
  { activeIndex, hoveredIndex }: SelectionHighlightState
): Range[] {
  return ranges.filter((range, index): range is Range => {
    if (index === activeIndex || index === hoveredIndex) return false
    return Boolean(
      range?.startContainer.isConnected && range.endContainer.isConnected
    )
  })
}
