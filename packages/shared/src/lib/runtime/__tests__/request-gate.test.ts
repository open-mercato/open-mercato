import {
  admitRequest,
  createCookieReader,
  evaluateRequestGates,
  hasRequestGates,
  registerRequestGate,
  unregisterRequestGate,
  type RequestGateContext,
} from '../request-gate'

function buildContext(overrides: Partial<RequestGateContext> = {}): RequestGateContext {
  return {
    surface: 'api',
    method: 'GET',
    pathname: '/customers/people',
    headers: new Headers(),
    cookies: createCookieReader(null),
    ...overrides,
  }
}

const registeredIds = ['blocker', 'passer', 'thrower', 'high', 'low', 'tracker']

afterEach(() => {
  for (const id of registeredIds) unregisterRequestGate(id)
})

describe('request gate registry', () => {
  it('is a no-op when no gate is registered', async () => {
    expect(hasRequestGates()).toBe(false)
    expect(await evaluateRequestGates(buildContext())).toBeNull()
    const admission = await admitRequest(buildContext())
    expect(admission.admitted).toBe(true)
  })

  it('short-circuits with the first blocking response', async () => {
    registerRequestGate({ id: 'passer', evaluate: () => null })
    registerRequestGate({ id: 'blocker', evaluate: () => ({ response: new Response('down', { status: 503 }) }) })
    const response = await evaluateRequestGates(buildContext())
    expect(response?.status).toBe(503)
  })

  it('orders gates by priority, highest first', async () => {
    const calls: string[] = []
    registerRequestGate({ id: 'low', priority: 1, evaluate: () => { calls.push('low'); return null } })
    registerRequestGate({ id: 'high', priority: 10, evaluate: () => { calls.push('high'); return { response: new Response(null, { status: 503 }) } } })
    await evaluateRequestGates(buildContext())
    expect(calls).toEqual(['high'])
  })

  it('isolates a throwing gate', async () => {
    registerRequestGate({ id: 'thrower', priority: 5, evaluate: () => { throw new Error('boom') } })
    registerRequestGate({ id: 'blocker', evaluate: () => ({ response: new Response(null, { status: 503 }) }) })
    const response = await evaluateRequestGates(buildContext())
    expect(response?.status).toBe(503)
  })

  it('replaces a gate registered twice under the same id', async () => {
    registerRequestGate({ id: 'blocker', evaluate: () => ({ response: new Response(null, { status: 503 }) }) })
    registerRequestGate({ id: 'blocker', evaluate: () => null })
    expect(await evaluateRequestGates(buildContext())).toBeNull()
  })

  it('tracks admitted requests until released exactly once', async () => {
    let inflight = 0
    registerRequestGate({
      id: 'tracker',
      evaluate: () => null,
      onAdmitted: () => {
        inflight += 1
        return () => { inflight -= 1 }
      },
    })
    const admission = await admitRequest(buildContext())
    expect(admission.admitted).toBe(true)
    expect(inflight).toBe(1)
    if (admission.admitted) {
      admission.release()
      admission.release()
    }
    expect(inflight).toBe(0)
  })

  it('does not count blocked requests as admitted', async () => {
    let inflight = 0
    registerRequestGate({
      id: 'tracker',
      evaluate: () => ({ response: new Response(null, { status: 503 }) }),
      onAdmitted: () => { inflight += 1 },
    })
    const admission = await admitRequest(buildContext())
    expect(admission.admitted).toBe(false)
    expect(inflight).toBe(0)
  })

  it('shares the registry through globalThis', () => {
    registerRequestGate({ id: 'passer', evaluate: () => null })
    const store = (globalThis as Record<string, unknown>).__openMercatoRequestGates__ as Array<{ id: string }>
    expect(store.map((gate) => gate.id)).toContain('passer')
  })
})

describe('createCookieReader', () => {
  it('parses and decodes cookies, first occurrence wins', () => {
    const reader = createCookieReader('a=1; b=hello%20world; a=2; broken; =x')
    expect(reader.get('a')).toBe('1')
    expect(reader.get('b')).toBe('hello world')
    expect(reader.get('missing')).toBeUndefined()
  })
})
