/**
 * A controllable WebSocket test double for browser-facing unit tests. It models
 * only observable client behavior: connection states, sent data, close details,
 * and the standard open, message, error, and close events. No network connection
 * is created.
 */
export class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  private static instances: MockWebSocket[] = []
  private static connectionWaiters = new Map<number, (socket: MockWebSocket) => void>()

  readonly url: string
  binaryType: BinaryType = 'blob'
  readyState = MockWebSocket.CONNECTING
  readonly sentMessages: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = []
  closeCode: number | undefined
  closeReason: string | undefined

  constructor(url: string | URL) {
    super()
    this.url = String(url)

    const connectionIndex = MockWebSocket.instances.push(this) - 1
    const waiter = MockWebSocket.connectionWaiters.get(connectionIndex)
    if (waiter) {
      MockWebSocket.connectionWaiters.delete(connectionIndex)
      waiter(this)
    }
  }

  /** Records client output so a test can inspect protocol messages. */
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sentMessages.push(data)
  }

  /** Simulates a client-requested close and emits the browser close event. */
  close(code = 1000, reason = ''): void {
    if (this.readyState === MockWebSocket.CLOSED) return

    this.closeCode = code
    this.closeReason = reason
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: code === 1000 }))
  }

  /** Moves a connecting socket to OPEN and notifies the client. */
  open(): void {
    if (this.readyState !== MockWebSocket.CONNECTING) {
      throw new Error('Only a connecting mock WebSocket can be opened.')
    }
    this.readyState = MockWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  /** Delivers one server text or binary frame while the connection is open. */
  receive(data: string | ArrayBuffer): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('The mock WebSocket must be open before it can receive data.')
    }
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  /** Simulates an unspecified transport error reported by the browser. */
  fail(): void {
    this.dispatchEvent(new Event('error'))
  }

  /** Simulates the remote server closing an established connection. */
  closeFromServer(code = 1000, reason = ''): void {
    if (this.readyState === MockWebSocket.CLOSED) return

    this.closeCode = code
    this.closeReason = reason
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: code === 1000 }))
  }

  /** Returns a connection immediately or waits for its constructor to run. */
  static waitForConnection(index = 0): Promise<MockWebSocket> {
    const existing = MockWebSocket.instances[index]
    if (existing) return Promise.resolve(existing)

    if (MockWebSocket.connectionWaiters.has(index)) {
      throw new Error(`A test is already waiting for mock WebSocket connection ${index}.`)
    }

    return new Promise((resolve) => {
      MockWebSocket.connectionWaiters.set(index, resolve)
    })
  }

  /** Clears process-local state before the next test installs this class. */
  static reset(): void {
    for (const socket of MockWebSocket.instances) {
      if (socket.readyState !== MockWebSocket.CLOSED) socket.close()
    }
    MockWebSocket.instances = []
    MockWebSocket.connectionWaiters.clear()
  }

  static get connectionCount(): number {
    return MockWebSocket.instances.length
  }
}
