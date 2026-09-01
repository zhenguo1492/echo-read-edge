import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'

import { initializeHighlightOverlay } from '@/content/modules/highlight-overlay'
import { hoveredSentenceIndex } from '@/content/modules/click-to-listen'
import { getLastWordRange } from '@/content/modules/selection-panel-anchor'
import { translationTargetLanguage } from '@/content/modules/translation-settings'
import { resolveTranslationTargetLanguage } from '@/lib/translation-languages'
import type { TranslateResponse } from '@/shared/messages'
import { AnchoredPanel } from './AnchoredPanel'

export interface TranslationPanelItem {
  text: string
  range: Range | null
}

interface TranslationPanelProps {
  items: readonly TranslationPanelItem[]
  activeIndex: number
  onClose(): void
  onActivateSentence(index: number): void | Promise<unknown>
}

interface TranslationState {
  text: string
  loading: boolean
  error: boolean
}

const translationCache = new Map<string, string>()

/** Compact port of the legacy translation panel with local, typed state only. */
export function TranslationPanel({
  items,
  activeIndex,
  onClose,
  onActivateSentence
}: TranslationPanelProps): JSX.Element | null {
  const [translations, setTranslations] = useState<TranslationState[]>([])
  // Read from the page-wide setting rather than a copy taken when the panel
  // opened, so the controller's language control retranslates what is on screen
  // instead of only reaching the next selection.
  const preferredLanguage = translationTargetLanguage.value
  const [focusedIndex, setFocusedIndex] = useState(activeIndex)
  const cacheKey = useMemo(() => items.map((item) => item.text).join('\u0000'), [items])
  const activeRange = getConnectedRange(items, focusedIndex)
  const anchorRange = useMemo(
    () => activeRange ? getLastWordRange(activeRange) : null,
    [activeRange]
  )

  useEffect(() => {
    setFocusedIndex(normalizeIndex(activeIndex, items.length))
  }, [activeIndex, items.length])

  useEffect(() => {
    let active = true
    const targetLanguages = items.map(
      (item) => resolveTranslationTargetLanguage(item.text, preferredLanguage)
    )
    const initial = items.map((item, index) => {
      const cached = translationCache.get(`${targetLanguages[index]}\u0000${item.text}`)
      return { text: cached ?? '', loading: !cached, error: false }
    })
    setTranslations(initial)

    items.forEach((item, index) => {
      if (!initial[index].loading) return
      const targetLanguage = targetLanguages[index]
      void chrome.runtime
        .sendMessage<unknown, TranslateResponse>({
          action: 'translate:text',
          text: item.text,
          sourceLanguage: 'auto',
          targetLanguage
        })
        .then((response) => {
          if (!active) return
          if (response.ok) {
            translationCache.set(
              `${targetLanguage}\u0000${item.text}`,
              response.translation
            )
          }
          setTranslations((current) => current.map((value, valueIndex) =>
            valueIndex === index
              ? response.ok
                ? { text: response.translation, loading: false, error: false }
                : { text: response.error, loading: false, error: true }
              : value
          ))
        })
        .catch(() => {
          if (!active) return
          setTranslations((current) => current.map((value, valueIndex) =>
            valueIndex === index
              ? { text: 'Translation is unavailable.', loading: false, error: true }
              : value
          ))
        })
    })

    return () => {
      active = false
    }
  }, [cacheKey, items, preferredLanguage])

  if (!anchorRange || items.length === 0) return null

  return (
    <AnchoredPanel
      anchorRange={anchorRange}
      avoidanceRange={activeRange ?? anchorRange}
      ariaLabel="Translation"
      class="echo-read-edge-translation-panel"
      onClose={onClose}
    >
      <header class="echo-read-edge-panel-header">
        <span>Translation</span>
        <button type="button" aria-label="Close translation" onClick={onClose}>×</button>
      </header>
      <div class="echo-read-edge-panel-body">
        {items.map((item, index) => {
          const translation = translations[index]
          return (
            <button
              type="button"
              class={`echo-read-edge-translation-line${
                hoveredSentenceIndex.value === index ? ' is-hovered' : ''
              }${focusedIndex === index ? ' is-current' : ''}`}
              aria-current={focusedIndex === index ? 'true' : undefined}
              onMouseEnter={() => highlightSentence(index, item.range)}
              onMouseLeave={() => clearSentenceHover(index)}
              onClick={() => {
                setFocusedIndex(index)
                void onActivateSentence(index)
              }}
            >
              {!translation || translation.loading
                ? 'Translating…'
                : translation.text || 'No translation available.'}
            </button>
          )
        })}
      </div>
    </AnchoredPanel>
  )
}

function getConnectedRange(
  items: readonly TranslationPanelItem[],
  index: number
): Range | null {
  const activeRange = items[normalizeIndex(index, items.length)]?.range
  if (activeRange?.startContainer.isConnected) return activeRange
  return items.find((item) => item.range?.startContainer.isConnected)?.range ?? null
}

function normalizeIndex(index: number, length: number): number {
  if (length === 0 || !Number.isInteger(index)) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

function highlightSentence(index: number, range: Range | null): void {
  hoveredSentenceIndex.value = index
  if (!range?.startContainer.isConnected) return
  void initializeHighlightOverlay().then((overlay) => {
    overlay.renderHighlights([range], 'hover')
  })
}

function clearSentenceHover(index: number): void {
  if (hoveredSentenceIndex.value === index) hoveredSentenceIndex.value = null
  void initializeHighlightOverlay().then((overlay) => overlay.clearHighlights('hover'))
}
