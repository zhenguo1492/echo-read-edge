import { signal } from '@preact/signals'

import {
  DEFAULT_TRANSLATION_TARGET_LANGUAGE,
  isTranslationTargetLanguage
} from '@/lib/translation-languages'
import { TRANSLATION_TARGET_KEY, settingsRepository } from '@/storage'

/**
 * The language selected text is translated into. Both the popup and the
 * floating controller write it, so the page follows storage rather than its own
 * last write, and every surface showing a translation agrees on the target.
 */
export const translationTargetLanguage = signal(DEFAULT_TRANSLATION_TARGET_LANGUAGE)

type StorageChanges = Record<string, chrome.storage.StorageChange>

let changeListener: ((changes: StorageChanges, areaName: string) => void) | null =
  null

export function initializeTranslationSettings(): void {
  destroyTranslationSettings()

  void settingsRepository
    .getTranslationSettings()
    .then((settings) => {
      translationTargetLanguage.value = settings.targetLanguage
    })
    .catch((error: unknown) => {
      console.error(
        '[EchoRead Edge] The translation language could not be loaded.',
        error
      )
    })

  const onChanged = chrome?.storage?.onChanged
  if (!onChanged) return

  changeListener = (changes, areaName) => {
    if (areaName !== 'local') return

    const change = changes[TRANSLATION_TARGET_KEY]
    if (!change) return

    translationTargetLanguage.value = isTranslationTargetLanguage(change.newValue)
      ? change.newValue
      : DEFAULT_TRANSLATION_TARGET_LANGUAGE
  }
  onChanged.addListener(changeListener)
}

export function destroyTranslationSettings(): void {
  if (!changeListener) return

  chrome?.storage?.onChanged?.removeListener(changeListener)
  changeListener = null
}

/**
 * Applies a reader's choice to the page before it reaches storage, so the
 * control and any open translation answer the press rather than the write. A
 * write that fails puts the previous language back instead of leaving the page
 * translating into a target the next page load would not use.
 */
export async function changeTranslationTargetLanguage(
  languageCode: string
): Promise<void> {
  if (!isTranslationTargetLanguage(languageCode)) {
    throw new TypeError(`${languageCode} is not an available translation target.`)
  }

  const previous = translationTargetLanguage.value
  if (languageCode === previous) return

  translationTargetLanguage.value = languageCode
  try {
    await settingsRepository.setTranslationTargetLanguage(languageCode)
  } catch (error) {
    translationTargetLanguage.value = previous
    throw error
  }
}
