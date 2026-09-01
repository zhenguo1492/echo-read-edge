import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getInterfaceSettingsMock } = vi.hoisted(() => ({
  getInterfaceSettingsMock: vi.fn()
}))

vi.mock('@/storage', () => ({
  DEFAULT_FLOATING_CONTROLLER_VISIBLE: true,
  FLOATING_CONTROLLER_KEY: 'showFloatingController',
  settingsRepository: { getInterfaceSettings: getInterfaceSettingsMock }
}))

import {
  destroyInterfaceSettings,
  floatingControllerVisible,
  initializeInterfaceSettings
} from './interface-settings'

type StorageChanges = Record<string, { newValue?: unknown; oldValue?: unknown }>
type ChangeListener = (changes: StorageChanges, areaName: string) => void

let listeners: ChangeListener[]

describe('interface-settings', () => {
  beforeEach(() => {
    listeners = []
    getInterfaceSettingsMock.mockReset().mockResolvedValue({
      floatingControllerVisible: true
    })
    vi.stubGlobal('chrome', {
      storage: {
        onChanged: {
          addListener: (listener: ChangeListener) => listeners.push(listener),
          removeListener: (listener: ChangeListener) => {
            listeners = listeners.filter((entry) => entry !== listener)
          }
        }
      }
    })
    floatingControllerVisible.value = true
  })

  afterEach(() => {
    destroyInterfaceSettings()
    vi.unstubAllGlobals()
  })

  it('loads the stored visibility once', async () => {
    getInterfaceSettingsMock.mockResolvedValue({ floatingControllerVisible: false })

    initializeInterfaceSettings()
    await vi.waitFor(() => expect(floatingControllerVisible.value).toBe(false))

    expect(getInterfaceSettingsMock).toHaveBeenCalledTimes(1)
  })

  it('follows a later popup change without a page reload', async () => {
    initializeInterfaceSettings()
    await vi.waitFor(() => expect(listeners).toHaveLength(1))

    listeners[0]({ showFloatingController: { newValue: false } }, 'local')
    expect(floatingControllerVisible.value).toBe(false)

    listeners[0]({ showFloatingController: { newValue: true } }, 'local')
    expect(floatingControllerVisible.value).toBe(true)
  })

  it('ignores unrelated keys, other areas, and non-boolean values', async () => {
    initializeInterfaceSettings()
    await vi.waitFor(() => expect(listeners).toHaveLength(1))

    listeners[0]({ speed: { newValue: 1.5 } }, 'local')
    expect(floatingControllerVisible.value).toBe(true)

    listeners[0]({ showFloatingController: { newValue: false } }, 'sync')
    expect(floatingControllerVisible.value).toBe(true)

    listeners[0]({ showFloatingController: { newValue: 'no' } }, 'local')
    expect(floatingControllerVisible.value).toBe(true)
  })

  it('keeps the default visible when the stored value cannot be read', async () => {
    getInterfaceSettingsMock.mockRejectedValue(new Error('storage unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    initializeInterfaceSettings()
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())

    expect(floatingControllerVisible.value).toBe(true)
    consoleError.mockRestore()
  })

  it('stops following storage after teardown', async () => {
    initializeInterfaceSettings()
    await vi.waitFor(() => expect(listeners).toHaveLength(1))

    destroyInterfaceSettings()

    // Chrome delivers changes only to registered listeners, so an emptied
    // registry is what proves the page stopped following storage.
    expect(listeners).toHaveLength(0)
    for (const listener of listeners) {
      listener({ showFloatingController: { newValue: false } }, 'local')
    }
    expect(floatingControllerVisible.value).toBe(true)
  })

  it('replaces an existing subscription instead of stacking one', async () => {
    initializeInterfaceSettings()
    await vi.waitFor(() => expect(listeners).toHaveLength(1))

    initializeInterfaceSettings()
    await vi.waitFor(() => expect(getInterfaceSettingsMock).toHaveBeenCalledTimes(2))

    expect(listeners).toHaveLength(1)
  })
})
