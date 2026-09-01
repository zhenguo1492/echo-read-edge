import type { JSX } from 'preact'

import { DictionaryEntry } from '@/shared/components/DictionaryEntry'

interface WordDictionaryPanelProps {
  word: string
  onClose(): void
}

/**
 * The saved word's entry, shown beside the vocabulary list.
 *
 * It is the same component the in-page card anchors to a selection, so a word
 * opened from the list offers the same tabs, pronunciations, and spoken
 * examples, and reads them from the same local dictionary cache.
 */
export function WordDictionaryPanel({
  word,
  onClose
}: WordDictionaryPanelProps): JSX.Element {
  return (
    <section
      class="echo-read-edge-panel echo-read-edge-dictionary-card"
      role="dialog"
      aria-label={`Dictionary entry for ${word}`}
    >
      <DictionaryEntry word={word} onClose={onClose} />
    </section>
  )
}
