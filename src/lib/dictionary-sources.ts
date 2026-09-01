import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  isTranslationTargetLanguage
} from './translation-languages'

export type DictionarySourceId = 'youdao' | 'free-dictionary'

export interface DictionarySource {
  /** Matches the Dictionary Provider name so cache records stay addressable. */
  id: DictionarySourceId
  label: string
  /** Language the source writes its definitions and examples in. */
  definitionLanguage: string
}

/**
 * The dictionary sources a reader can be served from. A bilingual source is
 * only useful to a reader who reads its second language, so the fixed list
 * pairs each source with the definition language it actually publishes.
 */
export const DICTIONARY_SOURCES: readonly DictionarySource[] = [
  { id: 'youdao', label: 'Youdao Dictionary', definitionLanguage: 'zh' },
  { id: 'free-dictionary', label: 'Free Dictionary', definitionLanguage: 'en' }
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
  const target = isTranslationTargetLanguage(targetLanguage)
    ? targetLanguage
    : DEFAULT_TRANSLATION_TARGET_LANGUAGE
  const baseLanguage = target.split('-')[0]
  return DICTIONARY_SOURCES.find((source) => source.definitionLanguage === baseLanguage)?.id
    ?? DEFINITION_LANGUAGE_FALLBACK_SOURCE
}

export function isDictionarySourceId(value: unknown): value is DictionarySourceId {
  return DICTIONARY_SOURCES.some((source) => source.id === value)
}

export function dictionarySourceLabel(id: string): string {
  return DICTIONARY_SOURCES.find((source) => source.id === id)?.label ?? id
}
