import type { JSX } from 'preact'

import type { KokoroHealthStatus } from '@/shared/messages'

/**
 * `unknown` covers the moment before the first probe answers, and `checking`
 * the wait for one. Both are neutral: an unchecked server is not a broken one.
 */
export type KokoroHealthState = 'unknown' | 'checking' | KokoroHealthStatus

export interface KokoroHealthIndicatorProps {
  state: KokoroHealthState
  message: string
  onCheck: () => void
}

/**
 * Reports next to the address field whether that address can serve a reading.
 * A green check means the server answered as a Kokoro API; a red exclamation
 * covers both a host nothing answers on and one that answers without the
 * Kokoro API, because the repair is the same and the message says which it was.
 *
 * It is a button rather than a static icon so a reader who has just started
 * their server can ask again without retyping an address that never changed.
 */
export function KokoroHealthIndicator({
  state,
  message,
  onCheck
}: KokoroHealthIndicatorProps): JSX.Element {
  const label = `Kokoro server: ${message} Check again.`

  return (
    <button
      type="button"
      class={`connection-status is-${state}`}
      title={label}
      aria-label={label}
      aria-live="polite"
      disabled={state === 'checking'}
      onClick={onCheck}
    >
      {renderIcon(state)}
    </button>
  )
}

function renderIcon(state: KokoroHealthState): JSX.Element {
  if (state === 'ok') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.4" />
        <path d="M5.1 8.2 7 10.1 10.9 6.1" />
      </svg>
    )
  }

  if (state === 'checking') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.4" stroke-dasharray="26 14" />
      </svg>
    )
  }

  if (state === 'unknown') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.4" stroke-dasharray="2 3" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" />
      <path d="M8 4.6v4" />
      <path d="M8 11.1v.4" />
    </svg>
  )
}
