import type { VoiceRecord } from '@/shared/messages'

/**
 * Kokoro voice identifiers encode language and gender in their first two
 * characters, for example `af_heart` is an American English female voice. The
 * suffix is a free-form slug, so it is matched narrowly rather than parsed.
 */
const KOKORO_VOICE_ID_PATTERN = /^([abefhijpz])([fm])_([a-z0-9]+)$/u

/** Kokoro ships one canonical locale per language prefix. */
const LOCALE_BY_PREFIX: Readonly<Record<string, string>> = {
  a: 'en-US',
  b: 'en-GB',
  e: 'es-ES',
  f: 'fr-FR',
  h: 'hi-IN',
  i: 'it-IT',
  j: 'ja-JP',
  p: 'pt-BR',
  z: 'zh-CN'
}

/**
 * The voices published with Kokoro v1.0. The running server is the source of
 * truth; this list only keeps the popup and the language defaults usable while
 * the server is unreachable.
 */
export const KOKORO_VOICE_IDS: readonly string[] = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael',
  'am_onyx', 'am_puck', 'am_santa',
  'bf_emma', 'bf_alice', 'bf_isabella', 'bf_lily',
  'bm_george', 'bm_daniel', 'bm_fable', 'bm_lewis',
  'ef_dora', 'em_alex', 'em_santa',
  'ff_siwis',
  'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
  'if_sara', 'im_nicola',
  'pf_dora', 'pm_alex', 'pm_santa',
  'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo',
  'zf_xiaoxiao', 'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoyi',
  'zm_yunxi', 'zm_yunjian', 'zm_yunxia', 'zm_yunyang'
]

export function isKokoroVoiceId(value: unknown): value is string {
  return typeof value === 'string' && KOKORO_VOICE_ID_PATTERN.test(value)
}

/** Normalizes one server-reported identifier into the shared catalog shape. */
export function toKokoroVoiceRecord(voiceId: string): VoiceRecord | null {
  const match = voiceId.match(KOKORO_VOICE_ID_PATTERN)
  if (!match) return null

  const [, languagePrefix, genderPrefix, slug] = match
  return {
    id: voiceId,
    name: `${slug[0].toUpperCase()}${slug.slice(1)}`,
    locale: LOCALE_BY_PREFIX[languagePrefix],
    gender: genderPrefix === 'f' ? 'Female' : 'Male'
  }
}

/** Returns the base language code a Kokoro voice speaks, such as `en` or `zh`. */
export function kokoroVoiceLanguage(voiceId: string): string | null {
  const record = toKokoroVoiceRecord(voiceId)
  return record ? record.locale.split('-')[0] : null
}

export function isKokoroVoiceIdForLanguage(
  languageCode: string,
  voiceId: string
): boolean {
  return kokoroVoiceLanguage(voiceId) === languageCode
}

export const KOKORO_FALLBACK_VOICES: readonly VoiceRecord[] = KOKORO_VOICE_IDS
  .map(toKokoroVoiceRecord)
  .filter((voice): voice is VoiceRecord => voice !== null)

/**
 * The first listed voice of each language wins, so reordering KOKORO_VOICE_IDS
 * is the only thing needed to change a language default.
 */
export const DEFAULT_KOKORO_VOICE_BY_LANGUAGE: Readonly<Record<string, string>> =
  KOKORO_FALLBACK_VOICES.reduce<Record<string, string>>((defaults, voice) => {
    const languageCode = voice.locale.split('-')[0]
    if (!defaults[languageCode]) defaults[languageCode] = voice.id
    return defaults
  }, {})
