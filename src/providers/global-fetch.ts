/**
 * Resolves the fetch a Provider should use, keeping the injectable seam that
 * tests rely on.
 *
 * The binding is not cosmetic. Chrome brand-checks fetch's receiver, so storing
 * the bare global on an instance field and calling `this.fetchImplementation(…)`
 * raises `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`
 * inside the extension. Node and happy-dom do not brand-check, so that failure
 * is invisible to every test that injects its own fetch — which is all of them.
 * Binding once at construction removes the trap without changing the seam.
 */
export function resolveFetch(injected?: typeof fetch): typeof fetch {
  return injected ?? globalThis.fetch.bind(globalThis)
}
