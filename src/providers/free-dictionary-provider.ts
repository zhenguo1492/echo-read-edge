import type {
  DetailedDictionaryEntry,
  DetailedDictionaryExample,
  DetailedDictionarySynonym
} from '@/types'
import {
  DictionaryProviderError,
  normalizeDictionaryWord,
  type DictionaryProvider
} from './dictionary-provider'

const FREE_DICTIONARY_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en'
const EXAMPLE_SOURCE = 'free-dictionary'
const MAX_DEFINITIONS_PER_PART_OF_SPEECH = 3
const MAX_SYNONYMS_PER_GROUP = 5
const MAX_EXAMPLES = 30
const UK_AUDIO = /(?:-uk\.mp3|_gb_\d*\.mp3)$/i
const US_AUDIO = /(?:-us\.mp3|_us_\d*\.mp3)$/i

/**
 * Monolingual English source for readers whose translation target is not
 * Chinese. It ports the legacy backend's Free Dictionary fallback, which needs
 * no key and answers with definitions rather than a second-language gloss.
 */
export class FreeDictionaryProvider implements DictionaryProvider {
  readonly name = 'free-dictionary'
  readonly definitionLanguage = 'en'

  async lookup(word: string, signal: AbortSignal): Promise<DetailedDictionaryEntry> {
    const normalizedWord = normalizeDictionaryWord(word)

    let response: Response
    try {
      response = await fetch(
        `${FREE_DICTIONARY_URL}/${encodeURIComponent(normalizedWord)}`,
        { signal }
      )
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

    const entry = normalizeFreeDictionaryEntry(await response.json(), normalizedWord)
    if (!entry) {
      throw new DictionaryProviderError('not-found', `No entry was found for “${word}”.`)
    }
    return entry
  }
}

/**
 * Merges the homograph entries the endpoint returns into the one internal
 * shape the UI knows, treating every remote field as untrusted. Collins,
 * phrases, and discrimination stay empty because this source publishes none.
 */
export function normalizeFreeDictionaryEntry(
  payload: unknown,
  word: string
): DetailedDictionaryEntry | null {
  const entries = asArray(payload).flatMap((value) => {
    const record = asRecord(value)
    return record ? [record] : []
  })
  if (entries.length === 0) return null

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
  const synonymsByPartOfSpeech = new Map<string, string[]>()

  for (const entry of entries) {
    parsePhonetics(entry, result)
    for (const meaningValue of asArray(entry.meanings)) {
      const meaning = asRecord(meaningValue)
      if (!meaning) continue
      const partOfSpeech = asString(meaning.partOfSpeech) ?? ''
      const groupSynonyms = synonymsByPartOfSpeech.get(partOfSpeech) ?? []

      for (const definitionValue of asArray(meaning.definitions)
        .slice(0, MAX_DEFINITIONS_PER_PART_OF_SPEECH)) {
        const entryDefinition = asRecord(definitionValue)
        const definition = asString(entryDefinition?.definition)
        if (!definition) continue
        result.meanings.push({ partOfSpeech, definition })
        const example = asString(entryDefinition?.example)
        if (example) result.examples.push({ en: example, zh: '', source: EXAMPLE_SOURCE })
        groupSynonyms.push(...readWords(entryDefinition?.synonyms))
      }

      groupSynonyms.push(...readWords(meaning.synonyms))
      if (groupSynonyms.length > 0) synonymsByPartOfSpeech.set(partOfSpeech, groupSynonyms)
    }
  }

  result.examples = deduplicateExamples(result.examples).slice(0, MAX_EXAMPLES)
  result.synonyms = buildSynonymGroups(synonymsByPartOfSpeech)
  return result.meanings.length > 0 ? result : null
}

function parsePhonetics(
  entry: Record<string, unknown>,
  result: DetailedDictionaryEntry
): void {
  for (const value of asArray(entry.phonetics)) {
    const phonetic = asRecord(value)
    const text = asString(phonetic?.text)
    const audio = audioUrl(asString(phonetic?.audio))
    if (!audio) continue
    if (UK_AUDIO.test(audio)) {
      result.ukSpeech ??= audio
      if (text) result.ukPhonetic ??= text
    } else if (US_AUDIO.test(audio)) {
      result.usSpeech ??= audio
      if (text) result.usPhonetic ??= text
    }
  }

  const generic = asString(entry.phonetic)
    ?? asArray(entry.phonetics).flatMap((value) => {
      const text = asString(asRecord(value)?.text)
      return text ? [text] : []
    })[0]
  result.phonetic ??= generic ?? result.ukPhonetic ?? result.usPhonetic
}

/** The endpoint mixes absolute and protocol-relative audio hosts. */
function audioUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function buildSynonymGroups(
  synonymsByPartOfSpeech: Map<string, string[]>
): DetailedDictionarySynonym[] {
  return [...synonymsByPartOfSpeech].flatMap(([pos, words]) => {
    const unique = [...new Set(words)].slice(0, MAX_SYNONYMS_PER_GROUP)
    return unique.length > 0 ? [{ pos, meaning: '', words: unique }] : []
  })
}

function readWords(value: unknown): string[] {
  return asArray(value).flatMap((item) => {
    const word = asString(item)
    return word ? [word] : []
  })
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
