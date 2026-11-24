import { createCookieReader, type RequestGateContext } from '@open-mercato/shared/lib/runtime/request-gate'
import { createFileMaintenanceStore } from '../lib/store/file'
import { createInitialState, type MaintenanceStateV1 } from '../lib/state'
import { activateState, computeRetryAfterSeconds, mutateState } from '../lib/transitions'
import { generateBypassToken, hashBypassToken } from '../lib/bypass'
import {
  evaluateMaintenanceGate,
  peekDecisionState,
  refreshMaintenanceState,
  resetMaintenanceRuntimeForTests,
} from '../lib/runtime'
import type { MaintenanceStateStore } from '../lib/store/types'
import { makeConfig, makeTempDir } from './helpers'

function ctx(overrides: Partial<RequestGateContext> & { cookie?: string } = {}): RequestGateContext {
  const { cookie, ...rest } = overrides
  return {
    surface: 'api',
    method: 'GET',
    pathname: '/api/customers/people',
    headers: new Headers(),
    cookies: createCookieReader(cookie ?? null),
    ...rest,
  }
}

async function setup(stateOverrides?: (state: MaintenanceStateV1) => MaintenanceStateV1) {
  const dir = makeTempDir()
  const store = createFileMaintenanceStore(dir)
  const runtime = resetMaintenanceRuntimeForTests({ config: makeConfig(dir), store })
  if (stateOverrides) {
    await mutateState(store, (current, now) => {
      const activated = activateState(current, { startedBy: { source: 'cli', host: 'test' } }, now).next
      return { next: stateOverrides(activated), result: undefined }
    })
  }
  return { store, runtime, dir }
}

describe('maintenance gate', () => {
  it('admits everything when no window is active', async () => {
    await setup()
    expect(await evaluateMaintenanceGate(ctx())).toBeNull()
  })

  it('returns a JSON 503 with Retry-After, no-store and the stable code for API requests', async () => {
    await setup((state) => ({ ...state, retryAfterSeconds: 120 }))
    const decision = await evaluateMaintenanceGate(ctx({ method: 'POST', pathname: '/api/sales/orders' }))
    const response = decision!.response
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Maintenance-Mode')).toBe('1')
    const body = await response.json()
    expect(body).toMatchObject({ code: 'MAINTENANCE_MODE', retryAfter: 120, until: null })
  })

  it('serves the HTML page for page requests with the custom title escaped', async () => {
    await setup((state) => ({ ...state, page: { title: '<b>Upgrade</b>', message: 'Back soon' } }))
    const decision = await evaluateMaintenanceGate(ctx({ surface: 'page', pathname: '/backend' }))
    const html = await decision!.response.text()
    expect(decision!.response.status).toBe(503)
    expect(decision!.response.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('&lt;b&gt;Upgrade&lt;/b&gt;')
    expect(decision!.response.headers.get('Content-Security-Policy')).toContain("script-src 'none'")
  })

  it('exempts OPTIONS, the public status endpoint and the domain-resolve self-call', async () => {
    await setup((state) => state)
    process.env.DOMAIN_RESOLVE_SECRET = 'resolve-secret-value'
    try {
      expect(await evaluateMaintenanceGate(ctx({ method: 'OPTIONS' }))).toBeNull()
      expect(await evaluateMaintenanceGate(ctx({ pathname: '/api/maintenance/status' }))).toBeNull()
      expect(await evaluateMaintenanceGate(ctx({ pathname: '/api/maintenance/status', method: 'POST' }))).not.toBeNull()
      const headers = new Headers({ 'x-domain-resolve-secret': 'resolve-secret-value' })
      expect(await evaluateMaintenanceGate(ctx({ pathname: '/api/customer_accounts/domain-resolve', headers }))).toBeNull()
      expect(await evaluateMaintenanceGate(ctx({ pathname: '/api/customer_accounts/domain-resolve' }))).not.toBeNull()
    } finally {
      delete process.env.DOMAIN_RESOLVE_SECRET
    }
  })

  it('admits a valid bypass cookie or header and refuses it while a hold forbids bypass', async () => {
    const token = generateBypassToken()
    const { store } = await setup((state) => ({
      ...state,
      bypass: { enabled: true, tokenSha256: hashBypassToken(token), expiresAt: new Date(Date.now() + 60_000).toISOString() },
    }))
    expect(await evaluateMaintenanceGate(ctx({ cookie: `om_maintenance_bypass=${token}` }))).toBeNull()
    expect(await evaluateMaintenanceGate(ctx({ headers: new Headers({ 'x-maintenance-bypass': token }) }))).toBeNull()
    expect(await evaluateMaintenanceGate(ctx({ cookie: 'om_maintenance_bypass=wrong' }))).not.toBeNull()
    await mutateState(store, (current) => ({
      next: { ...current, hold: { id: 'h', operation: 'encryption.rotate', pid: 1, host: 'x', heartbeatAt: new Date().toISOString(), forbidsBypass: true, gateRevision: current.gateRevision + 1 } },
      result: undefined,
    }))
    await refreshMaintenanceState(true)
    expect(await evaluateMaintenanceGate(ctx({ cookie: `om_maintenance_bypass=${token}` }))).not.toBeNull()
  })

  it('refuses an expired bypass token and a token from another window', async () => {
    const token = generateBypassToken()
    await setup((state) => ({ ...state, bypass: { enabled: true, tokenSha256: hashBypassToken(token), expiresAt: new Date(Date.now() - 1000).toISOString() } }))
    expect(await evaluateMaintenanceGate(ctx({ cookie: `om_maintenance_bypass=${token}` }))).not.toBeNull()
    const other = generateBypassToken()
    await setup((state) => ({ ...state, bypass: { enabled: true, tokenSha256: hashBypassToken(other), expiresAt: null } }))
    expect(await evaluateMaintenanceGate(ctx({ cookie: `om_maintenance_bypass=${token}` }))).not.toBeNull()
  })

  it('sets the bypass cookie from the POSTed form and rejects bad tokens', async () => {
    const token = generateBypassToken()
    await setup((state) => ({ ...state, bypass: { enabled: true, tokenSha256: hashBypassToken(token), expiresAt: null } }))
    const form = (value: string) => new Request('http://localhost/maintenance-bypass', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(value)}`,
    })
    const ok = await evaluateMaintenanceGate(ctx({ surface: 'page', method: 'POST', pathname: '/maintenance-bypass', request: form(token) }))
    expect(ok!.response.status).toBe(303)
    expect(ok!.response.headers.get('Location')).toBe('/backend')
    expect(ok!.response.headers.get('Set-Cookie')).toMatch(/^om_maintenance_bypass=.+HttpOnly; SameSite=Lax/)
    const bad = await evaluateMaintenanceGate(ctx({ surface: 'page', method: 'POST', pathname: '/maintenance-bypass', request: form('nope') }))
    expect(bad!.response.status).toBe(403)
    const page = await evaluateMaintenanceGate(ctx({ surface: 'page', pathname: '/maintenance-bypass' }))
    expect(page!.response.status).toBe(200)
    expect(await page!.response.text()).toContain('method="post"')
  })

  it('keeps the last known active state when the store becomes unreachable (sticky)', async () => {
    const { runtime } = await setup((state) => state)
    expect(await evaluateMaintenanceGate(ctx())).not.toBeNull()
    const broken: MaintenanceStateStore = {
      kind: 'file', multiHost: false,
      readState: async () => { throw new Error('down') },
      compareAndSet: async () => false, writeProcess: async () => {}, removeProcess: async () => {},
      listProcesses: async () => [], now: async () => new Date(), isDurable: async () => true, close: async () => {},
    }
    runtime.storePromise = Promise.resolve(broken)
    await refreshMaintenanceState(true)
    expect(await evaluateMaintenanceGate(ctx())).not.toBeNull()
  })

  it('treats a vanished state key during a known window as unreachable', async () => {
    const { runtime } = await setup((state) => state)
    await refreshMaintenanceState(true)
    const empty: MaintenanceStateStore = {
      kind: 'redis', multiHost: true,
      readState: async () => ({ kind: 'missing' }),
      compareAndSet: async () => false, writeProcess: async () => {}, removeProcess: async () => {},
      listProcesses: async () => [], now: async () => new Date(), isDurable: async () => true, close: async () => {},
    }
    runtime.storePromise = Promise.resolve(empty)
    await refreshMaintenanceState(true)
    expect(peekDecisionState()?.active).toBe(true)
  })

  it('fails open at boot when the store is unreachable and no state is known', async () => {
    const runtime = resetMaintenanceRuntimeForTests({ config: makeConfig(makeTempDir()) })
    runtime.storePromise = Promise.reject(new Error('down'))
    runtime.storePromise.catch(() => {})
    expect(await evaluateMaintenanceGate(ctx())).toBeNull()
  })

  it('fails safe on an unreadable state document', async () => {
    const { runtime } = await setup()
    runtime.storePromise = Promise.resolve({
      kind: 'file', multiHost: false,
      readState: async () => ({ kind: 'unsupported', reason: 'v9' }),
      compareAndSet: async () => false, writeProcess: async () => {}, removeProcess: async () => {},
      listProcesses: async () => [], now: async () => new Date(), isDurable: async () => true, close: async () => {},
    } as MaintenanceStateStore)
    await refreshMaintenanceState(true)
    expect(await evaluateMaintenanceGate(ctx())).not.toBeNull()
  })

  it('forces the mode on from OM_MAINTENANCE_FORCE without the store and ignores bypass', async () => {
    const dir = makeTempDir()
    resetMaintenanceRuntimeForTests({ config: makeConfig(dir, { force: true }), store: createFileMaintenanceStore(dir) })
    const decision = await evaluateMaintenanceGate(ctx({ headers: new Headers({ 'x-maintenance-bypass': 'anything' }) }))
    expect(decision!.response.status).toBe(503)
  })
})

describe('Retry-After', () => {
  it('uses the time remaining until `until`, minimum 30 s', () => {
    const now = new Date('2026-11-14T00:00:00Z')
    expect(computeRetryAfterSeconds({ until: '2026-11-14T00:10:00Z', retryAfterSeconds: 300 }, now)).toBe(600)
    expect(computeRetryAfterSeconds({ until: '2026-11-14T00:00:05Z', retryAfterSeconds: 300 }, now)).toBe(30)
    expect(computeRetryAfterSeconds({ until: null, retryAfterSeconds: 5 }, now)).toBe(30)
    expect(computeRetryAfterSeconds({ ...createInitialState() }, now)).toBe(300)
  })
})
