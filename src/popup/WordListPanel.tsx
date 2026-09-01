import type { JSX } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import type { SavedWord, WordOccurrence } from '@/storage'
import { vocabularyRepository } from '@/storage'

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 200

interface WordListPanelProps {
  /** The word whose dictionary entry is open beside the list, if any. */
  openWord: string | null
  onOpenWord(word: string | null): void
}

/** Local vocabulary list ordered by when each word was saved. */
export function WordListPanel(props: WordListPanelProps): JSX.Element {
  const [words, setWords] = useState<SavedWord[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [direction, setDirection] = useState<'newest' | 'oldest'>('newest')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedWordId, setExpandedWordId] = useState<string | null>(null)
  // A stale response from an abandoned query must never replace a newer list.
  const requestCounter = useRef(0)

  const loadFirstPage = useCallback(async () => {
    const requestId = ++requestCounter.current
    setIsLoading(true)
    setError(null)

    try {
      const [page, count] = await Promise.all([
        vocabularyRepository.listWords({ search, direction, limit: PAGE_SIZE }),
        vocabularyRepository.countWords()
      ])
      if (requestId !== requestCounter.current) return
      setWords(page.items)
      setNextCursor(page.nextCursor)
      setTotal(count)
    } catch (loadError) {
      if (requestId !== requestCounter.current) return
      setError(readErrorMessage(loadError))
    } finally {
      if (requestId === requestCounter.current) setIsLoading(false)
    }
  }, [direction, search])

  useEffect(() => {
    void loadFirstPage()
  }, [loadFirstPage])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore) return
    const requestId = requestCounter.current
    setIsLoadingMore(true)

    try {
      const page = await vocabularyRepository.listWords({
        search,
        direction,
        limit: PAGE_SIZE,
        cursor: nextCursor
      })
      if (requestId !== requestCounter.current) return
      setWords((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (loadError) {
      setError(readErrorMessage(loadError))
    } finally {
      setIsLoadingMore(false)
    }
  }

  async function removeWord(word: SavedWord): Promise<void> {
    setError(null)
    try {
      await vocabularyRepository.removeWord(word.id)
      setWords((current) => current.filter((item) => item.id !== word.id))
      setTotal((current) => Math.max(0, current - 1))
      if (expandedWordId === word.id) setExpandedWordId(null)
      // A word that is no longer saved must not leave its entry open beside the list.
      if (props.openWord === word.word) props.onOpenWord(null)
    } catch (removeError) {
      setError(readErrorMessage(removeError))
    }
  }

  return (
    <section class="settings-section word-list-section" aria-labelledby="word-list-title">
      <div class="section-heading">
        <h2 id="word-list-title">Saved words</h2>
        <p>
          {total === 0
            ? 'Words you save from the dictionary card appear here.'
            : `${total} ${total === 1 ? 'word' : 'words'} saved on this device.`}
        </p>
      </div>

      <div class="word-list-controls">
        <input
          type="search"
          aria-label="Search saved words"
          placeholder="Search saved words"
          value={searchInput}
          onInput={(event) => setSearchInput(
            (event.currentTarget as HTMLInputElement).value
          )}
        />
        <label class="select-setting">
          <span>Order</span>
          <select
            aria-label="Word list order"
            value={direction}
            onChange={(event) => setDirection(
              (event.currentTarget as HTMLSelectElement).value === 'oldest'
                ? 'oldest'
                : 'newest'
            )}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      {error && <p class="word-list-error" role="alert">{error}</p>}

      {isLoading ? (
        <p class="loading-message">Loading saved words...</p>
      ) : words.length === 0 ? (
        <p class="loading-message">
          {search ? 'No saved word matches this search.' : 'No words saved yet.'}
        </p>
      ) : (
        <ul class="word-list">
          {words.map((word) => (
            <WordListItem
              key={word.id}
              word={word}
              isOpen={word.word === props.openWord}
              onOpen={() => props.onOpenWord(
                word.word === props.openWord ? null : word.word
              )}
              isExpanded={word.id === expandedWordId}
              onToggle={() => setExpandedWordId(
                word.id === expandedWordId ? null : word.id
              )}
              onRemove={() => void removeWord(word)}
            />
          ))}
        </ul>
      )}

      {nextCursor && !isLoading && (
        <button
          type="button"
          class="word-list-more"
          disabled={isLoadingMore}
          onClick={() => void loadMore()}
        >
          {isLoadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
    </section>
  )
}

interface WordListItemProps {
  word: SavedWord
  isOpen: boolean
  isExpanded: boolean
  onOpen(): void
  onToggle(): void
  onRemove(): void
}

function WordListItem(props: WordListItemProps): JSX.Element {
  const { word } = props
  const [newest, ...earlier] = word.occurrences
  const shown = props.isExpanded ? word.occurrences : newest ? [newest] : []

  return (
    <li class="word-list-item">
      <div class="word-list-row">
        <button
          type="button"
          class={props.isOpen ? 'word-list-word is-open' : 'word-list-word'}
          aria-pressed={props.isOpen}
          aria-label={`Look up ${word.word}`}
          onClick={props.onOpen}
        >
          {word.word}
        </button>
        <time dateTime={word.createdAt}>{formatSaveTime(word.createdAt)}</time>
        <button
          type="button"
          class="word-list-remove"
          aria-label={`Remove ${word.word}`}
          onClick={props.onRemove}
        >
          ×
        </button>
      </div>

      {shown.map((occurrence) => (
        <WordSentence key={occurrence.id} occurrence={occurrence} />
      ))}

      {earlier.length > 0 && (
        <button
          type="button"
          class="word-list-toggle"
          aria-expanded={props.isExpanded}
          onClick={props.onToggle}
        >
          {props.isExpanded
            ? 'Show fewer sentences'
            : `Show ${earlier.length} earlier ${earlier.length === 1 ? 'sentence' : 'sentences'}`}
        </button>
      )}
    </li>
  )
}

/** One sentence the word was met in, with the page it was read on. */
function WordSentence({ occurrence }: { occurrence: WordOccurrence }): JSX.Element {
  return (
    <div class="word-list-occurrence">
      {occurrence.context
        ? <q>{occurrence.context}</q>
        : <p class="word-list-muted">No sentence was captured for this page.</p>}
      {occurrence.sourceUrl && (
        <a href={occurrence.sourceUrl} target="_blank" rel="noreferrer noopener">
          {occurrence.sourceTitle ?? occurrence.sourceUrl}
        </a>
      )}
    </div>
  )
}

function formatSaveTime(createdAt: string): string {
  const savedAt = new Date(createdAt)
  if (Number.isNaN(savedAt.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(savedAt)
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The vocabulary list could not be read.'
}
