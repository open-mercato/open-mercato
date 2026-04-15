jest.mock('@open-mercato/shared/lib/api/context', () => ({
  resolveRequestContext: jest.fn(async () => ({
    ctx: {
      auth: { tenantId: 't1', sub: 'u1', orgId: 'o1', roles: ['admin'] },
      selectedOrganizationId: 'o1',
    },
    container: {},
  })),
}))

jest.mock('../../../../../bus', () => ({
  registerGlobalEventTap: jest.fn(),
  registerCrossProcessEventListener: jest.fn(),
}))

import { GET } from '@open-mercato/events/modules/events/api/stream/route'

// req.signal is a linked/derived signal in Node, so we spy AFTER the
// Request is constructed to intercept the handler's real calls.
function makeTrackedRequest() {
  const controller = new AbortController()
  const req = new Request('http://localhost/api/events/stream', { signal: controller.signal })
  const addSpy = jest.spyOn(req.signal, 'addEventListener')
  const removeSpy = jest.spyOn(req.signal, 'removeEventListener')
  return { req, controller, addSpy, removeSpy }
}

describe('SSE event stream — abort listener hygiene', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('registers the abort listener with { once: true }', async () => {
    const { req, addSpy } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const abortCalls = addSpy.mock.calls.filter((call) => call[0] === 'abort')
    expect(abortCalls).toHaveLength(1)
    expect(abortCalls[0][2]).toMatchObject({ once: true })

    try { await (res.body as ReadableStream).cancel() } catch {}
  })

  it('detaches the abort listener when the stream is cancelled', async () => {
    const { req, addSpy, removeSpy } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const abortAdd = addSpy.mock.calls.find((call) => call[0] === 'abort')
    const attachedListener = abortAdd![1]

    await (res.body as ReadableStream).cancel()

    const abortRemove = removeSpy.mock.calls.find((call) => call[0] === 'abort' && call[1] === attachedListener)
    expect(abortRemove).toBeDefined()
  })

  it('detaches the abort listener when the request aborts', async () => {
    const { req, controller, addSpy, removeSpy } = makeTrackedRequest()
    const res = await GET(req)
    expect(res.status).toBe(200)

    const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

    controller.abort()
    await new Promise((resolve) => setImmediate(resolve))

    const abortRemove = removeSpy.mock.calls.find((call) => call[0] === 'abort' && call[1] === attachedListener)
    expect(abortRemove).toBeDefined()

    try { await (res.body as ReadableStream).cancel() } catch {}
  })

  it('does not retain listeners across many reconnects', async () => {
    for (let i = 0; i < 20; i += 1) {
      const { req, controller, addSpy, removeSpy } = makeTrackedRequest()
      const res = await GET(req)
      expect(res.status).toBe(200)

      const attachedListener = addSpy.mock.calls.find((call) => call[0] === 'abort')![1]

      controller.abort()
      await new Promise((resolve) => setImmediate(resolve))

      const abortRemove = removeSpy.mock.calls.find((call) => call[0] === 'abort' && call[1] === attachedListener)
      expect(abortRemove).toBeDefined()

      try { await (res.body as ReadableStream).cancel() } catch {}
      jest.restoreAllMocks()
    }
  })
})
