import { describe, expect, it } from 'vitest'

import { TaskQueue } from './task-queue'

/** Resolves after every already-queued microtask has run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('TaskQueue', () => {
  it('never runs more tasks at once than the configured limit', async () => {
    const queue = new TaskQueue(2)
    const gates = [deferred(), deferred(), deferred(), deferred()]
    let running = 0
    let peak = 0

    const runs = gates.map((gate) => queue.run(async () => {
      running += 1
      peak = Math.max(peak, running)
      await gate.promise
      running -= 1
    }))

    await flush()
    expect(peak).toBe(2)

    gates[0].resolve()
    gates[1].resolve()
    await flush()
    expect(peak).toBe(2)

    gates[2].resolve()
    gates[3].resolve()
    await Promise.all(runs)
    expect(peak).toBe(2)
  })

  it('hands a freed slot to the longest-waiting task', async () => {
    const queue = new TaskQueue(1)
    const first = deferred()
    const order: string[] = []

    const runs = [
      queue.run(async () => {
        order.push('first')
        await first.promise
      }),
      queue.run(async () => { order.push('second') }),
      queue.run(async () => { order.push('third') })
    ]

    await flush()
    expect(order).toEqual(['first'])

    first.resolve()
    await Promise.all(runs)
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('releases the slot when a task rejects', async () => {
    const queue = new TaskQueue(1)
    const failure = queue.run(() => Promise.reject(new Error('boom')))
    await expect(failure).rejects.toThrow('boom')

    await expect(queue.run(() => Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('rejects a limit below one instead of stalling every caller', () => {
    expect(() => new TaskQueue(0)).toThrow(RangeError)
  })
})
