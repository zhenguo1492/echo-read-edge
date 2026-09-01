import type {
  DetailedDictionaryEntry,
  DetailedDictionaryExample
} from '@/types'
import {
  DictionaryProviderError,
  normalizeDictionaryWord,
  type DictionaryProvider
} from './dictionary-provider'

const WIKTIONARY_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition'
const EXAMPLE_SOURCE = 'wiktionary'
const MAX_DEFINITIONS_PER_PART_OF_SPEECH = 3
const MAX_EXAMPLES = 30
const HTML_TAG = /<[^>]*>/g
/** Parsoid inlines the deduplicated stylesheet of a template into the text. */
const EMBEDDED_STYLE = /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi
/**
 * Wiktionary records an inflected spelling as a pointer to its lemma rather
 * than as a sense, which is the only lemma this source publishes.
 */
const FORM_OF_DEFINITION =
  /^(?:plural|singular|comparative|superlative|alternative (?:form|spelling)|simple past|past participle|present participle|gerund|third-person singular|inflection|misspelling)\b/i
const FORM_OF_LEMMA = /\bof ([a-z][a-z'-]*)/gi
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' '
}

/**
 * Second monolingual English source, used when the first one is unreachable.
 *
 * Wiktionary's REST endpoint needs no key and is served from the same
 * infrastructure as Wikipedia, which stays up when the small community API
 * behind {@link FreeDictionaryProvider} does not. It publishes no phonetics, so
 * the entry it returns carries definitions and examples only.
 */
export class WiktionaryDictionaryProvider implements DictionaryProvider {
  readonly name = 'wiktionary'
  readonly definitionLanguage = 'en'

  async lookup(word: string, signal: AbortSignal): Promise<DetailedDictionaryEntry> {
    const normalizedWord = normalizeDictionaryWord(word)

    let response: Response
    try {
      response = await fetch(`${WIKTIONARY_URL}/${encodeURIComponent(normalizedWord)}`, { signal })
    } catch (error) {
      throw new DictionaryProviderError(
        'unavailable',
        'The dictionary is currently unavailable.',
        { cause: error }
      )
    }

    if (response.status === 404) {
      throw new DictionaryProviderError('not-found', `No entry was found for “${word}”.`)
    }
    if (!response.ok) {
      throw new DictionaryProviderError(
        'unavailable',
        `The dictionary failed with HTTP ${response.status}.`
      )
    }

    const entry = normalizeWiktionaryEntry(await response.json(), normalizedWord)
    if (!entry) {
      throw new DictionaryProviderError('not-found', `No entry was found for “${word}”.`)
    }
    return entry
  }
}

/**
 * Keeps the English sections of a page that may define the same spelling in
 * dozens of languages, and reduces the wiki markup each definition carries to
 * the plain text the card renders.
 */
export function normalizeWiktionaryEntry(
  payload: unknown,
  word: string
): DetailedDictionaryEntry | null {
  const sections = asArray(asRecord(payload)?.en).flatMap((value) => {
    const record = asRecord(value)
    return record ? [record] : []
  })
  if (sections.length === 0) return null

  const result: DetailedDictionaryEntry = {
    word,
    examTypes: [],
    meanings: [],
    examples: [],
    phrases: [],
    synonyms: [],
    discriminate: [],
    collins: []
  }

  let hasOwnSense = false
  let formOfLemma: string | undefined

  for (const section of sections) {
    const partOfSpeech = (asString(section.partOfSpeech) ?? '').toLowerCase()
    for (const value of asArray(section.definitions)) {
      if (result.meanings.filter((meaning) => meaning.partOfSpeech === partOfSpeech).length
        >= MAX_DEFINITIONS_PER_PART_OF_SPEECH) break
      const record = asRecord(value)
      const definition = plainText(asString(record?.definition))
      if (!definition) continue
      result.meanings.push({ partOfSpeech, definition })
      const lemma = formOfTarget(definition)
      if (lemma && lemma !== word) formOfLemma ??= lemma
      else hasOwnSense = true
      for (const example of asArray(record?.examples)) {
        const text = plainText(asString(example))
        if (text) result.examples.push({ en: text, zh: '', source: EXAMPLE_SOURCE })
      }
    }
  }

  result.examples = deduplicateExamples(result.examples).slice(0, MAX_EXAMPLES)
  if (!hasOwnSense && formOfLemma) result.lemma = formOfLemma
  return result.meanings.length > 0 ? result : null
}

/** The lemma an inflection-only definition points at, if that is all it is. */
function formOfTarget(definition: string): string | undefined {
  if (!FORM_OF_DEFINITION.test(definition)) return undefined
  const matches = [...definition.matchAll(FORM_OF_LEMMA)]
  return matches.at(-1)?.[1]?.toLowerCase()
}

/** Wiktionary answers in Parsoid HTML, which the card renders as text only. */
function plainText(value: string | undefined): string {
  if (!value) return ''
  const stripped = value.replace(EMBEDDED_STYLE, '').replace(HTML_TAG, '')
  return Object.entries(HTML_ENTITIES)
    .reduce((text, [entity, character]) => text.replaceAll(entity, character), stripped)
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim()
}

function deduplicateExamples(values: DetailedDictionaryExample[]): DetailedDictionaryExample[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.en.toLowerCase().trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
