import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'

import type {
  DictionaryLookupResponse,
  TtsCommandResponse,
  TtsStartRequest
} from '@/shared/messages'
import { stopExampleSpeech } from '@/content/modules/example-speech-controller'
import { loadPronunciationVoices } from '@/shared/pronunciation-voices'
import { useSavedWord } from '@/content/modules/saved-word'
import type { SavedWordState } from '@/content/modules/saved-word'
import { disposeReading } from '@/content/modules/tts-player'
import {
  DICTIONARY_TAB_LABELS,
  getAvailableDictionaryTabs,
  selectDictionaryTab,
  type DictionaryTab
} from '@/lib/dictionary-tabs'
import {
  dictionarySourceLabel,
  isDictionarySourceId,
  type DictionarySourceId
} from '@/lib/dictionary-sources'
import {
  NO_PRONUNCIATION_VOICES,
  type PronunciationAccent,
  type PronunciationVoices
} from '@/lib/pronunciation-voices'
import type { DetailedDictionaryEntry } from '@/types'
import { settingsRepository } from '@/storage'
import { AnchoredPanel } from './AnchoredPanel'
import { SpeakableExample } from './SpeakableExample'

interface DictionaryCardProps {
  word: string
  range: Range
  onClose(): void
}

/** Migrated multi-tab dictionary panel backed by the local dict.lookup service. */
export function DictionaryCard({ word, range, onClose }: DictionaryCardProps): JSX.Element {
  const [entry, setEntry] = useState<DetailedDictionaryEntry | null>(null)
  const [source, setSource] = useState<DictionarySourceId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [activeTab, setActiveTab] = useState<DictionaryTab>('meanings')
  const [showLemma, setShowLemma] = useState(false)
  const [pronunciationVoices, setPronunciationVoices] = useState<PronunciationVoices>(
    NO_PRONUNCIATION_VOICES
  )

  // The catalog belongs to the selected engine, so an accent with no voice never
  // renders a control the runtime would reject.
  useEffect(() => {
    let active = true
    void loadPronunciationVoices().then((voices) => {
      if (active) setPronunciationVoices(voices)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setEntry(null)
    setSource(null)
    setShowLemma(false)
    void chrome.runtime
      .sendMessage<unknown, DictionaryLookupResponse>({
        action: 'dictionary:lookup',
        word
      })
      .then((response) => {
        if (!active) return
        if (!response.ok) {
          setError(response.error)
          return
        }
        setEntry(response.entry)
        // A saved response predates source attribution, so only a known id shows.
        if (isDictionarySourceId(response.source)) setSource(response.source)
      })
      .catch(() => {
        if (active) setError('The dictionary is currently unavailable.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [attempt, word])

  const displayedEntry = useMemo(() => {
    if (!entry) return null
    return !showLemma && entry.inflectedData ? entry.inflectedData : entry
  }, [entry, showLemma])
  const availableTabs = displayedEntry
    ? getAvailableDictionaryTabs(displayedEntry)
    : []
  const selectedTab = selectDictionaryTab(availableTabs, activeTab)
  // The reader saves the form currently on screen, not the lemma behind it.
  const savedWord = useSavedWord(word, range)

  return (
    <AnchoredPanel
      anchorRange={range}
      ariaLabel={`Dictionary entry for ${word}`}
      class="echo-read-edge-dictionary-card"
      onClose={onClose}
    >
      <DictionaryHeader
        fallbackWord={word}
        entry={displayedEntry}
        pronunciationVoices={pronunciationVoices}
        rootEntry={entry}
        savedWord={savedWord}
        showLemma={showLemma}
        onToggleLemma={() => {
          setShowLemma((value) => !value)
          setActiveTab('meanings')
        }}
        onClose={onClose}
      />

      {!loading && displayedEntry && availableTabs.length > 0 && (
        <nav class="echo-read-edge-dictionary-tabs" aria-label="Dictionary sections">
          {availableTabs.map((tab) => (
            <button
              type="button"
              class={tab === selectedTab ? 'is-active' : ''}
              aria-pressed={tab === selectedTab}
              onClick={() => setActiveTab(tab)}
            >
              {DICTIONARY_TAB_LABELS[tab]}{tab === 'collins' ? ` (${displayedEntry.collins.length})` : ''}
            </button>
          ))}
        </nav>
      )}

      <div class="echo-read-edge-panel-body echo-read-edge-dictionary-body">
        {savedWord.error && <p class="echo-read-edge-error">{savedWord.error}</p>}
        {loading && <p class="echo-read-edge-muted">Looking up word…</p>}
        {!loading && error && (
          <div class="echo-read-edge-error">
            <p>{error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
          </div>
        )}
        {!loading && displayedEntry && (
          <DictionaryTabContent entry={displayedEntry} tab={selectedTab} />
        )}
        {!loading && displayedEntry && source && (
          <p class="echo-read-edge-dictionary-source">
            Source: {dictionarySourceLabel(source)}
          </p>
        )}
      </div>
    </AnchoredPanel>
  )
}

interface DictionaryHeaderProps {
  fallbackWord: string
  entry: DetailedDictionaryEntry | null
  pronunciationVoices: PronunciationVoices
  rootEntry: DetailedDictionaryEntry | null
  savedWord: SavedWordState
  showLemma: boolean
  onToggleLemma(): void
  onClose(): void
}

function DictionaryHeader(props: DictionaryHeaderProps): JSX.Element {
  const { entry, rootEntry } = props
  return (
    <header class="echo-read-edge-panel-header echo-read-edge-dictionary-header">
      <div class="echo-read-edge-dictionary-title">
        <div>
          <strong>{entry?.word ?? props.fallbackWord}</strong>
          {entry?.collinsStar ? <span class="echo-read-edge-stars">{'★'.repeat(entry.collinsStar)}</span> : null}
          {entry?.level && <span class="echo-read-edge-badge">{entry.level}</span>}
          {rootEntry?.isLemmatized && rootEntry.originalWord && rootEntry.lemma && (
            <button type="button" class="echo-read-edge-lemma" onClick={props.onToggleLemma}>
              {props.showLemma ? `← ${rootEntry.originalWord}` : `→ ${rootEntry.lemma}`}
            </button>
          )}
        </div>
        <div class="echo-read-edge-phonetics">
          <Pronunciation
            word={entry?.word ?? props.fallbackWord}
            accent="uk"
            label="UK"
            phonetic={entry?.ukPhonetic}
            audioUrl={entry?.ukSpeech}
            voiceId={props.pronunciationVoices.uk}
          />
          <Pronunciation
            word={entry?.word ?? props.fallbackWord}
            accent="us"
            label="US"
            phonetic={entry?.usPhonetic}
            audioUrl={entry?.usSpeech}
            voiceId={props.pronunciationVoices.us}
          />
          {!entry?.ukPhonetic && !entry?.usPhonetic && entry?.phonetic && <span>{entry.phonetic}</span>}
        </div>
        {entry?.forms && <small>{entry.forms}</small>}
      </div>
      <div class="echo-read-edge-dictionary-actions">
        <SaveWordButton savedWord={props.savedWord} />
        <button type="button" aria-label="Close dictionary" onClick={props.onClose}>×</button>
      </div>
    </header>
  )
}

/** One control for both directions so the reader always sees the saved state. */
function SaveWordButton({ savedWord }: { savedWord: SavedWordState }): JSX.Element {
  const label = savedWord.isSaved ? 'Remove from vocabulary list' : 'Save to vocabulary list'
  return (
    <button
      type="button"
      class={savedWord.isSaved ? 'echo-read-edge-save-word is-saved' : 'echo-read-edge-save-word'}
      aria-label={label}
      aria-pressed={savedWord.isSaved}
      title={label}
      disabled={savedWord.isPending}
      onClick={() => void savedWord.toggleSaved()}
    >
      {savedWord.isSaved ? '★' : '☆'}
    </button>
  )
}

/**
 * Shows one accent's transcription, and offers playback only when the selected
 * engine actually has a voice for that accent.
 */
function Pronunciation(props: {
  word: string
  accent: PronunciationAccent
  label: string
  phonetic?: string
  audioUrl?: string
  voiceId: string | null
}): JSX.Element | null {
  if (!props.phonetic && !props.audioUrl) return null
  const voiceId = props.voiceId
  return (
    <span>
      {voiceId && (
        <button
          type="button"
          aria-label={`Play ${props.label} pronunciation`}
          onClick={() => void playPronunciation(props.word, voiceId)}
        >
          🔊
        </button>
      )}
      {props.label} {props.phonetic}
    </span>
  )
}

async function playPronunciation(word: string, voiceId: string): Promise<void> {
  try {
    await stopExampleSpeech()
    await disposeReading()
    const settings = await settingsRepository.getTtsSettings()
    const request: TtsStartRequest = {
      action: 'tts:start',
      text: word,
      voice: voiceId,
      rate: settings.speed
    }
    const response = await chrome.runtime.sendMessage<
      TtsStartRequest,
      TtsCommandResponse
    >(request)
    if (!response.ok) {
      console.error('[EchoRead Edge] Pronunciation could not be played.', response.error)
    }
  } catch (error) {
    console.error('[EchoRead Edge] Pronunciation could not be played.', error)
  }
}

function DictionaryTabContent(props: {
  entry: DetailedDictionaryEntry
  tab: DictionaryTab
}): JSX.Element {
  const { entry, tab } = props
  if (tab === 'meanings') {
    return <div>{entry.meanings.map((meaning) => (
      <div class="echo-read-edge-dictionary-row">
        {meaning.partOfSpeech && <i>{meaning.partOfSpeech}</i>}
        <span>{meaning.definition}</span>
      </div>
    ))}{entry.discriminate.length > 0 && (
      <section class="echo-read-edge-discrimination">
        <h3>Discrimination</h3>
        {entry.discriminate.map((item) => <p><b>{item.word}</b> {item.usage}</p>)}
      </section>
    )}</div>
  }
  if (tab === 'collins') {
    return <div>{entry.collins.map((item) => (
      <section class="echo-read-edge-collins-entry">
        <div><i>{item.pos}</i>{item.posTips && <small>{item.posTips}</small>}</div>
        <p>{item.definition}</p>
        {item.examples.map((example) => (
          <SpeakableExample text={example.en} translation={example.zh} size="small" />
        ))}
      </section>
    ))}</div>
  }
  if (tab === 'examples') {
    return <div>{entry.examples.map((example) => (
      <SpeakableExample text={example.en} translation={example.zh} />
    ))}</div>
  }
  if (tab === 'synonyms') {
    return <div>{entry.synonyms.map((group) => (
      <section class="echo-read-edge-synonym-group">
        <p><i>{group.pos}</i> {group.meaning}</p>
        <div>{group.words.map((synonym) => <span>{synonym}</span>)}</div>
      </section>
    ))}</div>
  }
  return <div>{entry.phrases.map((phrase) => (
    <div class="echo-read-edge-dictionary-row">
      <b>{phrase.phrase}</b><span>{phrase.meaning}</span>
    </div>
  ))}</div>
}

