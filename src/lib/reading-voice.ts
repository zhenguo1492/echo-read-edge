import type { SpeechVoiceSettings, TTSSettings } from '@/types'

/**
 * Picks the voice one page is read with.
 *
 * The stored settings say which voice the reader chose; the page language says
 * which language the words on screen are in. A stored voice map already holds
 * one voice per language, so honouring the page costs nothing the reader has to
 * configure, and a language the selected engine cannot speak falls back to the
 * reader's own voice rather than to silence or to a voice from another engine.
 */
export function selectReadingVoice(
  settings: TTSSettings,
  pageLanguage: string | null
): SpeechVoiceSettings {
  return {
    voice: voiceForLanguage(settings, pageLanguage) ?? settings.voice,
    speed: settings.speed
  }
}

function voiceForLanguage(
  settings: TTSSettings,
  pageLanguage: string | null
): string | null {
  if (!pageLanguage) return null

  const baseLanguage = pageLanguage.trim().toLowerCase().split(/[-_]/u)[0]
  if (!baseLanguage) return null
  return settings.voiceByLanguage?.[baseLanguage] ?? null
}
