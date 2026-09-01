import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SavedWord } from '@/storage'
import { WordListPanel } from './WordListPanel'

const { countWordsMock, listWordsMock, removeWordMock } = vi.hoisted(() => ({
  countWordsMock: vi.fn(),
  listWordsMock: vi.fn(),
  removeWordMock: vi.fn()
}))

vi.mock('@/storage', () => ({
  vocabularyRepository: {
    listWords: listWordsMock,
    removeWord: removeWordMock,
    countWords: countWordsMock
  }
}))

let container: HTMLDivElement
const onOpenWord = vi.fn()

function createSavedWord(
  word: string,
  createdAt: string,
  occurrences: SavedWord['occurrences'] = [createOccurrence(word, createdAt, 'one')]
): SavedWord {
  return {
    id: `${word}-id`,
    word,
    normalizedWord: word,
    createdAt,
    updatedAt: createdAt,
    schemaVersion: 1,
    occurrences
  }
}

function createOccurrence(
  word: string,
  createdAt: string,
  page: string
): SavedWord['occurrences'][number] {
  return {
    id: `${word}-${page}`,
    wordId: `${word}-id`,
    context: `A sentence with ${word} on page ${page}.`,
    sourceUrl: `https://example.com/${page}`,
    sourceTitle: `Page ${page}`,
    createdAt
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  onOpenWord.mockReset()
  countWordsMock.mockResolvedValue(2)
  removeWordMock.mockResolvedValue(undefined)
  listWordsMock.mockResolvedValue({
    items: [
      createSavedWord('resilient', '2026-02-02T10:00:00.000Z'),
      createSavedWord('brittle', '2026-02-01T10:00:00.000Z')
    ],
    nextCursor: null
  })
})

afterEach(() => {
  act(() => render(null, container))
  container.remove()
})

describe('WordListPanel', () => {
  it('lists saved words newest first with their sentence and saved time', async () => {
    await act(async () => render(<WordListPanel openWord={null} onOpenWord={onOpenWord} />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('resilient'))

    expect(listWordsMock).toHaveBeenCalledWith({
      search: '',
      direction: 'newest',
      limit: 25
    })
    expect([...container.querySelectorAll('.word-list-word')].map((item) => item.textContent))
      .toEqual(['resilient', 'brittle'])
    expect(container.textContent).toContain('2 words saved on this device.')
    expect(container.querySelector('.word-list-occurrence q')?.textContent)
      .toBe('A sentence with resilient on page one.')
    expect(container.textContent).not.toContain('meaning')
    expect(container.querySelector('time')?.getAttribute('datetime'))
      .toBe('2026-02-02T10:00:00.000Z')
  })

  it('reloads the list in the reverse order the reader chooses', async () => {
    await act(async () => render(<WordListPanel openWord={null} onOpenWord={onOpenWord} />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('resilient'))

    const order = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Word list order"]'
    )!
    await act(async () => {
      order.value = 'oldest'
      order.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await vi.waitFor(() => expect(listWordsMock).toHaveBeenCalledWith({
      search: '',
      direction: 'oldest',
      limit: 25
    }))
  })

  it('shows the newest sentence and reveals earlier ones on request', async () => {
    listWordsMock.mockResolvedValue({
      items: [
        createSavedWord('resilient', '2026-02-02T10:00:00.000Z', [
          createOccurrence('resilient', '2026-02-02T10:00:00.000Z', 'two'),
          createOccurrence('resilient', '2026-02-01T10:00:00.000Z', 'one')
        ])
      ],
      nextCursor: null
    })

    await act(async () => render(<WordListPanel openWord={null} onOpenWord={onOpenWord} />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('page two'))
    expect(container.textContent).not.toContain('page one')

    const toggle = container.querySelector<HTMLButtonElement>('.word-list-toggle')!
    expect(toggle.textContent).toBe('Show 1 earlier sentence')
    await act(async () => toggle.click())

    expect(container.textContent).toContain('page one')
    expect([...container.querySelectorAll('.word-list-occurrence a')]
      .map((link) => link.getAttribute('href')))
      .toEqual(['https://example.com/two', 'https://example.com/one'])
  })

  it('removes a word from the list and the database', async () => {
    await act(async () => render(<WordListPanel openWord={null} onOpenWord={onOpenWord} />, container))
    await vi.waitFor(() => expect(container.textContent).toContain('resilient'))

    const remove = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove resilient"]'
    )!
    await act(async () => remove.click())

    await vi.waitFor(() => expect(container.textContent).not.toContain('resilient'))
    expect(removeWordMock).toHaveBeenCalledWith('resilient-id')
    expect(container.textContent).toContain('1 word saved on this device.')
  })

  it('reports a database failure instead of showing an empty list', async () => {
    listWordsMock.mockRejectedValue(new Error('The database is unavailable.'))

    await act(async () => render(<WordListPanel openWord={null} onOpenWord={onOpenWord} />, container))

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent)
        .toBe('The database is unavailable.')
    })
  })
  it('opens the dictionary for the word the reader clicks', async () => {
    await act(async () => render(
      <WordListPanel openWord={null} onOpenWord={onOpenWord} />, container
    ))
    await vi.waitFor(() => expect(container.textContent).toContain('resilient'))

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Look up resilient"]'
      )!.click()
    })

    expect(onOpenWord).toHaveBeenCalledWith('resilient')
  })

  it('closes the entry when the open word is clicked again', async () => {
    await act(async () => render(
      <WordListPanel openWord="resilient" onOpenWord={onOpenWord} />, container
    ))
    await vi.waitFor(() => expect(container.textContent).toContain('resilient'))

    const open = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Look up resilient"]'
    )!
    expect(open.getAttribute('aria-pressed')).toBe('true')
    await act(async () => open.click())

    expect(onOpenWord).toHaveBeenCalledWith(null)
  })

  it('closes the entry of a word it removes', async () => {
    await act(async () => render(
      <WordListPanel openWord="resilient" onOpenWord={onOpenWord} />, container
    ))
    await vi.waitFor(() => expect(container.textContent).toContain('resilient'))

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Remove resilient"]'
      )!.click()
    })

    await vi.waitFor(() => expect(onOpenWord).toHaveBeenCalledWith(null))
  })
})
