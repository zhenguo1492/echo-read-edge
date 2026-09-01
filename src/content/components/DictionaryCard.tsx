import type { JSX } from 'preact'

import { useSavedWord } from '@/content/modules/saved-word'
import type { SavedWordState } from '@/content/modules/saved-word'
import { DictionaryEntry } from '@/shared/components/DictionaryEntry'
import { AnchoredPanel } from './AnchoredPanel'

interface DictionaryCardProps {
  word: string
  range: Range
  onClose(): void
}

/** The shared dictionary entry, anchored to the word the reader opened. */
export function DictionaryCard({ word, range, onClose }: DictionaryCardProps): JSX.Element {
  // The reader saves the form currently on screen, not the lemma behind it.
  const savedWord = useSavedWord(word, range)

  return (
    <AnchoredPanel
      anchorRange={range}
      ariaLabel={`Dictionary entry for ${word}`}
      class="echo-read-edge-dictionary-card"
      onClose={onClose}
    >
      <DictionaryEntry
        word={word}
        notice={savedWord.error}
        actions={<SaveWordButton savedWord={savedWord} />}
        onClose={onClose}
      />
    </AnchoredPanel>
  )
}

/** One control for both directions so the reader always sees the saved state. */
function SaveWordButton({ savedWord }: { savedWord: SavedWordState }): JSX.Element {
  const label = savedWord.isSaved ? 'Remove from vocabulary list' : 'Save to vocabulary list'
  return (
    <button
      type="button"
      class={savedWord.isSaved ? 'echo-read-edge-save-word is-saved' : 'echo-read-edge-save-word'}
      aria-label={label}
      aria-pressed={savedWord.isSaved}
      title={label}
      disabled={savedWord.isPending}
      onClick={() => void savedWord.toggleSaved()}
    >
      {savedWord.isSaved ? '★' : '☆'}
    </button>
  )
}
