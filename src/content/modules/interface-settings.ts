import { signal } from '@preact/signals'

import {
  DEFAULT_FLOATING_CONTROLLER_VISIBLE,
  FLOATING_CONTROLLER_KEY,
  settingsRepository
} from '@/storage'

/**
 * Whether the page shows the floating reading controller. The popup owns the
 * switch, so the page both loads the stored value once and follows later
 * changes; without the storage subscription an open tab would keep the old
 * state until it reloaded.
 */
export const floatingControllerVisible = signal(
  DEFAULT_FLOATING_CONTROLLER_VISIBLE
)

type StorageChanges = Record<string, chrome.storage.StorageChange>

let changeListener: ((changes: StorageChanges, areaName: string) => void) | null =
  null

export function initializeInterfaceSettings(): void {
  destroyInterfaceSettings()

  void settingsRepository
    .getInterfaceSettings()
    .then((settings) => {
      floatingControllerVisible.value = settings.floatingControllerVisible
    })
    .catch((error: unknown) => {
      console.error(
        '[EchoRead Edge] Interface settings could not be loaded.',
        error
      )
    })

  const onChanged = chrome?.storage?.onChanged
  if (!onChanged) return

  changeListener = (changes, areaName) => {
    if (areaName !== 'local') return

    const change = changes[FLOATING_CONTROLLER_KEY]
    if (!change) return

    floatingControllerVisible.value =
      typeof change.newValue === 'boolean'
        ? change.newValue
        : DEFAULT_FLOATING_CONTROLLER_VISIBLE
  }
  onChanged.addListener(changeListener)
}

export function destroyInterfaceSettings(): void {
  if (!changeListener) return

  chrome?.storage?.onChanged?.removeListener(changeListener)
  changeListener = null
}
