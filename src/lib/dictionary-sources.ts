import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  isTranslationTargetLanguage
} from './translation-languages'

export type DictionarySourceId = 'youdao' | 'free-dictionary' | 'wiktionary'

export interface DictionarySource {
  /** Matches the Dictionary Provider name so cache records stay addressable. */
  id: DictionarySourceId
  label: string
  /** Language the source writes its definitions and examples in. */
  definitionLanguage: string
}

/**
 * The dictionary sources a reader can be served from, in the order a lookup
 * tries them. A bilingual source is only useful to a reader who reads its
 * second language, so the fixed list pairs each source with the definition
 * language it actually publishes.
 */
export const DICTIONARY_SOURCES: readonly DictionarySource[] = [
  { id: 'youdao', label: 'Youdao Dictionary', definitionLanguage: 'zh' },
  { id: 'free-dictionary', label: 'Free Dictionary', definitionLanguage: 'en' },
  { id: 'wiktionary', label: 'Wiktionary', definitionLanguage: 'en' }
]

const DEFINITION_LANGUAGE_FALLBACK_SOURCE: DictionarySourceId = 'free-dictionary'

/**
 * Chooses the source for one lookup from the reader's translation target. A
 * Chinese target keeps the bilingual English-Chinese source it has always had;
 * any other target would only get Chinese it cannot read, so it falls back to
 * the monolingual English source instead.
 */
export function resolveDictionarySourceId(
  targetLanguage: unknown
): DictionarySourceId {
  return resolveDictionarySourceIds(targetLanguage)[0]
}

/**
 * Every source a lookup may try, in order. A source can be down for days —
 * the community API behind Free Dictionary regularly is — so a reader is
 * offered each source that publishes definitions in the language they read
 * rather than only the first one.
 */
export function resolveDictionarySourceIds(
  targetLanguage: unknown
): DictionarySourceId[] {
  const target = isTranslationTargetLanguage(targetLanguage)
    ? targetLanguage
    : DEFAULT_TRANSLATION_TARGET_LANGUAGE
  const baseLanguage = target.split('-')[0]
  const readable = DICTIONARY_SOURCES
    .filter((source) => source.definitionLanguage === baseLanguage)
    .map((source) => source.id)
  return readable.length > 0
    ? readable
    : DICTIONARY_SOURCES
      .filter((source) => source.definitionLanguage
        === sourceLanguage(DEFINITION_LANGUAGE_FALLBACK_SOURCE))
      .map((source) => source.id)
}

function sourceLanguage(id: DictionarySourceId): string {
  return DICTIONARY_SOURCES.find((source) => source.id === id)?.definitionLanguage ?? 'en'
}

export function isDictionarySourceId(value: unknown): value is DictionarySourceId {
  return DICTIONARY_SOURCES.some((source) => source.id === value)
}

export function dictionarySourceLabel(id: string): string {
  return DICTIONARY_SOURCES.find((source) => source.id === id)?.label ?? id
}
