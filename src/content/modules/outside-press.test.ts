import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PERSISTENT_CONTROLS_ATTRIBUTE,
  includesPersistentControls,
  observeOutsidePress
} from './outside-press'

let stopWatching: (() => void) | null = null

afterEach(() => {
  stopWatching?.()
  stopWatching = null
  document.body.innerHTML = ''
})

function press(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }))
}

describe('observeOutsidePress', () => {
  it('answers a press that lands on the page', () => {
    const anchor = document.createElement('div')
    document.body.append(anchor)
    const onOutsidePress = vi.fn()
    stopWatching = observeOutsidePress(anchor, (path) => path.includes(anchor), onOutsidePress)

    press(document.body)

    expect(onOutsidePress).toHaveBeenCalledTimes(1)
  })

  it('ignores a press inside the anchor', () => {
    const anchor = document.createElement('div')
    const inner = document.createElement('button')
    anchor.append(inner)
    document.body.append(anchor)
    const onOutsidePress = vi.fn()
    stopWatching = observeOutsidePress(anchor, (path) => path.includes(anchor), onOutsidePress)

    press(inner)

    expect(onOutsidePress).not.toHaveBeenCalled()
  })

  /**
   * A document listener sees a press inside a closed shadow root only as the
   * host, so it must leave the verdict to the listener inside that root. This is
   * the case the browser produces and a test environment does not.
   */
  it('ignores a press the document sees only as the closed shadow host', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'closed' })
    const anchor = document.createElement('div')
    root.append(anchor)
    const onOutsidePress = vi.fn()
    stopWatching = observeOutsidePress(anchor, (path) => path.includes(anchor), onOutsidePress)

    press(host)

    expect(onOutsidePress).not.toHaveBeenCalled()
  })

  it('answers a page press for an anchor mounted in a shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'closed' })
    const anchor = document.createElement('div')
    root.append(anchor)
    const onOutsidePress = vi.fn()
    stopWatching = observeOutsidePress(anchor, (path) => path.includes(anchor), onOutsidePress)

    press(document.body)

    expect(onOutsidePress).toHaveBeenCalledTimes(1)
  })

  it('stops answering once disposed', () => {
    const anchor = document.createElement('div')
    document.body.append(anchor)
    const onOutsidePress = vi.fn()
    observeOutsidePress(anchor, (path) => path.includes(anchor), onOutsidePress)()

    press(document.body)

    expect(onOutsidePress).not.toHaveBeenCalled()
  })
})

describe('includesPersistentControls', () => {
  it('recognizes the marked controls anywhere in the press path', () => {
    const controls = document.createElement('div')
    controls.setAttribute(PERSISTENT_CONTROLS_ATTRIBUTE, '')
    const inner = document.createElement('button')
    controls.append(inner)

    expect(includesPersistentControls([inner, controls, document.body])).toBe(true)
    expect(includesPersistentControls([inner, document.body])).toBe(false)
  })
})
