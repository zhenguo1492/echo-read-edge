import { computed, signal, type ReadonlySignal } from '@preact/signals'

import { detectDominantLanguage } from '@/lib/language-detector'
import {
  TTS_ENGINE_KEY,
  VOICE_LANGUAGE_KEY,
  VOICE_SELECTION_KEYS,
  settingsRepository
} from '@/storage'
import { collectPageTextSample } from './page-text-sample'

/**
 * The language this page is written in, or null when the page has not said and
 * its text does not tell. Null is what the reader's own stored voice answers,
 * so an undetected page reads exactly as it did before detection existed.
 */
export const pageReadingLanguage = signal<string | null>(null)

/** Matches the repository's own fallback, so both agree before settings load. */
const FALLBACK_READING_LANGUAGE = 'en'

/** The language of the voice the reader chose, which answers for undetected pages. */
const storedVoiceLanguage = signal(FALLBACK_READING_LANGUAGE)

/** What a page is read in, and whether the page or the reader decided it. */
export interface ReadingLanguage {
  code: string
  detected: boolean
}

/**
 * The language this page is actually read in. Surfaces showing it say one thing
 * rather than two: the page's own language where it has one, and otherwise the
 * language whose voice will speak, which is what the reader hears either way.
 */
export const readingLanguage: ReadonlySignal<ReadingLanguage> = computed(() => {
  const detected = pageReadingLanguage.value
  return detected
    ? { code: detected, detected: true }
    : { code: storedVoiceLanguage.value, detected: false }
})

/**
 * A page that renders its article after load has nothing to detect at document
 * idle, so one late look catches the common single-fetch case without turning
 * detection into a poll.
 */
export const PAGE_LANGUAGE_RETRY_DELAY_MS = 1500

/** A verdict this weak names no dominant language, whatever it ranks first. */
const MINIMUM_CONFIDENT_PERCENTAGE = 50

/** The browser detector answers on its own schedule; a page must not wait forever. */
const BROWSER_DETECTION_TIMEOUT_MS = 2000

interface BrowserLanguageDetection {
  language: string
  percentage: number
}

type StorageChanges = Record<string, chrome.storage.StorageChange>

let changeListener: ((changes: StorageChanges, areaName: string) => void) | null =
  null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let detectionVersion = 0

/**
 * Detects the page's language once the content script is running and keeps
 * following it until the reader overrules it.
 *
 * Reading a French article with an English voice is the failure this prevents,
 * and it is one the reader would otherwise fix by hand on every page. So the
 * page answers for itself by default. A reader who then picks a language in the
 * popup has said something detection cannot know, and detection stands down for
 * as long as that page is open rather than switching the voice back.
 */
export function initializePageLanguage(): void {
  destroyPageLanguage()

  const version = ++detectionVersion
  void detectPageLanguage(version)
  void loadStoredVoiceLanguage()

  const onChanged = chrome?.storage?.onChanged
  if (!onChanged) return

  changeListener = (changes, areaName) => {
    if (areaName !== 'local') return

    const chosen = VOICE_SELECTION_KEYS.some((key) => key in changes)
    if (!chosen && !(TTS_ENGINE_KEY in changes)) return

    // Every write that picks a language writes the language key with it, so the
    // change itself usually answers; an engine switch only moves the stored
    // language, which the repository has to resolve.
    const newValue = changes[VOICE_LANGUAGE_KEY]?.newValue
    if (typeof newValue === 'string') storedVoiceLanguage.value = newValue
    else void loadStoredVoiceLanguage()

    if (!chosen) return

    // The reader has chosen; this page stops answering for itself.
    detectionVersion += 1
    cancelRetry()
    pageReadingLanguage.value = null
  }
  onChanged.addListener(changeListener)
}

export function destroyPageLanguage(): void {
  detectionVersion += 1
  cancelRetry()
  if (!changeListener) return

  chrome?.storage?.onChanged?.removeListener(changeListener)
  changeListener = null
}

async function loadStoredVoiceLanguage(): Promise<void> {
  try {
    const settings = await settingsRepository.getTtsSettings()
    storedVoiceLanguage.value = settings.voiceLanguage || FALLBACK_READING_LANGUAGE
  } catch (error) {
    console.error(
      '[EchoRead Edge] The stored reading language could not be loaded.',
      error
    )
  }
}

async function detectPageLanguage(version: number): Promise<void> {
  const sample = collectPageTextSample()
  const detected = (await detectWithBrowser(sample))
    ?? detectDominantLanguage(sample)
    ?? declaredDocumentLanguage()

  if (version !== detectionVersion) return

  if (detected) {
    pageReadingLanguage.value = detected
    return
  }
  scheduleRetry(version)
}

/** Runs once: a page that stays silent twice is one the reader's voice answers. */
function scheduleRetry(version: number): void {
  if (retryTimer) return

  retryTimer = setTimeout(() => {
    retryTimer = null
    if (version !== detectionVersion) return
    void detectPageLanguage(version)
  }, PAGE_LANGUAGE_RETRY_DELAY_MS)
}

function cancelRetry(): void {
  if (!retryTimer) return

  clearTimeout(retryTimer)
  retryTimer = null
}

/**
 * Asks Chrome's own detector first: it reads far more of a language than a word
 * list can, and it costs the page nothing. Everything it cannot answer for -
 * an old browser, a short sample, a tie between two languages - falls through to
 * the text evidence rather than being reported as a verdict.
 */
function detectWithBrowser(text: string): Promise<string | null> {
  const detector = chrome?.i18n?.detectLanguage
  if (!detector || !text) return Promise.resolve(null)

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), BROWSER_DETECTION_TIMEOUT_MS)
    const settle = (result: unknown): void => {
      clearTimeout(timer)
      resolve(readBrowserDetection(result))
    }

    try {
      const pending = detector.call(chrome.i18n, text, settle) as unknown
      if (isPromiseLike(pending)) void pending.then(settle, () => settle(null))
    } catch {
      settle(null)
    }
  })
}

function readBrowserDetection(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null

  const languages = (result as { languages?: unknown }).languages
  if (!Array.isArray(languages)) return null

  const strongest = (languages as BrowserLanguageDetection[])
    .filter((entry) => typeof entry?.language === 'string')
    .sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0))[0]

  if (!strongest || (strongest.percentage ?? 0) < MINIMUM_CONFIDENT_PERCENTAGE) {
    return null
  }
  return baseLanguage(strongest.language)
}

/**
 * A declared language is a claim rather than evidence, so it answers only where
 * the text itself said nothing. Sites routinely ship a template's `lang` while
 * serving another language's article.
 */
function declaredDocumentLanguage(): string | null {
  return baseLanguage(document.documentElement.lang ?? '')
}

function baseLanguage(value: string): string | null {
  const code = value.trim().toLowerCase().split(/[-_]/u)[0]
  return /^[a-z]{2,3}$/u.test(code) && code !== 'und' ? code : null
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}
