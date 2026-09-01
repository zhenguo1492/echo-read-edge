import type { JSX } from 'preact'
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
  type PronunciationVoices
} from '@/lib/pronunciation-voices'
import type {
  DictionaryLookupResponse,
  TtsCommandResponse,
  TtsStartRequest
} from '@/shared/messages'
import { loadPronunciationVoices } from '@/shared/pronunciation-voices'
import { settingsRepository } from '@/storage'
import type { DetailedDictionaryEntry } from '@/types'

interface WordDictionaryPanelProps {
  word: string
  onClose(): void
}

/**
 * The saved word's dictionary entry, shown beside the vocabulary list.
 *
 * It reads the same `dictionary:lookup` service as the in-page card, so a word
 * the reader saved while reading opens from its cache instead of a new request.
 */
export function WordDictionaryPanel({
  word,
  onClose
}: WordDictionaryPanelProps): JSX.Element {
  const [entry, setEntry] = useState<DetailedDictionaryEntry | null>(null)
  const [source, setSource] = useState<DictionarySourceId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [activeTab, setActiveTab] = useState<DictionaryTab>('meanings')
  const [showLemma, setShowLemma] = useState(false)
  const [pronunciationVoices, setPronunciationVoices] = useState<PronunciationVoices>(
    NO_PRONUNCIATION_VOICES
  )

  // An accent the selected engine has no voice for offers no playback button,
  // exactly as the in-page card does.
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
    setIsLoading(true)
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
        // A cached response predates source attribution, so only a known id shows.
        if (isDictionarySourceId(response.source)) setSource(response.source)
      })
      .catch(() => {
        if (active) setError('The dictionary is currently unavailable.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [attempt, word])

  const displayedEntry = useMemo(() => {
    if (!entry) return null
    return !showLemma && entry.inflectedData ? entry.inflectedData : entry
  }, [entry, showLemma])
  const availableTabs = displayedEntry ? getAvailableDictionaryTabs(displayedEntry) : []
  const selectedTab = selectDictionaryTab(availableTabs, activeTab)

  return (
    <section
      class="dictionary-panel"
      role="dialog"
      aria-label={`Dictionary entry for ${word}`}
    >
      <header class="dictionary-panel-header">
        <div class="dictionary-panel-title">
          <div class="dictionary-panel-headword">
            <strong>{displayedEntry?.word ?? word}</strong>
            {displayedEntry?.collinsStar
              ? <span class="dictionary-panel-stars">
                  {'★'.repeat(displayedEntry.collinsStar)}
                </span>
              : null}
            {displayedEntry?.level && (
              <span class="dictionary-panel-badge">{displayedEntry.level}</span>
            )}
            {entry?.isLemmatized && entry.originalWord && entry.lemma && (
              <button
                type="button"
                class="dictionary-panel-lemma"
                onClick={() => {
                  setShowLemma((value) => !value)
                  setActiveTab('meanings')
                }}
              >
                {showLemma ? `← ${entry.originalWord}` : `→ ${entry.lemma}`}
              </button>
            )}
          </div>
          <div class="dictionary-panel-phonetics">
            <Pronunciation
              word={displayedEntry?.word ?? word}
              label="UK"
              phonetic={displayedEntry?.ukPhonetic}
              voiceId={pronunciationVoices.uk}
            />
            <Pronunciation
              word={displayedEntry?.word ?? word}
              label="US"
              phonetic={displayedEntry?.usPhonetic}
              voiceId={pronunciationVoices.us}
            />
            {!displayedEntry?.ukPhonetic
              && !displayedEntry?.usPhonetic
              && displayedEntry?.phonetic
              && <span>{displayedEntry.phonetic}</span>}
          </div>
          {displayedEntry?.forms && <small>{displayedEntry.forms}</small>}
        </div>
        <button
          type="button"
          class="dictionary-panel-close"
          aria-label="Close dictionary"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {!isLoading && displayedEntry && availableTabs.length > 0 && (
        <nav class="dictionary-panel-tabs" aria-label="Dictionary sections">
          {availableTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              class={tab === selectedTab ? 'is-active' : ''}
              aria-pressed={tab === selectedTab}
              onClick={() => setActiveTab(tab)}
            >
              {DICTIONARY_TAB_LABELS[tab]}
            </button>
          ))}
        </nav>
      )}

      <div class="dictionary-panel-body">
        {isLoading && <p class="dictionary-panel-muted">Looking up {word}...</p>}
        {!isLoading && error && (
          <div class="dictionary-panel-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              class="dictionary-panel-retry"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {!isLoading && displayedEntry && (
          <DictionaryTabContent entry={displayedEntry} tab={selectedTab} />
        )}
        {!isLoading && displayedEntry && source && (
          <p class="dictionary-panel-source">Source: {dictionarySourceLabel(source)}</p>
        )}
      </div>
    </section>
  )
}

/** One accent, with playback only when the selected engine has a voice for it. */
function Pronunciation(props: {
  word: string
  label: string
  phonetic?: string
  voiceId: string | null
}): JSX.Element | null {
  if (!props.phonetic) return null
  const voiceId = props.voiceId
  return (
    <span>
      {voiceId && (
        <button
          type="button"
          aria-label={`Play ${props.label} pronunciation`}
          onClick={() => void speakWord(props.word, voiceId)}
        >
          🔊
        </button>
      )}
      {props.label} {props.phonetic}
    </span>
  )
}

async function speakWord(word: string, voiceId: string): Promise<void> {
  try {
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
    return (
      <div>
        {entry.meanings.map((meaning) => (
          <div class="dictionary-panel-row">
            {meaning.partOfSpeech && <i>{meaning.partOfSpeech}</i>}
            <span>{meaning.definition}</span>
          </div>
        ))}
        {entry.discriminate.length > 0 && (
          <section class="dictionary-panel-group">
            <h3>Discrimination</h3>
            {entry.discriminate.map((item) => (
              <p><b>{item.word}</b> {item.usage}</p>
            ))}
          </section>
        )}
      </div>
    )
  }

  if (tab === 'collins') {
    return (
      <div>
        {entry.collins.map((item) => (
          <section class="dictionary-panel-group">
            <div class="dictionary-panel-pos">
              <i>{item.pos}</i>
              {item.posTips && <small>{item.posTips}</small>}
            </div>
            <p>{item.definition}</p>
            {item.examples.map((example) => (
              <Example text={example.en} translation={example.zh} />
            ))}
          </section>
        ))}
      </div>
    )
  }

  if (tab === 'examples') {
    return (
      <div>
        {entry.examples.map((example) => (
          <Example text={example.en} translation={example.zh} />
        ))}
      </div>
    )
  }

  if (tab === 'synonyms') {
    return (
      <div>
        {entry.synonyms.map((group) => (
          <section class="dictionary-panel-group">
            <p><i>{group.pos}</i> {group.meaning}</p>
            <div class="dictionary-panel-synonyms">
              {group.words.map((synonym) => <span>{synonym}</span>)}
            </div>
          </section>
        ))}
      </div>
    )
  }

  return (
    <div>
      {entry.phrases.map((phrase) => (
        <div class="dictionary-panel-row">
          <b>{phrase.phrase}</b>
          <span>{phrase.meaning}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * One example sentence. The popup has no page to highlight words in, so it
 * shows the sentence and its translation without the in-page speech controls.
 */
function Example(props: { text: string; translation?: string }): JSX.Element {
  return (
    <div class="dictionary-panel-example">
      <p>{props.text}</p>
      {props.translation && <small>{props.translation}</small>}
    </div>
  )
}
