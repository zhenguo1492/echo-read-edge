import type { VoiceRecord } from '@/shared/messages'

/** The two accents the dictionary panel offers for an English headword. */
export type PronunciationAccent = 'uk' | 'us'

export const PRONUNCIATION_ACCENTS: readonly PronunciationAccent[] = ['uk', 'us']

const LOCALE_BY_ACCENT: Readonly<Record<PronunciationAccent, string>> = {
  uk: 'en-GB',
  us: 'en-US'
}

export type PronunciationVoices = Readonly<Record<PronunciationAccent, string | null>>

export const NO_PRONUNCIATION_VOICES: PronunciationVoices = { uk: null, us: null }

/**
 * Picks the voice that speaks one accent in whichever engine is selected.
 *
 * The reader's own English voice wins when it already has the right accent, so a
 * looked-up word sounds like the page around it. Null means the engine ships no
 * voice for that accent at all, which is the caller's signal to offer no
 * playback rather than to substitute the other accent.
 */
export function selectPronunciationVoice(
  voices: readonly VoiceRecord[],
  accent: PronunciationAccent,
  preferredVoiceId?: string
): string | null {
  const locale = LOCALE_BY_ACCENT[accent]
  const candidates = voices.filter((voice) => voice.locale === locale)
  if (candidates.length === 0) return null
  if (preferredVoiceId && candidates.some((voice) => voice.id === preferredVoiceId)) {
    return preferredVoiceId
  }
  return candidates[0].id
}

export function selectPronunciationVoices(
  voices: readonly VoiceRecord[],
  preferredVoiceId?: string
): PronunciationVoices {
  return {
    uk: selectPronunciationVoice(voices, 'uk', preferredVoiceId),
    us: selectPronunciationVoice(voices, 'us', preferredVoiceId)
  }
}
