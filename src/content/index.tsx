import { render, type JSX } from 'preact'
import { signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { SelectionInfo, TTSSettings, WordTimestamp } from '@/types'
import { FloatingController } from '@/content/components/FloatingController'
import { SelectionToolbar } from '@/content/components/selection/SelectionToolbar'
import { DictionaryCard } from '@/content/components/DictionaryCard'
import {
  TranslationPanel,
  type TranslationPanelItem
} from '@/content/components/TranslationPanel'
import {
  destroyHighlightOverlay,
  initializeHighlightOverlay
} from '@/content/modules/highlight-overlay'
import {
  activateSentence,
  type ActivationIntent,
  destroyClickToListen,
  hoveredSentenceIndex,
  initializeClickToListen,
  setClickToListenActivator
} from '@/content/modules/click-to-listen'
import {
  destroyModifierSelection,
  initializeModifierSelection
} from '@/content/modules/modifier-selection'
import {
  destroyInterfaceSettings,
  floatingControllerVisible,
  initializeInterfaceSettings
} from '@/content/modules/interface-settings'
import {
  destroyTranslationSettings,
  initializeTranslationSettings
} from '@/content/modules/translation-settings'
import {
  destroyPageLanguage,
  initializePageLanguage,
  pageReadingLanguage
} from '@/content/modules/page-language'
import {
  destroyExampleSpeech,
  initializeExampleSpeech
} from '@/content/modules/example-speech-controller'
import {
  clearPageSelection,
  destroyPageSelection,
  initializePageSelection,
  pageSelection
} from '@/content/modules/page-selection'
import { createWordRanges } from '@/content/modules/word-range-mapper'
import { selectSelectionHighlightRanges } from '@/content/modules/selection-highlight'
import {
  disposeReading,
  disposeTtsPlayer,
  initializeTtsPlayer,
  readSentences
} from '@/content/modules/tts-player'
import {
  activePlaybackId,
  currentIndex,
  currentWordIndex,
  errorMessage,
  isIdle,
  sentences,
  wordTimestamps
} from '@/lib/store/playback-store'
import { selectReadingVoice } from '@/lib/reading-voice'
import { settingsRepository } from '@/storage'

import './styles/content.css'

const CONTENT_ROOT_ID = 'echo-read-edge-content-root'
let activeSentenceRanges: Range[] = []
let translationSentenceRanges: Range[] | null = null
let activeWordRangeCache: Array<{
  timestamps: readonly WordTimestamp[]
  ranges: Array<Range | null>
} | null> = []

interface TranslationRequestState {
  items: TranslationPanelItem[]
  onActivateSentence(index: number): void | Promise<unknown>
  onClose(): void
}

interface DictionaryRequestState {
  word: string
  range: Range
}

const translationRequest = signal<TranslationRequestState | null>(null)
const dictionaryRequest = signal<DictionaryRequestState | null>(null)

/**
 * Prevents duplicate content UI if a development loader evaluates the bundle
 * more than once in the same page. A closed shadow root cannot be recovered, so
 * an existing host is treated as the owner of the initialized extension UI.
 */
if (!document.getElementById(CONTENT_ROOT_ID)) {
  mountContentUi()
}

/** Creates the retained closed Shadow DOM boundary and mounts selection reading. */
function mountContentUi(): void {
  const shadowHost = document.createElement('div')
  shadowHost.id = CONTENT_ROOT_ID
  shadowHost.style.position = 'fixed'
  shadowHost.style.top = '0'
  shadowHost.style.left = '0'
  shadowHost.style.width = '0'
  shadowHost.style.height = '0'
  shadowHost.style.zIndex = '2147483647'

  const shadowRoot = shadowHost.attachShadow({ mode: 'closed' })
  const shadowStyles = document.createElement('style')
  shadowStyles.textContent = `
    :host {
      all: initial;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    .echo-read-edge-root {
      all: initial;
      pointer-events: auto;
      color-scheme: light;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button {
      font: inherit;
    }

    .echo-read-edge-controller {
      all: initial;
      position: fixed;
      top: 50%;
      right: 16px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-sizing: border-box;
      gap: 6px;
      padding: 9px 5px;
      transform: translateY(-50%);
      border-radius: 14px;
      background: rgb(23 23 23 / 95%);
      box-shadow: 0 8px 32px rgb(0 0 0 / 40%);
      color-scheme: dark;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: grab;
      user-select: none;
    }

    .echo-read-edge-controller.is-collapsed {
      padding: 4px 5px 6px;
      gap: 2px;
    }

    .echo-read-edge-controller.is-dragging,
    .echo-read-edge-controller.is-dragging button[data-drag-handle] {
      cursor: grabbing;
    }

    .echo-read-edge-controller-handle {
      align-self: stretch;
      height: 15px;
      border-radius: 5px;
      color: rgb(255 255 255 / 35%);
      cursor: grab;
    }

    /* Small text needs more contrast than the dot grip it replaced. */
    .echo-read-edge-controller-badge {
      color: rgb(255 255 255 / 60%);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.06em;
      line-height: 1;
    }

    .echo-read-edge-controller-handle:hover .echo-read-edge-controller-badge {
      color: rgb(255 255 255 / 90%);
    }

    .echo-read-edge-controller-handle:hover {
      color: rgb(255 255 255 / 70%);
      background: rgb(255 255 255 / 10%);
    }

    .echo-read-edge-controller.is-collapsed .echo-read-edge-controller-handle {
      color: rgb(255 255 255 / 55%);
    }

    .echo-read-edge-controller *,
    .echo-read-edge-controller *::before,
    .echo-read-edge-controller *::after {
      box-sizing: border-box;
    }

    .echo-read-edge-controller button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      background: transparent;
      font: inherit;
      cursor: pointer;
      transition: color 150ms ease, background-color 150ms ease;
    }

    .echo-read-edge-controller button:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .echo-read-edge-controller button:focus-visible {
      outline: 1px solid #bfdbfe;
      outline-offset: 2px;
    }

    .echo-read-edge-controller-play {
      position: relative;
      width: 24px;
      height: 24px;
    }

    .echo-read-edge-controller-ring {
      position: absolute;
      top: 0;
      left: 0;
      width: 24px;
      height: 24px;
      transform: rotate(-90deg);
      pointer-events: none;
    }

    .echo-read-edge-controller-ring-track {
      stroke: rgb(255 255 255 / 30%);
    }

    .echo-read-edge-controller-ring-value {
      stroke: rgb(255 255 255 / 90%);
      transition: stroke-dashoffset 300ms ease, stroke 200ms ease;
    }

    .echo-read-edge-controller-ring.is-error .echo-read-edge-controller-ring-track {
      stroke: rgb(239 68 68 / 30%);
    }

    .echo-read-edge-controller-ring.is-error .echo-read-edge-controller-ring-value {
      stroke: rgb(239 68 68 / 90%);
    }

    .echo-read-edge-controller-primary {
      position: relative;
      z-index: 1;
      width: 24px;
      height: 24px;
      border-radius: 999px;
      color: #ffffff;
      background: #2563eb;
    }

    .echo-read-edge-controller-primary:hover:not(:disabled) {
      background: #1d4ed8;
    }

    .echo-read-edge-controller button.is-loading:disabled {
      opacity: 1;
      cursor: progress;
    }

    .echo-read-edge-controller-spinner {
      transform-origin: 50% 50%;
      animation: echo-read-edge-controller-spin 900ms linear infinite;
    }

    @keyframes echo-read-edge-controller-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .echo-read-edge-controller-primary.is-error {
      background: rgb(239 68 68 / 90%);
      box-shadow: 0 0 8px rgb(239 68 68 / 50%);
    }

    /* One strip no wider than the play control it sits under. */
    .echo-read-edge-controller-nav {
      display: flex;
      align-items: center;
      gap: 1px;
    }

    button.echo-read-edge-controller-step {
      width: 10px;
      height: 22px;
      border-radius: 3px;
      color: rgb(255 255 255 / 60%);
      background: rgb(255 255 255 / 12%);
    }

    .echo-read-edge-controller-nav .echo-read-edge-controller-action.is-stop {
      width: 12px;
      height: 22px;
      margin-top: 0;
      border-radius: 3px;
      color: rgb(255 255 255 / 60%);
      background: rgb(255 255 255 / 12%);
    }

    .echo-read-edge-controller-step:hover:not(:disabled) {
      color: rgb(255 255 255 / 95%);
      background: rgb(255 255 255 / 22%);
    }

    .echo-read-edge-controller-action {
      width: 26px;
      height: 26px;
      margin-top: 2px;
      border-radius: 4px;
      color: rgb(255 255 255 / 50%);
    }

    .echo-read-edge-controller-action:hover:not(:disabled) {
      color: rgb(255 255 255 / 80%);
      background: rgb(255 255 255 / 10%);
    }

    .echo-read-edge-controller-action[aria-pressed="true"] {
      color: rgb(37 99 235 / 90%);
      background: rgb(37 99 235 / 20%);
    }

    .echo-read-edge-controller-action.is-stop:hover:not(:disabled) {
      color: rgb(239 68 68 / 90%);
      background: rgb(239 68 68 / 15%);
    }

    /* The caret hangs off the translate button as its language chooser. */
    .echo-read-edge-controller-translate {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .echo-read-edge-controller-language {
      width: 20px;
      height: 12px;
      border-radius: 3px;
      color: rgb(255 255 255 / 40%);
    }

    .echo-read-edge-controller-language:hover,
    .echo-read-edge-controller-language[aria-expanded="true"] {
      color: rgb(255 255 255 / 85%);
      background: rgb(255 255 255 / 10%);
    }

    /* Wider than the panel, so it hangs off whichever side has the room. */
    .echo-read-edge-controller-menu {
      position: absolute;
      top: 50%;
      z-index: 1;
      display: flex;
      flex-direction: column;
      gap: 1px;
      width: 210px;
      max-height: min(260px, 60vh);
      overflow-y: auto;
      padding: 4px;
      transform: translateY(-50%);
      border-radius: 10px;
      background: rgb(23 23 23 / 98%);
      box-shadow: 0 8px 28px rgb(0 0 0 / 45%);
    }

    .echo-read-edge-controller-menu.is-left {
      right: calc(100% + 8px);
    }

    .echo-read-edge-controller-menu.is-right {
      left: calc(100% + 8px);
    }

    .echo-read-edge-controller-menu button {
      justify-content: flex-start;
      width: 100%;
      padding: 6px 8px;
      border-radius: 6px;
      color: rgb(255 255 255 / 70%);
      font-size: 12px;
      line-height: 1.3;
      text-align: left;
      white-space: nowrap;
    }

    .echo-read-edge-controller-menu button:hover {
      color: #ffffff;
      background: rgb(255 255 255 / 10%);
    }

    .echo-read-edge-controller-menu button[aria-checked="true"] {
      color: #ffffff;
      background: rgb(37 99 235 / 30%);
    }

    .echo-read-edge-panel {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      width: min(420px, calc(100vw - 24px));
      max-height: min(500px, calc(100vh - 24px));
      overflow: hidden;
      border: 1px solid #e2e8f0;
      border-radius: 9px;
      color: #1e293b;
      background: #ffffff;
      box-shadow: 0 8px 28px rgb(15 23 42 / 20%);
      font: 13px/1.5 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: auto;
      color-scheme: light;
    }

    .echo-read-edge-panel *, .echo-read-edge-panel *::before, .echo-read-edge-panel *::after {
      box-sizing: border-box;
    }

    .echo-read-edge-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 42px;
      padding: 8px 10px 8px 14px;
      border-bottom: 1px solid #e2e8f0;
      color: #64748b;
      font-weight: 600;
    }

    .echo-read-edge-panel button {
      border: 0;
      color: inherit;
      background: transparent;
      font: inherit;
      cursor: pointer;
    }

    .echo-read-edge-panel-header > button,
    .echo-read-edge-dictionary-actions > button {
      padding: 4px 7px;
      border-radius: 5px;
    }

    .echo-read-edge-panel-header button:hover {
      background: #f1f5f9;
    }

    .echo-read-edge-panel-body {
      max-height: 430px;
      overflow: auto;
      padding: 10px 14px 14px;
    }

    .echo-read-edge-translation-line {
      display: block;
      width: 100%;
      padding: 5px 7px !important;
      border-radius: 5px !important;
      text-align: left;
    }

    .echo-read-edge-translation-line:hover,
    .echo-read-edge-translation-line.is-hovered,
    .echo-read-edge-translation-line.is-current {
      background: #eff6ff;
    }

    .echo-read-edge-dictionary-header > div:first-child {
      display: block;
    }

    .echo-read-edge-dictionary-title {
      width: 100%;
      min-width: 0;
      padding-right: 26px;
    }

    .echo-read-edge-dictionary-header {
      position: relative;
      align-items: flex-start;
    }

    .echo-read-edge-dictionary-header > .echo-read-edge-dictionary-actions {
      position: absolute;
      top: 6px;
      right: 6px;
    }

    .echo-read-edge-save-word {
      color: #94a3b8;
      font-size: 15px;
      line-height: 1;
    }

    .echo-read-edge-save-word.is-saved {
      color: #f59e0b;
    }

    .echo-read-edge-save-word:disabled {
      cursor: wait;
    }

    .echo-read-edge-anchored-panel {
      display: flex;
      flex-direction: column;
      overflow: visible;
    }

    .echo-read-edge-anchored-panel > .echo-read-edge-panel-header,
    .echo-read-edge-anchored-panel > .echo-read-edge-dictionary-tabs {
      flex: none;
    }

    .echo-read-edge-anchored-panel > .echo-read-edge-panel-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    .echo-read-edge-dictionary-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    .echo-read-edge-panel-arrow {
      display: contents;
      pointer-events: none;
    }

    .echo-read-edge-panel-arrow-border,
    .echo-read-edge-panel-arrow-fill {
      position: absolute;
      width: 0;
      height: 0;
      border-style: solid;
      border-color: transparent;
    }

    .echo-read-edge-panel-arrow-border {
      z-index: 1;
      border-width: 9px;
    }

    .echo-read-edge-panel-arrow-fill {
      z-index: 2;
      border-width: 8px;
    }

    .echo-read-edge-panel-arrow-border.is-below {
      top: -9px;
      border-top: 0;
      border-bottom-color: #cbd5e1;
    }

    .echo-read-edge-panel-arrow-fill.is-below {
      top: -8px;
      border-top: 0;
      border-bottom-color: #ffffff;
    }

    .echo-read-edge-panel-arrow-border.is-above {
      bottom: -9px;
      border-bottom: 0;
      border-top-color: #cbd5e1;
    }

    .echo-read-edge-panel-arrow-fill.is-above {
      bottom: -8px;
      border-bottom: 0;
      border-top-color: #ffffff;
    }

    .echo-read-edge-panel-arrow-cover {
      position: absolute;
      z-index: 3;
      width: 16px;
      height: 2px;
      background: #ffffff;
    }

    .echo-read-edge-panel-arrow-cover.is-below {
      top: -1px;
    }

    .echo-read-edge-panel-arrow-cover.is-above {
      bottom: -1px;
    }

    .echo-read-edge-dictionary-title > div:first-child {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }

    .echo-read-edge-dictionary-header strong {
      color: #0f172a;
      font-size: 19px;
    }

    .echo-read-edge-dictionary-header span {
      color: #64748b;
      font-weight: 400;
    }

    .echo-read-edge-dictionary-header .echo-read-edge-stars {
      color: #f59e0b;
      font-size: 11px;
    }

    .echo-read-edge-badge, .echo-read-edge-lemma {
      padding: 2px 6px !important;
      border-radius: 4px !important;
      color: #2563eb !important;
      background: #eff6ff !important;
      font-size: 10px !important;
    }

    .echo-read-edge-phonetics {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      width: 100%;
      margin-top: 4px;
      color: #64748b;
      font-size: 12px;
    }

    .echo-read-edge-phonetics > span {
      display: inline-flex;
      flex: none;
      align-items: center;
      white-space: nowrap;
    }

    .echo-read-edge-phonetics button {
      padding: 0 3px 0 0;
    }

    .echo-read-edge-dictionary-title > small {
      display: block;
      margin-top: 4px;
      color: #94a3b8;
      font-size: 10px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .echo-read-edge-dictionary-actions {
      display: flex;
      gap: 3px;
    }

    .echo-read-edge-dictionary-tabs {
      display: flex;
      flex-shrink: 0;
      padding: 0 8px;
      overflow-x: auto;
      border-bottom: 1px solid #e2e8f0;
    }

    .echo-read-edge-dictionary-tabs button {
      flex-shrink: 0;
      padding: 8px 9px;
      border-bottom: 2px solid transparent;
      color: #64748b;
      background: transparent;
      font-size: 11px;
    }

    .echo-read-edge-dictionary-tabs button.is-active {
      border-bottom-color: #2563eb;
      color: #2563eb;
    }

    .echo-read-edge-dictionary-source {
      margin: 12px 0 0;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      color: #94a3b8;
      font-size: 10px;
      text-align: right;
    }

    .echo-read-edge-muted {
      color: #64748b;
      text-align: center;
    }

    .echo-read-edge-dictionary-row {
      display: flex;
      gap: 7px;
      margin-bottom: 8px;
    }

    .echo-read-edge-dictionary-row i,
    .echo-read-edge-collins-entry i,
    .echo-read-edge-synonym-group i {
      flex-shrink: 0;
      color: #2563eb;
      font-size: 11px;
    }

    .echo-read-edge-discrimination,
    .echo-read-edge-collins-entry {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
    }

    .echo-read-edge-discrimination h3 {
      margin: 0 0 8px;
      color: #64748b;
      font-size: 11px;
    }

    .echo-read-edge-discrimination p,
    .echo-read-edge-collins-entry p,
    .echo-read-edge-synonym-group p,
    .echo-read-edge-example p {
      margin: 0 0 5px;
    }

    .echo-read-edge-collins-entry small {
      margin-left: 6px;
      padding: 1px 4px;
      border-radius: 3px;
      color: #94a3b8;
      background: #f1f5f9;
    }

    .echo-read-edge-example {
      margin: 0 0 10px;
      padding-left: 10px;
      border-left: 2px solid #e2e8f0;
    }

    .echo-read-edge-example small {
      color: #64748b;
    }

    .echo-read-edge-speakable-example {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin: 0 0 10px;
      padding-left: 10px;
      border-left: 2px solid #e2e8f0;
    }

    .echo-read-edge-speakable-example.is-small {
      margin-bottom: 6px;
    }

    .echo-read-edge-example-copy {
      flex: 1;
      min-width: 0;
    }

    .echo-read-edge-example-copy p {
      margin: 0 0 3px;
      color: #334155;
    }

    .echo-read-edge-speakable-example.is-small .echo-read-edge-example-copy p {
      color: #64748b;
      font-size: 12px;
    }

    .echo-read-edge-example-copy small {
      color: #64748b;
    }

    .echo-read-edge-example-copy span {
      border-radius: 2px;
      transition: color 80ms ease, background-color 80ms ease;
    }

    .echo-read-edge-example-copy span.is-speaking {
      color: #1e3a8a;
      background: #bfdbfe;
    }

    .echo-read-edge-example-speech {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      padding: 3px !important;
      border-radius: 4px !important;
      color: #64748b !important;
    }

    .echo-read-edge-example-speech:hover {
      color: #2563eb !important;
      background: #eff6ff !important;
    }

    .echo-read-edge-example-speech:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    .echo-read-edge-synonym-group {
      margin-bottom: 10px;
    }

    .echo-read-edge-synonym-group div {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .echo-read-edge-synonym-group div span {
      padding: 2px 7px;
      border-radius: 4px;
      background: #f1f5f9;
      font-size: 11px;
    }

    .echo-read-edge-meaning h3 {
      margin: 8px 0 5px;
      color: #2563eb;
      font-size: 12px;
      font-style: italic;
    }

    .echo-read-edge-meaning ol {
      margin: 0;
      padding-left: 22px;
    }

    .echo-read-edge-meaning li {
      margin: 0 0 8px;
    }

    .echo-read-edge-meaning q {
      display: block;
      margin-top: 2px;
      color: #64748b;
    }

    .echo-read-edge-meaning p, .echo-read-edge-error p {
      margin: 6px 0;
    }

    .echo-read-edge-error button {
      padding: 5px 9px;
      border-radius: 5px;
      color: #ffffff;
      background: #2563eb;
    }
  `

  const renderContainer = document.createElement('div')
  shadowRoot.append(shadowStyles, renderContainer)
  document.body.appendChild(shadowHost)

  initializeTtsPlayer()
  initializePageSelection()
  initializeInterfaceSettings()
  initializeTranslationSettings()
  initializePageLanguage()
  initializeExampleSpeech()
  void initializeHighlightOverlay()
  initializeClickToListen(getSessionSentenceRanges)
  initializeModifierSelection({
    onRead: handleSelectionPlay,
    onOpenDictionary: openDictionary
  })
  render(<ContentUi />, renderContainer)

  /** Releases extension-owned listeners and DOM when the page is discarded. */
  window.addEventListener(
    'pagehide',
    () => {
      disposeTtsPlayer()
      destroyPageSelection()
      destroyInterfaceSettings()
      destroyTranslationSettings()
      destroyPageLanguage()
      destroyExampleSpeech()
      destroyClickToListen()
      destroyModifierSelection()
      destroyHighlightOverlay()
      activeSentenceRanges = []
      translationSentenceRanges = null
      activeWordRangeCache = []
      render(null, renderContainer)
      shadowHost.remove()
    },
    { once: true }
  )
}

function ContentUi(): JSX.Element {
  const translation = translationRequest.value
  const dictionary = dictionaryRequest.value
  const playbackSentenceIndex = currentIndex.value
  const controllerVisible = floatingControllerVisible.value
  const hasPageSelection = pageSelection.value !== null
  const translationFollowsPlayback = Boolean(
    translation &&
    activePlaybackId.value &&
    translation.items.length === activeSentenceRanges.length &&
    translation.items.every((item, index) => item.range === activeSentenceRanges[index])
  )
  // A selection translation owns the session ranges for as long as its panel is
  // open, which is exactly when the controller's translate button toggles it.
  const translationFollowsSelection = Boolean(
    translation && translationSentenceRanges !== null
  )
  return (
    <>
      <SelectionToolbar
        onPlay={handleSelectionPlay}
        onTranslate={openSelectionTranslation}
        onOpenDictionary={openDictionary}
      />
      <PlaybackHighlightLayer />
      <SelectionHighlightLayer />
      {controllerVisible && (
        <FloatingController
          onPlaySelection={readPageSelection}
          onStop={stopReadingSession}
          onTranslate={() => {
            // Selected text outranks the queue here for the same reason it does
            // on the play control: it is the text the reader just pointed at.
            if (hasPageSelection) {
              translatePageSelection(translationFollowsSelection)
              return
            }
            if (translationFollowsPlayback) closeTranslationPanel()
            else openReadingQueueTranslation()
          }}
          translationActive={
            hasPageSelection ? translationFollowsSelection : translationFollowsPlayback
          }
        />
      )}
      {translation && (
        <TranslationPanel
          items={translation.items}
          activeIndex={translationFollowsPlayback ? playbackSentenceIndex : 0}
          onActivateSentence={translation.onActivateSentence}
          onClose={closeTranslationPanel}
        />
      )}
      {dictionary && (
        <DictionaryCard
          word={dictionary.word}
          range={dictionary.range}
          onClose={() => {
            dictionaryRequest.value = null
          }}
        />
      )}
    </>
  )
}

/**
 * Returns the sentence Ranges the current session exposes to page interactions.
 * An open translation panel owns them until it closes, because it may describe a
 * selection that has not started playback yet.
 */
function getSessionSentenceRanges(): Range[] {
  return translationSentenceRanges ?? activeSentenceRanges
}

/**
 * Keeps the selected sentences visible for the whole session.
 *
 * Starting playback drops the native browser selection, so without this layer
 * the reader only ever sees the one sentence being spoken and loses track of how
 * far the queue reaches. The component renders no DOM of its own; it exists to
 * follow the session signals that decide which sentences the layer may paint.
 */
function SelectionHighlightLayer(): null {
  const playbackId = activePlaybackId.value
  const idle = isIdle.value
  const sentenceIndex = currentIndex.value
  const sentenceCount = sentences.value.length
  const hoveredIndex = hoveredSentenceIndex.value
  const translationOpen = translationRequest.value !== null

  useEffect(() => {
    let active = true
    void initializeHighlightOverlay().then((highlightOverlay) => {
      if (!active) return

      const ranges =
        playbackId || translationOpen
          ? selectSelectionHighlightRanges(getSessionSentenceRanges(), {
              activeIndex: playbackId && !idle ? sentenceIndex : null,
              hoveredIndex
            })
          : []
      if (ranges.length === 0) highlightOverlay.clearHighlights('selection')
      else highlightOverlay.renderHighlights(ranges, 'selection')
    })

    return () => {
      active = false
    }
  }, [
    hoveredIndex,
    idle,
    playbackId,
    sentenceCount,
    sentenceIndex,
    translationOpen
  ])

  return null
}

/**
 * Paints the sentence and word layers for the active queue. It renders no DOM
 * of its own, so playback highlighting never depends on whether a control
 * surface happens to be mounted, positioned, or visible.
 */
function PlaybackHighlightLayer(): null {
  const playbackId = activePlaybackId.value
  const sentenceIndex = currentIndex.value
  const idle = isIdle.value
  const activeWord = currentWordIndex.value
  const activeTimestamps = wordTimestamps.value

  useEffect(() => {
    let active = true
    void initializeHighlightOverlay().then((highlightOverlay) => {
      if (!active) return

      const range = activeSentenceRanges[sentenceIndex]
      if (!playbackId || idle || !range?.startContainer.isConnected) {
        highlightOverlay.clearHighlights('sentence')
        return
      }

      highlightOverlay.renderHighlights([range], 'sentence')
      highlightOverlay.scrollToHighlight('sentence')
    })

    return () => {
      active = false
    }
  }, [idle, playbackId, sentenceIndex])

  useEffect(() => {
    let active = true
    void initializeHighlightOverlay().then((highlightOverlay) => {
      if (!active) return

      const sentenceRange = activeSentenceRanges[sentenceIndex]
      if (
        !playbackId ||
        idle ||
        activeWord < 0 ||
        !sentenceRange?.startContainer.isConnected
      ) {
        highlightOverlay.clearHighlights('word')
        return
      }

      let cache = activeWordRangeCache[sentenceIndex]
      if (!cache || cache.timestamps !== activeTimestamps) {
        cache = {
          timestamps: activeTimestamps,
          ranges: createWordRanges(sentenceRange, activeTimestamps)
        }
        activeWordRangeCache[sentenceIndex] = cache
      }

      const wordRange = cache.ranges[activeWord]
      if (wordRange?.startContainer.isConnected) {
        highlightOverlay.renderHighlights([wordRange], 'word')
      } else {
        highlightOverlay.clearHighlights('word')
      }
    })

    return () => {
      active = false
    }
  }, [activeTimestamps, activeWord, idle, playbackId, sentenceIndex])

  return null
}

/**
 * Ends the reading session the page currently owns. Pause is the resumable
 * halt; this releases the queue, its offscreen audio cache, and every highlight
 * the session painted. The controller keeps its own re-entrancy guard, because
 * a second dispose would ask the background to release a playback ID this page
 * no longer holds.
 */
async function stopReadingSession(): Promise<void> {
  try {
    await disposeReading()
    closeTranslationPanel()
    activeSentenceRanges = []
    activeWordRangeCache = []
    const highlightOverlay = await initializeHighlightOverlay()
    highlightOverlay.clearAllHighlights()
  } catch (error) {
    console.error('[EchoRead Edge] The reading session could not stop.', error)
  }
}

/** Opens the translation panel for the sentences the active queue is reading. */
function openReadingQueueTranslation(): void {
  closeTranslationPanel()
  translationRequest.value = {
    items: sentences.value.map((sentence, index) => ({
      text: sentence.text,
      range: activeSentenceRanges[index] ?? null
    })),
    onActivateSentence: activateSentence,
    onClose: clearSentenceHoverState
  }
}

function openSelectionTranslation(selection: SelectionInfo): void {
  closeTranslationPanel()
  const ranges = createSentenceRanges(selection)
  let startingPlayback = false
  const onActivateSentence = async (
    index: number,
    intent: ActivationIntent = 'toggle'
  ): Promise<boolean> => {
    if (activeSentenceRanges === ranges && activePlaybackId.value) {
      return await activateSentence(index, intent)
    }
    if (startingPlayback) return false

    startingPlayback = true
    try {
      return await startSelectionPlayback(selection, ranges, index)
    } finally {
      startingPlayback = false
    }
  }

  translationSentenceRanges = ranges
  setClickToListenActivator(onActivateSentence)
  translationRequest.value = {
    items: selection.sentences.map((sentence, index) => ({
      text: sentence.text,
      range: ranges[index] ?? null
    })),
    onActivateSentence,
    onClose: () => {
      setClickToListenActivator(null)
      if (translationSentenceRanges === ranges) translationSentenceRanges = null
      clearSentenceHoverState()
    }
  }
}

function openDictionary(word: string, range: Range): void {
  closeTranslationPanel()
  dictionaryRequest.value = { word, range: range.cloneRange() }
}

function closeTranslationPanel(): void {
  const request = translationRequest.value
  translationRequest.value = null
  request?.onClose()
}

function clearSentenceHoverState(): void {
  hoveredSentenceIndex.value = null
  void initializeHighlightOverlay().then((overlay) => {
    overlay.clearHighlights('hover')
  })
}

/**
 * Starts the text the reader has selected but not yet played. The floating
 * controller offers this because it is the one control surface that stays put:
 * the selection toolbar sits beside the text and is gone once the reader has
 * scrolled or clicked past it.
 */
async function readPageSelection(): Promise<void> {
  const selection = pageSelection.value
  if (!selection) return

  await handleSelectionPlay(selection)
}

/** Toggles the translation panel for a selection that has not started playing. */
function translatePageSelection(isOpen: boolean): void {
  if (isOpen) {
    closeTranslationPanel()
    return
  }

  const selection = pageSelection.value
  if (selection) openSelectionTranslation(selection)
}

/** Sends the already segmented selection into the migrated content TTS player. */
async function handleSelectionPlay(selection: SelectionInfo): Promise<void> {
  if (selection.sentences.length === 0) return

  await startSelectionPlayback(selection, createSentenceRanges(selection), 0)
}

/** Starts a selected-text queue at the sentence activated from page text or translation. */
async function startSelectionPlayback(
  selection: SelectionInfo,
  ranges: Range[],
  startIndex: number
): Promise<boolean> {
  if (selection.sentences.length === 0) return false

  activeSentenceRanges = ranges
  activeWordRangeCache = []
  // The queue now owns this text, so the selection affordances close with the
  // browser selection playback is about to drop.
  clearPageSelection()
  window.getSelection()?.removeAllRanges()
  const ttsSettings: TTSSettings = await settingsRepository.getTtsSettings()
  const started = await readSentences(
    selection.sentences,
    selectReadingVoice(ttsSettings, pageReadingLanguage.value),
    startIndex
  )
  // A newer start may already own the page session while this one was awaiting
  // its response. Only the current owner may clear ranges and highlights.
  if (!started && activeSentenceRanges === ranges) {
    activeSentenceRanges = []
    activeWordRangeCache = []
    const highlightOverlay = await initializeHighlightOverlay()
    highlightOverlay.clearHighlights('sentence')
    highlightOverlay.clearHighlights('word')
    console.warn(
      '[EchoRead Edge] Selected text playback did not start.',
      errorMessage.value ?? 'The speech runtime reported no error.'
    )
  }
  return started
}

/**
 * Converts sentence offsets in the trimmed Selection text into stable DOM Ranges.
 * Range.toString() does not insert synthetic separators between adjacent text
 * nodes, so accumulating the selected portions of those nodes uses the same
 * coordinate system as Selection.toString() and the retained sentence splitter.
 */
function createSentenceRanges(selection: SelectionInfo): Range[] {
  const indexedRanges = selection.sentences.map((sentence) =>
    sentence.range?.startContainer.isConnected ? sentence.range.cloneRange() : null
  )
  if (indexedRanges.every((range): range is Range => range !== null)) {
    return indexedRanges
  }

  const selectedSegments = collectSelectedTextSegments(selection.range)
  const rawSelectedText = selectedSegments
    .map(({ node, startOffset, endOffset }) =>
      node.data.substring(startOffset, endOffset)
    )
    .join('')
  const trimmedTextOffset = rawSelectedText.indexOf(selection.text)
  if (trimmedTextOffset < 0) {
    return indexedRanges.map(
      (range) => range ?? createCollapsedSelectionRange(selection.range)
    )
  }

  return selection.sentences.map((sentence, index) => {
    return (
      indexedRanges[index] ??
      createRangeFromSegments(
        selectedSegments,
        trimmedTextOffset + sentence.start,
        trimmedTextOffset + sentence.end
      )
    )
  })
}

function createCollapsedSelectionRange(selectionRange: Range): Range {
  const range = selectionRange.cloneRange()
  range.collapse(true)
  return range
}

interface SelectedTextSegment {
  node: Text
  startOffset: number
  endOffset: number
  textStart: number
  textEnd: number
}

/**
 * Captures only the portions of text nodes inside the original selection. Page
 * DOM is never wrapped or rewritten, and disconnected nodes are ignored so a
 * page rerender cannot make a later highlight mutate unrelated replacement text.
 */
function collectSelectedTextSegments(range: Range): SelectedTextSegment[] {
  const textNodes = getTextNodes(range.commonAncestorContainer)
  const segments: SelectedTextSegment[] = []
  let textOffset = 0

  for (const node of textNodes) {
    if (!node.isConnected || !range.intersectsNode(node)) continue

    const startOffset = node === range.startContainer ? range.startOffset : 0
    const endOffset = node === range.endContainer ? range.endOffset : node.data.length
    if (endOffset <= startOffset) continue

    const length = endOffset - startOffset
    segments.push({
      node,
      startOffset,
      endOffset,
      textStart: textOffset,
      textEnd: textOffset + length
    })
    textOffset += length
  }
  return segments
}

function getTextNodes(root: Node): Text[] {
  if (root instanceof Text) return [root]

  const nodes: Text[] = []
  collectTextNodes(root, nodes)
  return nodes
}

function collectTextNodes(root: Node, output: Text[]): void {
  for (const child of root.childNodes) {
    if (child instanceof Text) output.push(child)
    else collectTextNodes(child, output)
  }
}

/** Maps one half-open plain-text interval back to its DOM boundary nodes. */
function createRangeFromSegments(
  segments: readonly SelectedTextSegment[],
  start: number,
  end: number
): Range {
  const range = document.createRange()
  const startSegment = segments.find(
    (segment) => start >= segment.textStart && start < segment.textEnd
  )
  const endSegment = [...segments].reverse().find(
    (segment) => end > segment.textStart && end <= segment.textEnd
  )

  if (!startSegment || !endSegment || end <= start) {
    range.selectNodeContents(document.body)
    range.collapse(true)
    return range
  }

  range.setStart(
    startSegment.node,
    startSegment.startOffset + start - startSegment.textStart
  )
  range.setEnd(
    endSegment.node,
    endSegment.startOffset + end - endSegment.textStart
  )
  return range
}
