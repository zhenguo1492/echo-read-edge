/**
 * Promise adapters for the event-based IndexedDB API. Awaiting these settles in
 * a microtask, so a transaction stays active across sequential awaits and every
 * repository can express one multi-step operation as ordinary async code.
 */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

export function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(
      transaction.error ?? new Error('IndexedDB transaction failed.')
    )
    transaction.onabort = () => reject(
      transaction.error ?? new Error('IndexedDB transaction was aborted.')
    )
  })
}

/**
 * Walks a cursor one record at a time so callers can stop early instead of
 * materializing every matching record. Returning false ends the walk.
 */
export async function forEachCursor<T>(
  request: IDBRequest<IDBCursorWithValue | null>,
  visit: (value: T, cursor: IDBCursorWithValue) => boolean | void
): Promise<void> {
  let cursor = await requestResult(request)
  while (cursor) {
    if (visit(cursor.value as T, cursor) === false) return
    cursor.continue()
    cursor = await requestResult(request)
  }
}
