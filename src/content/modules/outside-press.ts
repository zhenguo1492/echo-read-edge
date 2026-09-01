/**
 * Dismissal presses for the content UI's popups.
 *
 * The extension mounts its interface in a closed shadow root, where a document
 * listener's composed path stops at the host: every press inside the extension
 * reads as a press on the page. A menu watching the document would therefore
 * dismiss itself on the press that chose one of its own items, and the item
 * would be gone before the browser could deliver the click.
 *
 * So the press is judged in the tree that can still see it, and the document
 * answers only for presses that never entered that tree.
 */

/** Marks controls that own the popups they open, so their presses never dismiss one. */
export const PERSISTENT_CONTROLS_ATTRIBUTE = 'data-persistent-controls'

/** Reports whether a press travelled through a surface that owns its popups. */
export function includesPersistentControls(path: readonly EventTarget[]): boolean {
  return path.some(
    (target) =>
      target instanceof Element && target.hasAttribute(PERSISTENT_CONTROLS_ATTRIBUTE)
  )
}

/**
 * Calls back on the first press that lands outside the supplied popup, and
 * returns the disposer that stops watching. Presses are read in the capture
 * phase, because page content that stops mousedown propagation would otherwise
 * leave a popup no way to close.
 */
export function observeOutsidePress(
  anchor: Element,
  isInsidePress: (path: readonly EventTarget[]) => boolean,
  onOutsidePress: () => void
): () => void {
  const root = anchor.getRootNode()
  const host = root instanceof ShadowRoot ? root.host : null

  const handlePress = (event: Event): void => {
    const path = event.composedPath()
    if (isInsidePress(path)) return
    // The document sees a press inside the shadow tree only as the host, which
    // says nothing about where it landed; the root listener already judged it.
    if (event.currentTarget === document && host && path.includes(host)) return
    onOutsidePress()
  }

  root.addEventListener('mousedown', handlePress, true)
  if (root !== document) document.addEventListener('mousedown', handlePress, true)

  return () => {
    root.removeEventListener('mousedown', handlePress, true)
    document.removeEventListener('mousedown', handlePress, true)
  }
}
