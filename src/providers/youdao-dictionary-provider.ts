import type {
  DetailedDictionaryCollinsEntry,
  DetailedDictionaryEntry,
  DetailedDictionaryExample
} from '@/types'
import {
  DictionaryProviderError,
  normalizeDictionaryWord,
  type DictionaryProvider
} from './dictionary-provider'

const YOUDAO_DICTIONARY_URL = 'https://dict.youdao.com/jsonapi'

/** Direct frontend replacement for the legacy backend Youdao adapter. */
export class YoudaoDictionaryProvider implements DictionaryProvider {
  readonly name = 'youdao'
  readonly definitionLanguage = 'zh'

  async lookup(word: string, signal: AbortSignal): Promise<DetailedDictionaryEntry> {
    const normalizedWord = normalizeDictionaryWord(word)

    let response: Response
    try {
      const url = new URL(YOUDAO_DICTIONARY_URL)
      url.searchParams.set('q', normalizedWord)
      url.searchParams.set('doctype', 'json')
      response = await fetch(url, { signal })
    } catch (error) {
      throw new DictionaryProviderError(
        'unavailable',
        'The dictionary is currently unavailable.',
        { cause: error }
      )
    }

    if (!response.ok) {
      throw new DictionaryProviderError(
        'unavailable',
        `The dictionary failed with HTTP ${response.status}.`
      )
    }

    const entry = normalizeYoudaoDictionaryEntry(await response.json(), normalizedWord)
    if (!entry) {
      throw new DictionaryProviderError(
        'not-found',
        `No entry was found for “${word}”.`
      )
    }
    return entry
  }
}

/** Ports the legacy backend adapter while treating every remote field as untrusted. */
export function normalizeYoudaoDictionaryEntry(
  payload: unknown,
  word: string
): DetailedDictionaryEntry | null {
  const data = asRecord(payload)
  if (!data) return null

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

  const ec = asRecord(data.ec)
  const wordInfo = asRecord(asArray(ec?.word)[0])
  if (wordInfo) {
    const prototype = asString(wordInfo.prototype)
    if (prototype && prototype.toLowerCase() !== word) result.lemma = prototype.toLowerCase()
    const ukPhone = asString(wordInfo.ukphone)
    const usPhone = asString(wordInfo.usphone)
    if (ukPhone) result.ukPhonetic = `/${ukPhone}/`
    if (usPhone) result.usPhonetic = `/${usPhone}/`
    result.phonetic = result.ukPhonetic ?? result.usPhonetic
    const ukSpeech = asString(wordInfo.ukspeech)
    const usSpeech = asString(wordInfo.usspeech)
    if (ukSpeech) result.ukSpeech = youdaoAudioUrl(ukSpeech)
    if (usSpeech) result.usSpeech = youdaoAudioUrl(usSpeech)

    const forms = asArray(wordInfo.wfs).flatMap((item) => {
      const wf = asRecord(asRecord(item)?.wf)
      const name = asString(wf?.name)
      const value = asString(wf?.value)
      return name && value ? [`${name}: ${value}`] : []
    })
    if (forms.length > 0) result.forms = forms.join('; ')

    result.meanings = asArray(wordInfo.trs).flatMap((item) => {
      const tr = asRecord(item)
      const text = nestedString(tr, ['tr', 0, 'l', 'i', 0])
      if (!text) return []
      const match = text.match(/^([a-z]+\.)\s*(.+)$/i)
      return [{
        partOfSpeech: match?.[1] ?? '',
        definition: match?.[2] ?? text
      }]
    })
    result.examTypes = asArray(ec?.exam_type).flatMap((value) => {
      const text = asString(value)
      return text ? [text] : []
    })
  }

  parseCollins(data, result)
  parseExamples(data, result)
  parseSynonyms(data, result)
  parseDiscrimination(data, result)
  parsePhrases(data, result)

  result.examples = deduplicateExamples(result.examples).slice(0, 30)
  if (result.collins.length === 0) {
    result.collins = result.meanings.map((meaning) => ({
      pos: meaning.partOfSpeech,
      definition: meaning.definition,
      examples: []
    }))
  }

  return result.meanings.length > 0 || result.collins.length > 0 || result.examples.length > 0
    ? result
    : null
}

function parseCollins(data: Record<string, unknown>, result: DetailedDictionaryEntry): void {
  const entries = asArray(asRecord(data.collins)?.collins_entries)
  const collins = asRecord(entries[0])
  if (!collins) return
  const star = Number(asString(collins.star))
  if (Number.isFinite(star) && star > 0) result.collinsStar = star
  const level = nestedString(collins, ['basic_entries', 'basic_entry', 0, 'cet'])
  if (level && level !== '0') result.level = level

  for (const entryValue of asArray(asRecord(collins.entries)?.entry)) {
    for (const translationValue of asArray(asRecord(entryValue)?.tran_entry)) {
      const translation = asRecord(translationValue)
      const definition = stripMarkup(asString(translation?.tran) ?? '')
      if (!definition) continue
      const parsed: DetailedDictionaryCollinsEntry = {
        pos: nestedString(translation, ['pos_entry', 'pos']) ?? '',
        definition,
        examples: []
      }
      const posTips = nestedString(translation, ['pos_entry', 'pos_tips'])
      if (posTips) parsed.posTips = posTips
      for (const sentenceValue of asArray(asRecord(translation?.exam_sents)?.sent)) {
        const sentence = asRecord(sentenceValue)
        const en = asString(sentence?.eng_sent)
        if (!en) continue
        const example = { en, zh: asString(sentence?.chn_sent) ?? '' }
        parsed.examples.push(example)
        result.examples.push({ ...example, source: 'collins' })
      }
      result.collins.push(parsed)
    }
  }
}

function parseExamples(data: Record<string, unknown>, result: DetailedDictionaryEntry): void {
  const bilingual = asRecord(data.blng_sents_part)
  for (const value of asArray(bilingual?.['sentence-pair'])) {
    const item = asRecord(value)
    const en = stripMarkup(asString(item?.sentence) ?? '')
    if (en) result.examples.push({
      en,
      zh: asString(item?.['sentence-translation']) ?? '',
      source: 'bilingual'
    })
  }

  const authoritative = asRecord(data.auth_sents_part)
  for (const value of asArray(authoritative?.sent)) {
    const item = asRecord(value)
    const en = stripMarkup(asString(item?.foreign) ?? '')
    if (en) result.examples.push({
      en,
      zh: stripMarkup(asString(item?.source) ?? ''),
      source: 'authoritative'
    })
  }
}

function parseSynonyms(data: Record<string, unknown>, result: DetailedDictionaryEntry): void {
  for (const value of asArray(asRecord(data.syno)?.synos)) {
    const synonym = asRecord(asRecord(value)?.syno)
    const words = asArray(synonym?.ws).flatMap((item) => {
      const value = asString(asRecord(item)?.w)
      return value ? [value] : []
    }).slice(0, 5)
    if (words.length > 0) result.synonyms.push({
      pos: asString(synonym?.pos) ?? '',
      meaning: asString(synonym?.tran) ?? '',
      words
    })
  }
}

function parseDiscrimination(
  data: Record<string, unknown>,
  result: DetailedDictionaryEntry
): void {
  for (const value of asArray(asRecord(data.discriminate)?.data)) {
    for (const usageValue of asArray(asRecord(value)?.usages)) {
      const usage = asRecord(usageValue)
      const comparedWord = asString(usage?.headword)
      const description = asString(usage?.usage)
      if (comparedWord && description) {
        result.discriminate.push({ word: comparedWord, usage: description })
      }
    }
  }
}

function parsePhrases(data: Record<string, unknown>, result: DetailedDictionaryEntry): void {
  for (const value of asArray(asRecord(data.phrs)?.phrs).slice(0, 15)) {
    const phrase = asRecord(asRecord(value)?.phr)
    const text = nestedString(phrase, ['headword', 'l', 'i'])
    const meaning = nestedString(phrase, ['trs', 0, 'tr', 'l', 'i'])
    if (text && meaning) result.phrases.push({ phrase: text, meaning })
  }
}

function nestedString(
  value: unknown,
  path: Array<string | number>
): string | undefined {
  let current = value
  for (const segment of path) {
    current = typeof segment === 'number'
      ? asArray(current)[segment]
      : asRecord(current)?.[segment]
  }
  if (Array.isArray(current)) current = current[0]
  return asString(current)
}

function youdaoAudioUrl(audio: string): string {
  const url = new URL('https://dict.youdao.com/dictvoice')
  url.searchParams.set('audio', audio)
  return url.toString()
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

function stripMarkup(value: string): string {
  return value.replace(/<\/?(?:b|i)>/gi, '').trim()
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
