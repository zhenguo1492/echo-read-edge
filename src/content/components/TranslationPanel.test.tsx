import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TranslationPanel } from './TranslationPanel'
import { hoveredSentenceIndex } from '@/content/modules/click-to-listen'
import { translationTargetLanguage } from '@/content/modules/translation-settings'

const { clearHighlightsMock, renderHighlightsMock } = vi.hoisted(() => ({
  clearHighlightsMock: vi.fn(),
  renderHighlightsMock: vi.fn()
}))

vi.mock('@/content/modules/highlight-overlay', () => ({
  initializeHighlightOverlay: vi.fn(async () => ({
    clearHighlights: clearHighlightsMock,
    renderHighlights: renderHighlightsMock
  }))
}))

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  translationTargetLanguage.value = 'zh-CN'
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, translation: 'Translated.' })
    }
  })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  hoveredSentenceIndex.value = null
  act(() => render(null, container))
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearHighlightsMock.mockReset()
  renderHighlightsMock.mockReset()
  translationTargetLanguage.value = 'zh-CN'
})

describe('TranslationPanel', () => {
  it('moves outside the active sentence and focuses that sentence final word', async () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'First sentence. The final focus.'
    document.body.append(paragraph)
    const text = paragraph.firstChild!
    const first = document.createRange()
    first.setStart(text, 0)
    first.setEnd(text, 15)
    const second = document.createRange()
    second.setStart(text, 16)
    second.setEnd(text, paragraph.textContent.length)
    const measuredRanges: string[] = []
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
      const textValue = this.toString()
      measuredRanges.push(textValue)
      if (textValue === 'First sentence.') return new DOMRect(100, 80, 300, 40)
      if (textValue === 'sentence') return new DOMRect(300, 100, 60, 20)
      if (textValue === 'The final focus.') return new DOMRect(100, 600, 300, 40)
      return new DOMRect(300, 620, 50, 20)
    })

    await act(async () => {
      render(
        <TranslationPanel
          items={[
            { text: 'First sentence.', range: first },
            { text: 'The final focus.', range: second }
          ]}
          activeIndex={0}
          onClose={vi.fn()}
          onActivateSentence={vi.fn()}
        />,
        container
      )
    })

    const panel = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(panel?.classList.contains('echo-read-edge-anchored-panel')).toBe(true)
    expect(panel?.classList.contains('echo-read-edge-translation-panel')).toBe(true)
    expect(container.querySelectorAll('.echo-read-edge-panel-arrow > span')).toHaveLength(3)
    expect(container.querySelector('.echo-read-edge-panel-arrow-border.is-below')).not.toBeNull()
    expect(panel?.style.top).toBe('130px')
    expect(measuredRanges).toContain('sentence')

    await act(async () => {
      render(
        <TranslationPanel
          items={[
            { text: 'First sentence.', range: first },
            { text: 'The final focus.', range: second }
          ]}
          activeIndex={1}
          onClose={vi.fn()}
          onActivateSentence={vi.fn()}
        />,
        container
      )
    })

    await vi.waitFor(() => expect(panel?.style.top).toBe('50px'))
    expect(container.querySelector('.echo-read-edge-panel-arrow-border.is-above')).not.toBeNull()
    expect(measuredRanges).toContain('focus')
    paragraph.remove()
  })

  it('maps translation hover and click to the corresponding source sentence', async () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'Source sentence.'
    document.body.append(paragraph)
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(400, 100, 50, 20)
    )
    const onActivateSentence = vi.fn()

    await act(async () => {
      render(
        <TranslationPanel
          items={[{ text: 'Source sentence.', range }]}
          activeIndex={0}
          onClose={vi.fn()}
          onActivateSentence={onActivateSentence}
        />,
        container
      )
    })

    const line = container.querySelector<HTMLButtonElement>(
      '.echo-read-edge-translation-line'
    )
    expect(line?.disabled).toBe(false)

    act(() => {
      line?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    })
    expect(hoveredSentenceIndex.value).toBe(0)
    await vi.waitFor(() => {
      expect(renderHighlightsMock).toHaveBeenCalledWith([range], 'hover')
    })

    act(() => {
      line?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      line?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    })
    expect(onActivateSentence).toHaveBeenCalledWith(0)
    await vi.waitFor(() => {
      expect(clearHighlightsMock).toHaveBeenCalledWith('hover')
    })
    paragraph.remove()
  })

  it('requests the configured translation target for each sentence', async () => {
    translationTargetLanguage.value = 'ja'
    const range = anchoredRange('A configured sentence.')

    await act(async () => {
      render(
        <TranslationPanel
          items={[{ text: 'A configured sentence.', range }]}
          activeIndex={0}
          onClose={vi.fn()}
          onActivateSentence={vi.fn()}
        />,
        container
      )
    })

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'translate:text',
        text: 'A configured sentence.',
        sourceLanguage: 'auto',
        targetLanguage: 'ja'
      })
    })
    ;(range.startContainer as HTMLElement).remove()
  })

  it('avoids translating a selection into the language it is already written in', async () => {
    const range = anchoredRange('这是一句中文。')

    await act(async () => {
      render(
        <TranslationPanel
          items={[{ text: '这是一句中文。', range }]}
          activeIndex={0}
          onClose={vi.fn()}
          onActivateSentence={vi.fn()}
        />,
        container
      )
    })

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ targetLanguage: 'en' })
      )
    })
    ;(range.startContainer as HTMLElement).remove()
  })

  it('retranslates the open panel when the reader switches language', async () => {
    const range = anchoredRange('An unread sentence.')

    await act(async () => {
      render(
        <TranslationPanel
          items={[{ text: 'An unread sentence.', range }]}
          activeIndex={0}
          onClose={vi.fn()}
          onActivateSentence={vi.fn()}
        />,
        container
      )
    })

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ targetLanguage: 'zh-CN' })
      )
    })

    await act(async () => {
      translationTargetLanguage.value = 'fr'
    })

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ targetLanguage: 'fr' })
      )
    })
    ;(range.startContainer as HTMLElement).remove()
  })

  /**
   * The reading controls own this panel: pressing their language control opened
   * a menu that dismissed the very translation it was about to change, so the
   * reader's choice reached nothing on screen.
   */
  it('survives a press on the reading controls and retranslates in place', async () => {
    const range = anchoredRange('A sentence the controls retranslate.')
    const onClose = vi.fn()
    const controls = document.createElement('div')
    controls.setAttribute('data-persistent-controls', '')
    document.body.append(controls)

    await act(async () => {
      render(
        <TranslationPanel
          items={[{ text: 'A sentence the controls retranslate.', range }]}
          activeIndex={0}
          onClose={onClose}
          onActivateSentence={vi.fn()}
        />,
        container
      )
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
    })

    act(() => {
      controls.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
    })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      translationTargetLanguage.value = 'fr'
    })
    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ targetLanguage: 'fr' })
      )
    })

    controls.remove()
    ;(range.startContainer as HTMLElement).remove()
  })

  it('closes on a press that lands on the page', async () => {
    const range = anchoredRange('A sentence a page press dismisses.')
    const onClose = vi.fn()

    await act(async () => {
      render(
        <TranslationPanel
          items={[{ text: 'A sentence a page press dismisses.', range }]}
          activeIndex={0}
          onClose={onClose}
          onActivateSentence={vi.fn()}
        />,
        container
      )
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
    })

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    ;(range.startContainer as HTMLElement).remove()
  })

  it('highlights the translated line hovered from its source sentence', async () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'First. Second.'
    document.body.append(paragraph)
    const text = paragraph.firstChild!
    const first = document.createRange()
    first.setStart(text, 0)
    first.setEnd(text, 6)
    const second = document.createRange()
    second.setStart(text, 7)
    second.setEnd(text, 14)
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(400, 100, 50, 20)
    )

    await act(async () => {
      render(
        <TranslationPanel
          items={[
            { text: 'First.', range: first },
            { text: 'Second.', range: second }
          ]}
          activeIndex={0}
          onClose={vi.fn()}
          onActivateSentence={vi.fn()}
        />,
        container
      )
    })

    act(() => {
      hoveredSentenceIndex.value = 1
    })
    const lines = container.querySelectorAll('.echo-read-edge-translation-line')
    expect(lines[0].classList.contains('is-hovered')).toBe(false)
    expect(lines[1].classList.contains('is-hovered')).toBe(true)
    paragraph.remove()
  })
})

function anchoredRange(text: string): Range {
  const paragraph = document.createElement('p')
  paragraph.textContent = text
  document.body.append(paragraph)
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(400, 100, 50, 20)
  )
  return range
}
