import {
  DEFAULT_KOKORO_BASE_URL,
  DEFAULT_TTS_ENGINE,
  isTtsEngineId,
  normalizeKokoroBaseUrl,
  type TtsEngineId
} from '@/lib/tts-engines'
import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  isTranslationTargetLanguage
} from '@/lib/translation-languages'
import type { InterfaceSettings, TranslationSettings, TTSSettings } from '@/types'
import { EDGE_VOICE_CATALOG_CACHE_KEY } from './edge-voice-catalog-repository'
import {
  readEdgeCatalogDefaults,
  sanitizeVoiceMap,
  VOICE_MAP_RULES
} from './voice-map'

/** Watched by the content script: an engine switch can move the stored language. */
export const TTS_ENGINE_KEY = 'ttsEngine'
const ENGINE_KEY = TTS_ENGINE_KEY
const KOKORO_BASE_URL_KEY = 'kokoroBaseUrl'
/** Watched by the content script so a popup choice reaches an open page. */
export const VOICE_LANGUAGE_KEY = 'voiceLanguage'
const SPEED_KEY = 'speed'
const LEGACY_ENGLISH_DIALECT_KEY = 'englishDialect'
/** Watched by the content script so a popup change reaches an open page. */
export const TRANSLATION_TARGET_KEY = 'translationTargetLanguage'

/** Watched by the content script so a popup change reaches an open page. */
export const FLOATING_CONTROLLER_KEY = 'showFloatingController'
export const DEFAULT_FLOATING_CONTROLLER_VISIBLE = true
const DEFAULT_SPEED = 1
const MIN_SPEED = 0.5
const MAX_SPEED = 2

/** Voice identifiers do not survive an engine switch, so each engine owns a key. */
const VOICE_MAP_KEY_BY_ENGINE: Readonly<Record<TtsEngineId, string>> = {
  edge: 'voiceMap',
  kokoro: 'kokoroVoiceMap'
}

/**
 * The keys that record a reader's own choice of reading voice. A page detecting
 * its language watches them so an explicit choice always outranks detection.
 */
export const VOICE_SELECTION_KEYS: readonly string[] = [
  VOICE_LANGUAGE_KEY,
  VOICE_MAP_KEY_BY_ENGINE.edge,
  VOICE_MAP_KEY_BY_ENGINE.kokoro
]

const fallbackValues: StoredSettings = {}
const fallbackStorage: SettingsStorage = {
  async get(keys) {
    return Object.fromEntries(keys.map((key) => [key, fallbackValues[key]]))
  },
  async set(items) {
    Object.assign(fallbackValues, items)
  }
}

type StoredSettings = Record<string, unknown>

interface SettingsStorage {
  get(keys: string[]): Promise<StoredSettings>
  set(items: Record<string, unknown>): Promise<void>
}

export interface SettingsRepository {
  getTtsSettings(): Promise<TTSSettings>
  setEngine(engine: TtsEngineId): Promise<TTSSettings>
  setKokoroBaseUrl(baseUrl: string): Promise<TTSSettings>
  setVoiceLanguage(languageCode: string): Promise<TTSSettings>
  setVoice(languageCode: string, voiceId: string): Promise<TTSSettings>
  setSpeed(speed: number): Promise<TTSSettings>
  getTranslationSettings(): Promise<TranslationSettings>
  setTranslationTargetLanguage(languageCode: string): Promise<TranslationSettings>
  getInterfaceSettings(): Promise<InterfaceSettings>
  setFloatingControllerVisible(visible: boolean): Promise<InterfaceSettings>
}

/** Stores the retained popup settings in chrome.storage.local. */
export class ChromeLocalSettingsRepository implements SettingsRepository {
  constructor(private readonly storage?: SettingsStorage) {}

  async getTtsSettings(): Promise<TTSSettings> {
    const stored = await this.getStorage().get([
      ENGINE_KEY,
      KOKORO_BASE_URL_KEY,
      VOICE_MAP_KEY_BY_ENGINE.edge,
      VOICE_MAP_KEY_BY_ENGINE.kokoro,
      VOICE_LANGUAGE_KEY,
      SPEED_KEY,
      LEGACY_ENGLISH_DIALECT_KEY,
      EDGE_VOICE_CATALOG_CACHE_KEY
    ])

    const engine = isTtsEngineId(stored[ENGINE_KEY]) ? stored[ENGINE_KEY] : DEFAULT_TTS_ENGINE
    const rules = VOICE_MAP_RULES[engine]
    const defaults = engine === 'edge'
      ? readEdgeCatalogDefaults(stored[EDGE_VOICE_CATALOG_CACHE_KEY])
      : { ...rules.defaults }
    const voiceByLanguage = sanitizeVoiceMap(
      rules,
      stored[VOICE_MAP_KEY_BY_ENGINE[engine]],
      defaults,
      engine === 'edge' ? stored[LEGACY_ENGLISH_DIALECT_KEY] : undefined
    )

    const voiceLanguage = sanitizeVoiceLanguage(
      stored[VOICE_LANGUAGE_KEY],
      voiceByLanguage
    )

    return {
      engine,
      kokoroBaseUrl: normalizeKokoroBaseUrl(stored[KOKORO_BASE_URL_KEY])
        ?? DEFAULT_KOKORO_BASE_URL,
      voice: voiceByLanguage[voiceLanguage],
      voiceLanguage,
      voiceByLanguage,
      speed: sanitizeSpeed(stored[SPEED_KEY])
    }
  }

  async setEngine(engine: TtsEngineId): Promise<TTSSettings> {
    if (!isTtsEngineId(engine)) {
      throw new TypeError(`${String(engine)} is not an available speech engine.`)
    }

    await this.getStorage().set({ [ENGINE_KEY]: engine })
    return await this.getTtsSettings()
  }

  async setKokoroBaseUrl(baseUrl: string): Promise<TTSSettings> {
    const normalized = normalizeKokoroBaseUrl(baseUrl)
    if (!normalized) {
      throw new TypeError('The Kokoro server address must be an HTTP or HTTPS origin.')
    }
    await this.getStorage().set({ [KOKORO_BASE_URL_KEY]: normalized })
    return await this.getTtsSettings()
  }

  /**
   * The reader speaks with one chosen voice, so picking a language is itself a
   * setting: it decides which stored voice every later request uses.
   */
  async setVoiceLanguage(languageCode: string): Promise<TTSSettings> {
    const settings = await this.getTtsSettings()
    const normalized = baseLanguage(languageCode)
    if (!normalized || !settings.voiceByLanguage?.[normalized]) {
      throw new TypeError(`${languageCode} has no voice in the selected engine.`)
    }

    await this.getStorage().set({ [VOICE_LANGUAGE_KEY]: normalized })
    return {
      ...settings,
      voice: settings.voiceByLanguage[normalized],
      voiceLanguage: normalized
    }
  }

  async setVoice(languageCode: string, voiceId: string): Promise<TTSSettings> {
    const settings = await this.getTtsSettings()
    if (!VOICE_MAP_RULES[settings.engine].isVoiceForLanguage(languageCode, voiceId)) {
      throw new TypeError('The selected voice does not belong to the requested language.')
    }

    // Choosing a voice is also choosing to read with it, so the language it
    // belongs to becomes the reading language instead of staying a stored map
    // entry the reader would have to select separately.
    const voiceLanguage = baseLanguage(languageCode) ?? settings.voiceLanguage
    const voiceByLanguage = { ...settings.voiceByLanguage, [voiceLanguage]: voiceId }
    await this.getStorage().set({
      [VOICE_MAP_KEY_BY_ENGINE[settings.engine]]: voiceByLanguage,
      [VOICE_LANGUAGE_KEY]: voiceLanguage
    })
    return {
      ...settings,
      voice: voiceId,
      voiceLanguage,
      voiceByLanguage
    }
  }

  async setSpeed(speed: number): Promise<TTSSettings> {
    if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
      throw new TypeError(`Speaking speed must be between ${MIN_SPEED} and ${MAX_SPEED}.`)
    }

    await this.getStorage().set({ [SPEED_KEY]: speed })
    return { ...await this.getTtsSettings(), speed }
  }

  async getTranslationSettings(): Promise<TranslationSettings> {
    const stored = await this.getStorage().get([TRANSLATION_TARGET_KEY])
    const targetLanguage = stored[TRANSLATION_TARGET_KEY]
    return {
      targetLanguage: isTranslationTargetLanguage(targetLanguage)
        ? targetLanguage
        : DEFAULT_TRANSLATION_TARGET_LANGUAGE
    }
  }

  async setTranslationTargetLanguage(
    languageCode: string
  ): Promise<TranslationSettings> {
    if (!isTranslationTargetLanguage(languageCode)) {
      throw new TypeError(`${languageCode} is not an available translation target.`)
    }

    await this.getStorage().set({ [TRANSLATION_TARGET_KEY]: languageCode })
    return { targetLanguage: languageCode }
  }

  async getInterfaceSettings(): Promise<InterfaceSettings> {
    const stored = await this.getStorage().get([FLOATING_CONTROLLER_KEY])
    const visible = stored[FLOATING_CONTROLLER_KEY]
    return {
      floatingControllerVisible: typeof visible === 'boolean'
        ? visible
        : DEFAULT_FLOATING_CONTROLLER_VISIBLE
    }
  }

  async setFloatingControllerVisible(visible: boolean): Promise<InterfaceSettings> {
    if (typeof visible !== 'boolean') {
      throw new TypeError('Floating controller visibility must be a boolean.')
    }

    await this.getStorage().set({ [FLOATING_CONTROLLER_KEY]: visible })
    return { floatingControllerVisible: visible }
  }

  private getStorage(): SettingsStorage {
    if (this.storage) return this.storage
    return typeof chrome !== 'undefined' && chrome.storage?.local
      ? chrome.storage.local as SettingsStorage
      : fallbackStorage
  }
}

export const settingsRepository: SettingsRepository = new ChromeLocalSettingsRepository()

/**
 * A stored language survives only while the active engine still offers a voice
 * for it, so switching to an engine with a smaller catalog reads in English
 * rather than falling back to an identifier that engine cannot speak.
 */
function sanitizeVoiceLanguage(
  value: unknown,
  voiceByLanguage: Readonly<Record<string, string>>
): string {
  const normalized = typeof value === 'string' ? baseLanguage(value) : null
  return normalized && voiceByLanguage[normalized] ? normalized : 'en'
}

function baseLanguage(value: string): string | null {
  return value?.trim().toLowerCase().split(/[-_]/u)[0] || null
}

function sanitizeSpeed(value: unknown): number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_SPEED
    && value <= MAX_SPEED
    ? value
    : DEFAULT_SPEED
}
