import { describe, expect, it, vi } from 'vitest'

import { KokoroHealthProbe } from './kokoro-health-probe'

const BASE_URL = 'http://localhost:8880'

describe('KokoroHealthProbe', () => {
  it('reports a server that answers with a usable voice catalog', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ voices: ['af_heart', 'bm_george'] }), { status: 200 })
    )

    const report = await new KokoroHealthProbe(BASE_URL, { fetch: fetchMock }).check()

    expect(report).toEqual({
      status: 'ok',
      baseUrl: BASE_URL,
      message: `${BASE_URL} answered with 2 voices.`
    })
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${BASE_URL}/v1/audio/voices`)
  })

  it('reports an address nothing answers on as unreachable', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))

    const report = await new KokoroHealthProbe(BASE_URL, { fetch: fetchMock }).check()

    expect(report.status).toBe('unreachable')
    expect(report.message).toContain(BASE_URL)
  })

  it('separates a reachable host that has no Kokoro voice route', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('Not Found', { status: 404 })
    )

    const report = await new KokoroHealthProbe(BASE_URL, { fetch: fetchMock }).check()

    expect(report).toEqual({
      status: 'incompatible',
      baseUrl: BASE_URL,
      message: 'The Kokoro voice list returned HTTP 404.'
    })
  })

  it('separates a reachable host that answers with something other than a catalog', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<!doctype html><title>Router</title>', { status: 200 })
    )

    const report = await new KokoroHealthProbe(BASE_URL, { fetch: fetchMock }).check()

    expect(report.status).toBe('incompatible')
    expect(report.message).toContain('invalid data')
  })

  it('reports an unusable address without putting anything on the wire', async () => {
    const fetchMock = vi.fn<typeof fetch>()

    const report = await new KokoroHealthProbe('ftp://localhost', { fetch: fetchMock }).check()

    expect(report).toEqual({
      status: 'incompatible',
      baseUrl: 'ftp://localhost',
      message: 'The Kokoro server address must be an HTTP or HTTPS origin.'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gives up on a host that never answers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')))
      })
    )

    const report = await new KokoroHealthProbe(BASE_URL, { fetch: fetchMock, timeoutMs: 5 })
      .check()

    expect(report.status).toBe('unreachable')
  })
})
