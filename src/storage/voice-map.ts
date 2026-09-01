import {
  DEFAULT_EDGE_VOICE_BY_LANGUAGE,
  isEdgeVoiceIdForLanguage
} from '@/lib/edge-voices'
import {
  DEFAULT_KOKORO_VOICE_BY_LANGUAGE,
  isKokoroVoiceIdForLanguage,
  kokoroVoiceLanguage
} from '@/lib/kokoro-voices'
import type { TtsEngineId } from '@/lib/tts-engines'

/**
 * Reading a stored voice map is the one place where arbitrary older values can
 * enter the reader, so each engine keeps its own validator and neither ever
 * accepts an identifier belonging to the other.
 */
export interface VoiceMapRules {
  defaults: Readonly<Record<string, string>>
  isVoiceForLanguage(languageCode: string, voiceId: string): boolean
  languageOf(voiceId: string): string | null
}

export const VOICE_MAP_RULES: Readonly<Record<TtsEngineId, VoiceMapRules>> = {
  edge: {
    defaults: DEFAULT_EDGE_VOICE_BY_LANGUAGE,
    isVoiceForLanguage: isEdgeVoiceIdForLanguage,
    languageOf: edgeVoiceLanguage
  },
  kokoro: {
    defaults: DEFAULT_KOKORO_VOICE_BY_LANGUAGE,
    isVoiceForLanguage: isKokoroVoiceIdForLanguage,
    languageOf: kokoroVoiceLanguage
  }
}

/**
 * Merges stored selections over the engine defaults. English is resolved first
 * because the legacy dialect setting can still decide which stored key wins.
 */
export function sanitizeVoiceMap(
  rules: VoiceMapRules,
  value: unknown,
  defaults: Record<string, string>,
  legacyEnglishDialect?: unknown
): Record<string, string> {
  const result = { ...defaults }
  if (typeof value !== 'object' || value === null) return result

  const storedMap = value as Record<string, unknown>
  const englishKeys = legacyEnglishDialect === 'en-GB'
    ? ['en', 'en-GB', 'en-US']
    : ['en', 'en-US', 'en-GB']
  for (const key of englishKeys) {
    const voice = storedMap[key]
    if (typeof voice === 'string' && rules.isVoiceForLanguage('en', voice)) {
      result.en = voice
      break
    }
  }

  for (const [storedLanguage, storedVoice] of Object.entries(storedMap)) {
    if (typeof storedVoice !== 'string') continue
    const languageCode = rules.languageOf(storedVoice)
      ?? storedLanguage.toLowerCase().split('-')[0]
    if (languageCode === 'en') continue
    if (rules.isVoiceForLanguage(languageCode, storedVoice)) {
      result[languageCode] = storedVoice
    }
  }
  return result
}

/**
 * Lets a language the curated Edge list does not cover fall back to the first
 * voice the live catalog reported for it.
 */
export function readEdgeCatalogDefaults(value: unknown): Record<string, string> {
  const result = { ...DEFAULT_EDGE_VOICE_BY_LANGUAGE }
  if (typeof value !== 'object' || value === null) return result

  const voices = (value as Record<string, unknown>).voices
  if (!Array.isArray(voices)) return result

  for (const voice of voices) {
    if (typeof voice !== 'object' || voice === null) continue
    const id = (voice as Record<string, unknown>).id
    if (typeof id !== 'string') continue
    const languageCode = edgeVoiceLanguage(id)
    if (languageCode && !result[languageCode] && isEdgeVoiceIdForLanguage(languageCode, id)) {
      result[languageCode] = id
    }
  }
  return result
}

function edgeVoiceLanguage(voiceId: string): string | null {
  return voiceId.match(/^([a-z]{2,3})-[A-Z]{2}-/u)?.[1] ?? null
}
