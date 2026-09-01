import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectionInfo, SentencePosition } from '@/types'

const {
  pauseReadingMock,
  resumeReadingMock,
  playNextSentenceMock,
  playPreviousSentenceMock
} = vi.hoisted(() => ({
  pauseReadingMock: vi.fn(),
  resumeReadingMock: vi.fn(),
  playNextSentenceMock: vi.fn(),
  playPreviousSentenceMock: vi.fn()
}))

vi.mock('@/content/modules/tts-player', () => ({
  pauseReading: pauseReadingMock,
  resumeReading: resumeReadingMock,
  playNextSentence: playNextSentenceMock,
  playPreviousSentence: playPreviousSentenceMock
}))

import { pageSelection } from '@/content/modules/page-selection'
import {
  activePlaybackId,
  beginPlayback,
  currentIndex,
  errorMessage,
  isStartingPlayback,
  playState,
  resetPlayback,
  setSentences
} from '@/lib/store/playback-store'

import { translationTargetLanguage } from '@/content/modules/translation-settings'
import { pageReadingLanguage } from '@/content/modules/page-language'

import { FloatingController } from './FloatingController'

const PANEL_WIDTH = 44
const PANEL_HEIGHT = 160

let container: HTMLDivElement

function makeQueue(count: number): SentencePosition[] {
  return Array.from({ length: count }, (_, index) => ({
    start: index * 10,
    end: index * 10 + 9,
    text: `Sentence ${index}.`
  }))
}

function startSession(sentenceCount: number, sentenceIndex = 0): void {
  setSentences(makeQueue(sentenceCount))
  beginPlayback('controller-session', [], sentenceIndex)
}

function selectText(text = 'Read this selection.'): SelectionInfo {
  const selection: SelectionInfo = {
    text,
    range: document.createRange(),
    rects: [new DOMRect(100, 100, 120, 20)],
    sentences: [{ start: 0, end: text.length, text }]
  }
  pageSelection.value = selection
  return selection
}

function mount(
  props: Partial<{
    onPlaySelection(): Promise<void> | void
    onStop(): Promise<void> | void
    onTranslate(): void
    translationActive: boolean
  }> = {}
): void {
  act(() =>
    render(
      <FloatingController
        onPlaySelection={props.onPlaySelection ?? (() => undefined)}
        onStop={props.onStop ?? (() => undefined)}
        onTranslate={props.onTranslate ?? (() => undefined)}
        translationActive={props.translationActive ?? false}
      />,
      container
    )
  )
}

/**
 * Matches on the start of the label so a control that appends live state - the
 * handle now names the reading language - is still addressed by its action.
 */
function button(label: string): HTMLButtonElement {
  const element = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button')
  ).find((candidate) =>
    (candidate.getAttribute('aria-label') ?? '').startsWith(label)
  )
  if (!element) throw new Error(`Missing control: ${label}`)
  return element
}

function panelElement(): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[role="toolbar"]')
  if (!panel) throw new Error('Missing controller panel')
  panel.getBoundingClientRect = () =>
    new DOMRect(960, 300, PANEL_WIDTH, PANEL_HEIGHT)
  return panel
}

function ringOffset(): number {
  return Number(
    container
      .querySelector('.echo-read-edge-controller-ring-value')
      ?.getAttribute('stroke-dashoffset')
  )
}

function press(target: HTMLElement, clientX: number, clientY: number): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX, clientY })
    )
  })
}

function move(clientX: number, clientY: number): void {
  act(() => {
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX, clientY })
    )
  })
}

function release(): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}

function click(label: string): void {
  act(() => {
    button(label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('FloatingController', () => {
  beforeEach(() => {
    pauseReadingMock.mockReset().mockResolvedValue(true)
    resumeReadingMock.mockReset().mockResolvedValue(true)
    playNextSentenceMock.mockReset().mockResolvedValue(true)
    playPreviousSentenceMock.mockReset().mockResolvedValue(true)
    resetPlayback()
    errorMessage.value = null
    pageSelection.value = null
    translationTargetLanguage.value = 'zh-CN'
    pageReadingLanguage.value = null

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    // happy-dom reports zero-sized boxes, so the drag clamp needs real extents.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      value: PANEL_WIDTH
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: PANEL_HEIGHT
    })

    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => render(null, container))
    container.remove()
    resetPlayback()
    errorMessage.value = null
    pageSelection.value = null
    pageReadingLanguage.value = null
  })

  describe('reading language badge', () => {
    function badge(): HTMLElement {
      const element = container.querySelector<HTMLElement>(
        '.echo-read-edge-controller-badge'
      )
      if (!element) throw new Error('Missing reading language badge')
      return element
    }

    it('marks the handle with the language detected on the page', () => {
      pageReadingLanguage.value = 'ja'
      mount()

      expect(badge().textContent).toBe('JP')
      expect(button('Collapse reading controls').title).toContain('Japanese')
    })

    it('follows a page whose language is detected after the panel mounts', () => {
      mount()
      expect(badge().textContent).toBe('EN')

      act(() => {
        pageReadingLanguage.value = 'zh'
      })

      expect(badge().textContent).toBe('CN')
    })

    it('names the voice that reads a page whose language went undetected', () => {
      mount()

      expect(badge().textContent).toBe('EN')
      expect(button('Collapse reading controls').title).toContain('not detected')
    })

    it('keeps naming its action so the handle still collapses the panel', () => {
      pageReadingLanguage.value = 'ja'
      mount()

      click('Collapse reading controls')

      expect(button('Expand reading controls').getAttribute('aria-expanded')).toBe(
        'false'
      )
    })
  })

  it('stays on screen with every control disabled before a session starts', () => {
    mount()

    expect(container.querySelector('[role="toolbar"]')).not.toBeNull()
    for (const label of [
      'Play reading',
      'Previous sentence',
      'Next sentence',
      'Translate reading selection',
      'Stop reading'
    ]) {
      expect(button(label).disabled).toBe(true)
    }
    expect(button('Play reading').title).toBe('Select text to start reading')
  })

  it('keeps controls disabled when a playback id has an empty queue', () => {
    activePlaybackId.value = 'controller-session'
    mount()

    expect(button('Play reading').disabled).toBe(true)
    expect(button('Stop reading').disabled).toBe(true)
  })

  it('enables every control once a session owns a queue', () => {
    startSession(3, 1)
    mount()

    for (const label of [
      'Pause reading',
      'Previous sentence',
      'Next sentence',
      'Translate reading selection',
      'Stop reading'
    ]) {
      expect(button(label).disabled).toBe(false)
    }
  })

  it('enables play and translate as soon as the page holds selected text', () => {
    selectText()
    mount()

    expect(button('Play reading').disabled).toBe(false)
    expect(button('Play reading').title).toBe('Read selected text')
    expect(button('Translate reading selection').disabled).toBe(false)
    for (const label of ['Previous sentence', 'Next sentence', 'Stop reading']) {
      expect(button(label).disabled).toBe(true)
    }
  })

  it('reads the page selection when play is pressed without a queue', () => {
    const onPlaySelection = vi.fn()
    selectText()
    mount({ onPlaySelection })

    click('Play reading')
    expect(onPlaySelection).toHaveBeenCalledTimes(1)
    expect(resumeReadingMock).not.toHaveBeenCalled()
  })

  /**
   * Selecting new text while a queue plays is a request to read that text, so
   * the transport offers the new selection rather than pausing the old queue.
   */
  it('reads a new selection instead of the queue it interrupts', () => {
    const onPlaySelection = vi.fn()
    startSession(3)
    selectText()
    mount({ onPlaySelection })

    expect(button('Play reading').title).toBe('Read selected text')
    click('Play reading')
    expect(onPlaySelection).toHaveBeenCalledTimes(1)
    expect(pauseReadingMock).not.toHaveBeenCalled()
  })

  it('waits with a loading control while the engine starts the queue', () => {
    selectText()
    isStartingPlayback.value = true
    mount()

    const play = button('Starting reading')
    expect(play.disabled).toBe(true)
    expect(play.title).toBe('Starting playback')
    expect(play.querySelector('.echo-read-edge-controller-spinner')).not.toBeNull()
    // Cancelling a slow synthesis is the only control the wait leaves useful.
    expect(button('Stop reading').disabled).toBe(false)
  })

  it('keeps loading after the selection it started from is consumed', () => {
    isStartingPlayback.value = true
    mount()

    expect(button('Starting reading').disabled).toBe(true)
    click('Collapse reading controls')
    expect(button('Starting reading').disabled).toBe(true)
  })

  it('enables the collapsed speaker for selected text', () => {
    selectText()
    mount()

    click('Collapse reading controls')
    expect(button('Play reading').disabled).toBe(false)
  })

  /**
   * Pressing a control must not collapse the page selection the control is
   * about to act on, so every press keeps the browser default suppressed.
   */
  it('preserves the page selection while a control is pressed', () => {
    selectText()
    mount()

    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 980,
      clientY: 320
    })
    act(() => {
      button('Play reading').dispatchEvent(mouseDown)
    })
    expect(mouseDown.defaultPrevented).toBe(true)
  })

  it('pauses while playing', () => {
    startSession(3)
    mount()

    expect(button('Pause reading').title).toBe('Pause')
    click('Pause reading')

    expect(pauseReadingMock).toHaveBeenCalledTimes(1)
    expect(resumeReadingMock).not.toHaveBeenCalled()
  })

  it('resumes while paused', () => {
    startSession(3)
    act(() => {
      playState.value = 'paused'
    })
    mount()

    click('Play reading')

    expect(resumeReadingMock).toHaveBeenCalledTimes(1)
    expect(pauseReadingMock).not.toHaveBeenCalled()
  })

  it('replays through resume when the session is retained but idle', () => {
    startSession(3, 1)
    act(() => {
      playState.value = 'idle'
    })
    mount()

    const play = button('Play reading')
    expect(play.disabled).toBe(false)
    click('Play reading')

    expect(resumeReadingMock).toHaveBeenCalledTimes(1)
  })

  it('disables previous on the first sentence and steps back elsewhere', () => {
    startSession(3)
    mount()
    expect(button('Previous sentence').disabled).toBe(true)

    act(() => {
      currentIndex.value = 1
    })
    click('Previous sentence')

    expect(playPreviousSentenceMock).toHaveBeenCalledTimes(1)
  })

  it('disables next on the last sentence and steps forward elsewhere', () => {
    startSession(3, 2)
    mount()
    expect(button('Next sentence').disabled).toBe(true)

    act(() => {
      currentIndex.value = 0
    })
    click('Next sentence')

    expect(playNextSentenceMock).toHaveBeenCalledTimes(1)
  })

  it('blocks a second stop until the first one settles', async () => {
    let releaseStop: (() => void) | undefined
    const onStop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve
        })
    )
    startSession(2)
    mount({ onStop })

    click('Stop reading')
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(button('Stop reading').disabled).toBe(true)

    click('Stop reading')
    expect(onStop).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseStop?.()
      await Promise.resolve()
    })
    expect(button('Stop reading').disabled).toBe(false)
  })

  it('reports the translation state and forwards the request', () => {
    const onTranslate = vi.fn()
    startSession(2)
    mount({ onTranslate, translationActive: true })

    expect(button('Translate reading selection').getAttribute('aria-pressed')).toBe(
      'true'
    )
    click('Translate reading selection')

    expect(onTranslate).toHaveBeenCalledTimes(1)
  })

  it('keeps stop between the sentence steps', () => {
    startSession(3, 1)
    mount()

    const nav = container.querySelector('.echo-read-edge-controller-nav')
    expect(nav).not.toBeNull()
    expect(
      Array.from(nav!.querySelectorAll('button')).map((control) =>
        control.getAttribute('aria-label')
      )
    ).toEqual(['Previous sentence', 'Stop reading', 'Next sentence'])
  })

  it('hangs the language control under the translate button', () => {
    translationTargetLanguage.value = 'ja'
    mount()

    const control = button('Translation language: Japanese · 日本語')
    expect(control.disabled).toBe(false)
    expect(control.getAttribute('aria-expanded')).toBe('false')
    expect(control.previousElementSibling?.getAttribute('aria-label')).toBe(
      'Translate reading selection'
    )
  })

  it('stores the language chosen from the menu and closes the list', async () => {
    mount()

    click('Translation language: Chinese (Simplified) · 简体中文')
    expect(button('Translation language: Chinese (Simplified) · 简体中文')
      .getAttribute('aria-expanded')).toBe('true')
    const option = container.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][data-language="zh-CN"]'
    )
    expect(option?.getAttribute('aria-checked')).toBe('true')

    click('French · Français')

    expect(translationTargetLanguage.value).toBe('fr')
    await vi.waitFor(() => {
      expect(container.querySelector('[role="menu"]')).toBeNull()
    })
  })

  it('closes the language menu on a press outside the panel', () => {
    mount()

    click('Translation language: Chinese (Simplified) · 简体中文')
    expect(container.querySelector('[role="menu"]')).not.toBeNull()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  /**
   * The controller is mounted in a closed shadow root, where the document sees
   * every press inside the extension only as the host. Judging those as outside
   * presses closed the menu on the press that chose a language, so the click
   * never reached the item and the reader's choice was lost.
   */
  it('keeps the language menu open for a press the document reads as the host', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadowRoot = host.attachShadow({ mode: 'closed' })
    const shadowContainer = document.createElement('div')
    shadowRoot.append(shadowContainer)

    act(() =>
      render(
        <FloatingController
          onPlaySelection={() => undefined}
          onStop={() => undefined}
          onTranslate={() => undefined}
          translationActive={false}
        />,
        shadowContainer
      )
    )
    act(() => {
      shadowContainer
        .querySelector<HTMLButtonElement>('.echo-read-edge-controller-language')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(shadowContainer.querySelector('[role="menu"]')).not.toBeNull()

    act(() => {
      host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    })

    expect(shadowContainer.querySelector('[role="menu"]')).not.toBeNull()
    act(() => {
      shadowContainer
        .querySelector<HTMLButtonElement>('[role="menuitemradio"][data-language="fr"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(translationTargetLanguage.value).toBe('fr')

    act(() => render(null, shadowContainer))
    host.remove()
  })

  it('marks the controller as a surface that owns the panels it opens', () => {
    mount()

    expect(panelElement().hasAttribute('data-persistent-controls')).toBe(true)
  })

  it('closes the language menu on escape', () => {
    mount()

    click('Translation language: Chinese (Simplified) · 简体中文')
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('hides the language menu with the collapsed panel', () => {
    mount()

    click('Translation language: Chinese (Simplified) · 简体中文')
    click('Collapse reading controls')

    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('shrinks the progress ring as the queue advances', () => {
    startSession(4)
    mount()

    const ring = container.querySelector('.echo-read-edge-controller-ring-value')
    const circumference = Number(ring?.getAttribute('stroke-dasharray'))
    expect(circumference).toBeGreaterThan(0)

    const firstOffset = Number(ring?.getAttribute('stroke-dashoffset'))
    act(() => {
      currentIndex.value = 2
    })
    const laterOffset = Number(ring?.getAttribute('stroke-dashoffset'))
    expect(laterOffset).toBeLessThan(firstOffset)

    act(() => {
      currentIndex.value = 3
    })
    expect(Number(ring?.getAttribute('stroke-dashoffset'))).toBe(0)
  })

  it('shows the error ring and clears the error on the next control', () => {
    startSession(3)
    act(() => {
      errorMessage.value = 'Speech synthesis failed.'
    })
    mount()

    const ring = container.querySelector('.echo-read-edge-controller-ring')
    expect(ring?.classList.contains('is-error')).toBe(true)
    expect(Number(
      container
        .querySelector('.echo-read-edge-controller-ring-value')
        ?.getAttribute('stroke-dashoffset')
    )).toBe(0)
    expect(button('Pause reading').title).toBe('Speech synthesis failed.')

    click('Pause reading')

    expect(errorMessage.value).toBeNull()
    expect(pauseReadingMock).toHaveBeenCalledTimes(1)
  })

  it('clears a stale error when the session is stopped', () => {
    startSession(3)
    act(() => {
      errorMessage.value = 'Speech synthesis failed.'
    })
    const onStop = vi.fn()
    mount({ onStop })

    click('Stop reading')

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(errorMessage.value).toBeNull()
    expect(
      container
        .querySelector('.echo-read-edge-controller-ring')
        ?.classList.contains('is-error')
    ).toBe(false)
  })

  it('moves the panel while dragging and stops on mouse up', () => {
    startSession(2)
    mount()
    const panel = panelElement()

    press(panel, 970, 320)
    move(500, 400)

    expect(panel.style.left).toBe('490px')
    expect(panel.style.top).toBe('380px')
    // The stylesheet's right anchor must be released, or a fixed panel with
    // both edges pinned stretches across the viewport instead of moving.
    expect(panel.style.right).toBe('auto')
    expect(panel.style.transform).toBe('none')

    release()
    move(200, 200)

    expect(panel.style.left).toBe('490px')
  })

  it('drags from the grip handle', () => {
    startSession(2)
    mount()
    const panel = panelElement()

    press(button('Collapse reading controls'), 970, 320)
    move(600, 500)

    expect(panel.style.left).toBe('590px')
  })

  it('ignores a press that never travels far enough to be a drag', () => {
    startSession(2)
    mount()
    const panel = panelElement()

    press(button('Collapse reading controls'), 970, 320)
    move(972, 322)

    expect(panel.style.left).toBe('')
  })

  it('does not start a drag from a control button', () => {
    startSession(2)
    mount()
    const panel = panelElement()

    press(button('Next sentence'), 970, 320)
    move(500, 400)

    expect(panel.style.left).toBe('')
  })

  it('collapses to the caret and the speaker, then expands from the caret', () => {
    startSession(2)
    mount()

    click('Collapse reading controls')

    expect(panelElement().classList.contains('is-collapsed')).toBe(true)
    expect(container.querySelectorAll('button')).toHaveLength(2)
    expect(button('Expand reading controls').getAttribute('aria-expanded')).toBe(
      'false'
    )
    expect(button('Pause reading')).toBeDefined()
    expect(
      container.querySelector('button[aria-label="Next sentence"]')
    ).toBeNull()
    expect(container.querySelector('button[aria-label="Stop reading"]')).toBeNull()

    click('Expand reading controls')

    expect(panelElement().classList.contains('is-collapsed')).toBe(false)
    expect(button('Collapse reading controls').getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(button('Next sentence')).toBeDefined()
    expect(button('Stop reading')).toBeDefined()
  })

  it('keeps the collapsed speaker on play and pause', () => {
    startSession(3)
    mount()
    click('Collapse reading controls')

    click('Pause reading')
    expect(pauseReadingMock).toHaveBeenCalledTimes(1)

    act(() => {
      playState.value = 'paused'
    })
    click('Play reading')

    expect(resumeReadingMock).toHaveBeenCalledTimes(1)
    expect(panelElement().classList.contains('is-collapsed')).toBe(true)
  })

  it('disables the collapsed speaker without a session', () => {
    startSession(2)
    mount()
    click('Collapse reading controls')

    act(() => {
      resetPlayback()
    })

    expect(button('Play reading').disabled).toBe(true)
    expect(button('Expand reading controls').disabled).toBe(false)
  })

  it('keeps showing queue progress while collapsed', () => {
    startSession(4, 1)
    mount()
    const expandedOffset = ringOffset()

    click('Collapse reading controls')

    expect(ringOffset()).toBe(expandedOffset)
  })

  it('does not collapse when the grip press was a drag', () => {
    startSession(2)
    mount()
    const panel = panelElement()

    press(button('Collapse reading controls'), 970, 320)
    move(600, 500)
    release()
    act(() => {
      button('Collapse reading controls').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })

    expect(panel.classList.contains('is-collapsed')).toBe(false)
  })

  it('drags from the collapsed caret without expanding', () => {
    startSession(2)
    mount()
    click('Collapse reading controls')
    const panel = panelElement()

    press(button('Expand reading controls'), 970, 320)
    move(600, 500)
    release()
    act(() => {
      button('Expand reading controls').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })

    expect(panel.style.left).toBe('590px')
    expect(panel.classList.contains('is-collapsed')).toBe(true)
  })

  it('does not drag from the collapsed speaker', () => {
    startSession(2)
    mount()
    click('Collapse reading controls')
    const panel = panelElement()

    press(button('Pause reading'), 970, 320)
    move(600, 500)

    expect(panel.style.left).toBe('')
  })

  it('returns to the default anchor after a remount', () => {
    startSession(2)
    mount()

    const panel = container.querySelector<HTMLElement>('[role="toolbar"]')
    if (!panel) throw new Error('Missing controller panel')
    panel.getBoundingClientRect = () => new DOMRect(960, 300, PANEL_WIDTH, PANEL_HEIGHT)
    act(() => {
      panel.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 970, clientY: 320 })
      )
    })
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 400 })
      )
    })
    expect(panel.style.left).toBe('490px')

    act(() => render(null, container))
    mount()

    expect(
      container.querySelector<HTMLElement>('[role="toolbar"]')?.style.left
    ).toBe('')
  })
})
