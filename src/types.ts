import type { TtsEngineId } from '@/lib/tts-engines'

/**
 * Reader state retained from the legacy playback store. Error details remain in
 * the typed runtime response instead of becoming another persistent UI state.
 */
export type PlayState = 'idle' | 'playing' | 'paused'

/**
 * User-selectable synthesis settings needed by the first migrated reader. The
 * legacy volume field is intentionally absent because output level is fixed at
 * the Provider boundary; speed maps to the public request's rate field.
 *
 * Voice identifiers are engine-specific, so `voice` and `voiceByLanguage` always
 * describe the currently selected engine. Switching engines swaps the whole map
 * rather than translating identifiers that have no equivalent.
 */
export interface TTSSettings {
  engine: TtsEngineId
  /** Origin of the timestamp-capable Kokoro server. */
  kokoroBaseUrl: string
  /** The reader's chosen voice; every spoken request uses exactly this one. */
  voice: string
  /** Base language whose stored voice is the reader's current choice. */
  voiceLanguage: string
  /** Selected voice of the active engine for each offered base language. */
  voiceByLanguage?: Readonly<Record<string, string>>
  speed: number
}

/**
 * The synthesis values a page-side player needs. Engine selection and its host
 * stay in the service worker, so nothing in a content script can reach them.
 */
export type SpeechVoiceSettings = Pick<TTSSettings, 'voice' | 'speed'>

/**
 * Reader-selected translation target for the selection panel. The value is one
 * of the fixed offered codes, never an arbitrary string from storage.
 */
export interface TranslationSettings {
  targetLanguage: string
}

/**
 * Reader-controlled content UI switches. The floating controller stays on screen
 * for the whole page rather than only during a reading session, so its
 * visibility is a stored preference instead of a per-session decision.
 */
export interface InterfaceSettings {
  floatingControllerVisible: boolean
}

/**
 * One sentence within the filtered text coordinate space. Offsets are UTF-16
 * character positions so they can be mapped back to DOM Range boundaries using
 * the retained CharacterPositionIndex implementation.
 */
export interface SentencePosition {
  start: number
  end: number
  text: string
  /** Content-local page Range; never crosses the runtime message boundary. */
  range?: Range | null
}

/**
 * A validated browser selection plus its sentence segmentation. Range and rects
 * are cloned or captured by the selection controller before page code can alter
 * the live Selection object.
 */
export interface SelectionInfo {
  text: string
  range: Range
  rects: DOMRect[]
  sentences: SentencePosition[]
}

/**
 * Provider-neutral word timing measured in seconds from the start of one bounded
 * synthesis chunk. The old backend used start/end millisecond fields; the direct
 * Edge path uses the same startTime/endTime shape as WordBoundary messages.
 */
export interface WordTimestamp {
  word: string
  startTime: number
  endTime: number
}

/**
 * A visible text node indexed into the filtered document coordinate space. This
 * is the minimal text-position record required by selection and highlight ports.
 */
export interface CharacterNode {
  node: Text
  start: number
  end: number
}

export interface DetailedDictionaryExample {
  en: string
  zh: string
  source?: string
}

export interface DetailedDictionaryMeaning {
  partOfSpeech: string
  definition: string
}

export interface DetailedDictionaryCollinsEntry {
  pos: string
  posTips?: string
  definition: string
  examples: DetailedDictionaryExample[]
}

export interface DetailedDictionarySynonym {
  pos: string
  meaning: string
  words: string[]
}

export interface DetailedDictionaryPhrase {
  phrase: string
  meaning: string
}

export interface DetailedDictionaryDiscrimination {
  word: string
  usage: string
}

/**
 * Frontend-owned equivalent of the legacy dict.lookup result. Fields that fed
 * removed recording, study, and backend translation features are omitted.
 */
export interface DetailedDictionaryEntry {
  word: string
  phonetic?: string
  ukPhonetic?: string
  usPhonetic?: string
  ukSpeech?: string
  usSpeech?: string
  level?: string
  collinsStar?: number
  forms?: string
  examTypes: string[]
  meanings: DetailedDictionaryMeaning[]
  examples: DetailedDictionaryExample[]
  phrases: DetailedDictionaryPhrase[]
  synonyms: DetailedDictionarySynonym[]
  discriminate: DetailedDictionaryDiscrimination[]
  collins: DetailedDictionaryCollinsEntry[]
  lemma?: string
  originalWord?: string
  isLemmatized?: boolean
  inflectedData?: DetailedDictionaryEntry
}
