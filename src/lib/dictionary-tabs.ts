import type { DetailedDictionaryEntry } from '@/types'

/** The sections one dictionary entry can be split into, in display order. */
export type DictionaryTab =
  | 'meanings'
  | 'collins'
  | 'examples'
  | 'synonyms'
  | 'phrases'

export const DICTIONARY_TABS: readonly DictionaryTab[] = [
  'meanings',
  'collins',
  'examples',
  'synonyms',
  'phrases'
]

export const DICTIONARY_TAB_LABELS: Readonly<Record<DictionaryTab, string>> = {
  meanings: 'Meanings',
  collins: 'Collins',
  examples: 'Examples',
  synonyms: 'Synonyms',
  phrases: 'Phrases'
}

/**
 * Lists the tabs this entry has content for, so neither the in-page card nor the
 * popup panel offers a section that would open empty.
 */
export function getAvailableDictionaryTabs(
  entry: DetailedDictionaryEntry
): DictionaryTab[] {
  return DICTIONARY_TABS.filter((tab) => entry[tab].length > 0)
}

/**
 * Keeps the reader's chosen tab while the next word still has it, and otherwise
 * falls back to the first section that word does have.
 */
export function selectDictionaryTab(
  availableTabs: readonly DictionaryTab[],
  activeTab: DictionaryTab
): DictionaryTab {
  return availableTabs.includes(activeTab) ? activeTab : availableTabs[0] ?? 'meanings'
}
