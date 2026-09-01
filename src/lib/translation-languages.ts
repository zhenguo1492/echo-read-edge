import { detectScriptLanguage } from '@/lib/language-detector'

export interface TranslationTargetLanguage {
  /** Accepted by both the runtime message boundary and the Translation Provider. */
  code: string
  label: string
}

/**
 * The languages the selection panel may translate into. The list is fixed here
 * so a stored or page-supplied value can never widen what reaches the Provider.
 */
export const TRANSLATION_TARGET_LANGUAGES: readonly TranslationTargetLanguage[] = [
  { code: 'zh-CN', label: 'Chinese (Simplified) · 简体中文' },
  { code: 'zh-TW', label: 'Chinese (Traditional) · 繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: 'Japanese · 日本語' },
  { code: 'ko', label: 'Korean · 한국어' },
  { code: 'fr', label: 'French · Français' },
  { code: 'de', label: 'German · Deutsch' },
  { code: 'es', label: 'Spanish · Español' },
  { code: 'it', label: 'Italian · Italiano' },
  { code: 'pt', label: 'Portuguese · Português' },
  { code: 'ru', label: 'Russian · Русский' },
  { code: 'ar', label: 'Arabic · العربية' },
  { code: 'hi', label: 'Hindi · हिन्दी' },
  { code: 'nl', label: 'Dutch · Nederlands' },
  { code: 'pl', label: 'Polish · Polski' },
  { code: 'tr', label: 'Turkish · Türkçe' },
  { code: 'vi', label: 'Vietnamese · Tiếng Việt' },
  { code: 'th', label: 'Thai · ไทย' },
  { code: 'id', label: 'Indonesian · Bahasa Indonesia' }
]

/** Preserves the behaviour readers had before the target became configurable. */
export const DEFAULT_TRANSLATION_TARGET_LANGUAGE = 'zh-CN'

const SECONDARY_TRANSLATION_TARGET_LANGUAGE = 'en'

export function isTranslationTargetLanguage(value: unknown): value is string {
  return TRANSLATION_TARGET_LANGUAGES.some((language) => language.code === value)
}

export function translationTargetLabel(code: string): string {
  return TRANSLATION_TARGET_LANGUAGES.find((language) => language.code === code)?.label
    ?? code
}

/**
 * Chooses the target for one selection. Translating text into the language it is
 * already written in returns the same sentence, so an unambiguous script match
 * with the configured target swaps to the secondary language instead. Scripts
 * shared by many languages carry no signal, so the configured target stands.
 */
export function resolveTranslationTargetLanguage(
  text: string,
  preferredLanguage: unknown
): string {
  const target = isTranslationTargetLanguage(preferredLanguage)
    ? preferredLanguage
    : DEFAULT_TRANSLATION_TARGET_LANGUAGE
  const baseLanguage = target.split('-')[0]
  if (detectScriptLanguage(text) !== baseLanguage) return target

  return baseLanguage === SECONDARY_TRANSLATION_TARGET_LANGUAGE
    ? DEFAULT_TRANSLATION_TARGET_LANGUAGE
    : SECONDARY_TRANSLATION_TARGET_LANGUAGE
}
