import { useCallback, useEffect, useState } from 'preact/hooks'

import type { VocabularyRequest, VocabularyResponse } from '@/shared/messages'
import { captureWordContext } from './word-context'

export interface SavedWordState {
  isSaved: boolean
  isPending: boolean
  error: string | null
  toggleSaved(): Promise<void>
}

/**
 * Tracks whether the looked-up word is in the local vocabulary list. Saving
 * records the word and the sentence it was read in; definitions are not copied
 * because the dictionary can produce them again. Every read and write goes
 * through the service worker, so the page never opens the database.
 */
export function useSavedWord(word: string, range: Range | null): SavedWordState {
  const [isSaved, setIsSaved] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    setIsSaved(false)
    setError(null)
    void sendVocabularyRequest({ action: 'vocabulary:status', word })
      .then((response) => {
        if (isCurrent && response.ok) setIsSaved(response.saved)
      })
      .catch(() => {
        // A missing saved state must not block reading the dictionary entry.
      })
    return () => {
      isCurrent = false
    }
  }, [word])

  const toggleSaved = useCallback(async () => {
    if (isPending) return
    setIsPending(true)
    setError(null)

    try {
      const response = await sendVocabularyRequest(
        isSaved
          ? { action: 'vocabulary:remove', word }
          : { action: 'vocabulary:save', word, ...captureWordContext(range) }
      )
      if (response.ok) setIsSaved(response.saved)
      else setError(response.error)
    } catch {
      setError('The word could not be saved.')
    } finally {
      setIsPending(false)
    }
  }, [isPending, isSaved, range, word])

  return { isSaved, isPending, error, toggleSaved }
}

function sendVocabularyRequest(
  request: VocabularyRequest
): Promise<VocabularyResponse> {
  return chrome.runtime.sendMessage<VocabularyRequest, VocabularyResponse>(request)
}
