import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import { useAnchoredPanelPosition } from '@/content/modules/anchored-panel-position'
import {
  includesPersistentControls,
  observeOutsidePress
} from '@/content/modules/outside-press'

interface AnchoredPanelProps {
  anchorRange: Range
  avoidanceRange?: Range
  ariaLabel: string
  class?: string
  children: ComponentChildren
  onClose(): void
}

/** Shared selection-panel shell with one measured placement and arrow system. */
export function AnchoredPanel(props: AnchoredPanelProps): JSX.Element {
  const [panelElement, setPanelElement] = useState<HTMLElement | null>(null)
  const position = useAnchoredPanelPosition(
    props.anchorRange,
    panelElement,
    props.avoidanceRange
  )

  // A press on the page dismisses the panel, but the reading controls own the
  // panels they open: the press that opens their language menu must leave the
  // translation it is about to change on screen. Watching starts a tick late so
  // the press that opened the panel is not the press that closes it.
  useEffect(() => {
    if (!panelElement) return

    let stopWatchingPresses: (() => void) | null = null
    const timer = window.setTimeout(() => {
      stopWatchingPresses = observeOutsidePress(
        panelElement,
        (path) => path.includes(panelElement) || includesPersistentControls(path),
        () => props.onClose()
      )
    }, 0)

    return () => {
      window.clearTimeout(timer)
      stopWatchingPresses?.()
    }
  }, [panelElement, props.onClose])

  return (
    <section
      ref={setPanelElement}
      class={`echo-read-edge-panel echo-read-edge-anchored-panel${props.class ? ` ${props.class}` : ''}`}
      role="dialog"
      aria-label={props.ariaLabel}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        maxHeight: `${position.maxHeight}px`
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <PanelArrow showAbove={position.showAbove} arrowLeft={position.arrowLeft} />
      {props.children}
    </section>
  )
}

function PanelArrow(props: { showAbove: boolean; arrowLeft: number }): JSX.Element {
  const side = props.showAbove ? 'is-above' : 'is-below'
  return (
    <span class="echo-read-edge-panel-arrow echo-read-edge-dictionary-arrow" aria-hidden="true">
      <span
        class={`echo-read-edge-panel-arrow-border echo-read-edge-dictionary-arrow-border ${side}`}
        style={{ left: `${props.arrowLeft - 9}px` }}
      />
      <span
        class={`echo-read-edge-panel-arrow-fill echo-read-edge-dictionary-arrow-fill ${side}`}
        style={{ left: `${props.arrowLeft - 8}px` }}
      />
      <span
        class={`echo-read-edge-panel-arrow-cover echo-read-edge-dictionary-arrow-cover ${side}`}
        style={{ left: `${props.arrowLeft - 8}px` }}
      />
    </span>
  )
}
