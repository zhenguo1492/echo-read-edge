import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'

import {
  dictionarySourceLabel,
  isDictionarySourceId,
  type DictionarySourceId
} from '@/lib/dictionary-sources'
import {
  DICTIONARY_TAB_LABELS,
  getAvailableDictionaryTabs,
  selectDictionaryTab,
  type DictionaryTab
} from '@/lib/dictionary-tabs'
import {
  NO_PRONUNCIATION_VOICES,
  type PronunciationAccent,
  type PronunciationVoices
} from '@/lib/pronunciation-voices'
import {
  preemptCompetingAudio,
  stopExampleSpeech
} from '@/shared/example-speech-controller'
import type {
  DictionaryLookupResponse,
  TtsCommandResponse,
  TtsStartRequest
} from '@/shared/messages'
import { loadPronunciationVoices } from '@/shared/pronunciation-voices'
import { settingsRepository } from '@/storage'
import type { DetailedDictionaryEntry } from '@/types'
import { SpeakableExample } from './SpeakableExample'

/** Longer than the service worker's own budget for a full source walk. */
const LOOKUP_TIMEOUT_MS = 20_000
const ORPHANED_PAGE = /extension context invalidated|receiving end does not exist/i

interface DictionaryEntryProps {
  word: string
  /** Header controls owned by the host, such as the page's save-word star. */
  actions?: ComponentChildren
  /** Host-owned message shown above the entry, such as a failed save. */
  notice?: string | null
  onClose(): void
}

/**
 * The multi-tab dictionary entry, backed by the local dict.lookup service.
 *
 * It carries no placement of its own so the in-page card can anchor it to a
 * selection while the popup shows it in a column beside the vocabulary list.
 */
export function DictionaryEntry(props: DictionaryEntryProps): JSX.Element {
  const { word } = props
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
    // A service worker that is torn down mid-request answers nothing at all, so
    // the card owns a deadline of its own rather than waiting out the session.
    const deadline = setTimeout(() => {
      if (!active) return
      setError('The dictionary did not answer. Try again.')
      setLoading(false)
    }, LOOKUP_TIMEOUT_MS)

    void (async () => {
      try {
        // sendMessage throws synchronously once an update orphans this page, so
        // the call belongs inside the try rather than behind a rejection handler.
        const response = await chrome.runtime.sendMessage<unknown, DictionaryLookupResponse>({
          action: 'dictionary:lookup',
          word
        })
        if (!active) return
        if (!response?.ok) {
          setError(response?.error ?? 'The dictionary is currently unavailable.')
          return
        }
        setEntry(response.entry)
        // A saved response predates source attribution, so only a known id shows.
        if (isDictionarySourceId(response.source)) setSource(response.source)
      } catch (error) {
        if (active) setError(lookupFailureMessage(error))
      } finally {
        clearTimeout(deadline)
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
      clearTimeout(deadline)
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

  return (
    <>
      <DictionaryHeader
        fallbackWord={word}
        entry={displayedEntry}
        pronunciationVoices={pronunciationVoices}
        rootEntry={entry}
        actions={props.actions}
        showLemma={showLemma}
        onToggleLemma={() => {
          setShowLemma((value) => !value)
          setActiveTab('meanings')
        }}
        onClose={props.onClose}
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
        {props.notice && <p class="echo-read-edge-error">{props.notice}</p>}
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
    </>
  )
}

/**
 * Reloading an extension leaves the scripts already in a page talking to a
 * runtime that no longer exists, which reads as a broken card unless it says so.
 */
function lookupFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return ORPHANED_PAGE.test(message)
    ? 'The extension was updated. Reload the page to look up words again.'
    : 'The dictionary is currently unavailable.'
}

interface DictionaryHeaderProps {
  fallbackWord: string
  entry: DetailedDictionaryEntry | null
  pronunciationVoices: PronunciationVoices
  rootEntry: DetailedDictionaryEntry | null
  actions?: ComponentChildren
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
            rootEntry.inflectedData
              ? (
                <button type="button" class="echo-read-edge-lemma" onClick={props.onToggleLemma}>
                  {props.showLemma ? `← ${rootEntry.originalWord}` : `→ ${rootEntry.lemma}`}
                </button>
              )
              // A source that indexes headwords only has no inflected entry to
              // toggle to, so the trail just says which form was looked up.
              : (
                <span class="echo-read-edge-lemma">
                  {`${rootEntry.originalWord} → ${rootEntry.lemma}`}
                </span>
              )
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
        {props.actions}
        <button type="button" aria-label="Close dictionary" onClick={props.onClose}>×</button>
      </div>
    </header>
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
    await preemptCompetingAudio()
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
