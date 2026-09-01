/**
 * Bounds how many tasks run at once across every caller sharing one instance.
 *
 * The free Google Translate endpoint throttles by source IP, so a panel that
 * fans one request out per sentence trips a 429 for the whole browser. Holding
 * the gate in the service worker keeps that bound shared across all tabs
 * instead of per panel.
 */
export class TaskQueue {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('TaskQueue requires a concurrency limit of at least 1.')
    }
  }

  /** Tasks currently holding a slot. */
  get running(): number {
    return this.active
  }

  /** Tasks admitted but still waiting for a slot. */
  get pending(): number {
    return this.waiting.length
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve)
    })
  }

  /**
   * A freed slot is handed straight to the next waiter rather than released and
   * re-acquired, so a caller arriving during that microtask cannot overtake the
   * queue and push concurrency past the limit.
   */
  private release(): void {
    const next = this.waiting.shift()
    if (next) next()
    else this.active -= 1
  }
}
