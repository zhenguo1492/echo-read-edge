import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TtsCommandResponse } from '@/shared/messages'

type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: TtsCommandResponse) => void
) => boolean

const EXTENSION_ID = 'echo-read-edge-test'
const OWNER_TAB_ID = 7

const sendMessageMock = vi.fn<(message: unknown) => Promise<TtsCommandResponse>>()
let runtimeListener: RuntimeListener | undefined

/**
 * A fresh module instance is a restarted service worker: Chrome keeps the
 * hidden audio document alive across that restart, but every playback record
 * the worker held in memory is gone.
 */
async function restartServiceWorker(): Promise<void> {
  runtimeListener = undefined
  vi.resetModules()
  await import('./index')
  if (!runtimeListener) throw new Error('The background message listener was not registered.')
}

function dispatch(message: unknown, tabId?: number): Promise<TtsCommandResponse> {
  return new Promise((resolve, reject) => {
    const sender = {
      id: EXTENSION_ID,
      ...(tabId === undefined ? {} : { tab: { id: tabId } })
    } as chrome.runtime.MessageSender
    const keepsChannelOpen = runtimeListener?.(message, sender, resolve)
    if (!keepsChannelOpen) reject(new Error('The request was not routed asynchronously.'))
  })
}

beforeEach(() => {
  sendMessageMock.mockReset()
  vi.stubGlobal('chrome', {
    runtime: {
      id: EXTENSION_ID,
      sendMessage: sendMessageMock,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}${path}`,
      getManifest: () => ({ version: '0.0.0-test' }),
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListener = listener
        })
      }
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }
    },
    tabs: {
      sendMessage: vi.fn(),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() }
    },
    offscreen: {
      Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' },
      createDocument: vi.fn(),
      hasDocument: vi.fn(async () => true)
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('background dictionary routing', () => {
  it('answers a lookup no source ever completes instead of holding the port', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
      await restartServiceWorker()

      const response = dispatch({ action: 'dictionary:lookup', word: 'read' })
      await vi.advanceTimersByTimeAsync(30_000)

      await expect(response).resolves.toMatchObject({ ok: false, code: 'unavailable' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('background playback routing', () => {
  it('forwards teardown for a session the restarted worker no longer records', async () => {
    sendMessageMock.mockResolvedValueOnce({
      ok: true,
      playbackId: 'orphan-session',
      state: 'stopped',
      sentenceIndex: 0
    })
    await restartServiceWorker()

    const response = await dispatch(
      { action: 'tts:dispose', playbackId: 'orphan-session' },
      OWNER_TAB_ID
    )

    // Only the hidden document knows whether it is still speaking this ID, so
    // the worker's own forgotten ownership may not answer for it.
    expect(sendMessageMock).toHaveBeenCalledWith({
      target: 'offscreen',
      action: 'offscreen:tts:dispose',
      playbackId: 'orphan-session'
    })
    expect(response.ok).toBe(true)
  })

  it('refuses a resumable control for a session it no longer records', async () => {
    await restartServiceWorker()

    const response = await dispatch(
      { action: 'tts:pause', playbackId: 'orphan-session' },
      OWNER_TAB_ID
    )

    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'The requested playback session is no longer active.'
      }
    })
  })

  it('reports a teardown the hidden document can no longer receive', async () => {
    sendMessageMock.mockRejectedValueOnce(new Error('Receiving end does not exist.'))
    await restartServiceWorker()

    const response = await dispatch(
      { action: 'tts:dispose', playbackId: 'orphan-session' },
      OWNER_TAB_ID
    )

    expect(sendMessageMock).toHaveBeenCalledWith({
      target: 'offscreen',
      action: 'offscreen:tts:dispose',
      playbackId: 'orphan-session'
    })
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'runtime-unavailable',
        message: 'Receiving end does not exist.'
      }
    })
  })
})
