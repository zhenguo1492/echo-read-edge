/** The two- or three-letter mark shown for one language, and its English name. */
export interface LanguageBadge {
  badge: string
  name: string
}

/**
 * Badges for the languages this reader speaks and translates into.
 *
 * The mark is the one readers already recognise from language switchers rather
 * than the ISO code, because a badge is read at a glance and CN, JP, and KR are
 * what that glance expects; the name carries the unambiguous answer in the
 * tooltip beside it.
 */
const LANGUAGE_BADGES: Readonly<Record<string, LanguageBadge>> = {
  ar: { badge: 'AR', name: 'Arabic' },
  de: { badge: 'DE', name: 'German' },
  en: { badge: 'EN', name: 'English' },
  es: { badge: 'ES', name: 'Spanish' },
  fr: { badge: 'FR', name: 'French' },
  hi: { badge: 'HI', name: 'Hindi' },
  id: { badge: 'ID', name: 'Indonesian' },
  it: { badge: 'IT', name: 'Italian' },
  ja: { badge: 'JP', name: 'Japanese' },
  ko: { badge: 'KR', name: 'Korean' },
  nl: { badge: 'NL', name: 'Dutch' },
  pl: { badge: 'PL', name: 'Polish' },
  pt: { badge: 'PT', name: 'Portuguese' },
  ru: { badge: 'RU', name: 'Russian' },
  th: { badge: 'TH', name: 'Thai' },
  tr: { badge: 'TR', name: 'Turkish' },
  vi: { badge: 'VN', name: 'Vietnamese' },
  zh: { badge: 'CN', name: 'Chinese' }
}

const UNKNOWN_LANGUAGE: LanguageBadge = { badge: '--', name: 'Unknown' }

/**
 * Names one language code for display. A code this list does not cover is shown
 * as itself: the engines' live catalogs can speak more languages than are
 * curated here, and an uppercase code still tells the reader which one is used.
 */
export function languageBadge(code: string): LanguageBadge {
  const baseLanguage = code.trim().toLowerCase().split(/[-_]/u)[0]
  if (!baseLanguage) return UNKNOWN_LANGUAGE

  return LANGUAGE_BADGES[baseLanguage] ?? {
    badge: baseLanguage.toUpperCase(),
    name: baseLanguage.toUpperCase()
  }
}
