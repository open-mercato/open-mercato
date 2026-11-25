import fs from 'node:fs'
import {
  registerCrossProcessEventListener,
  registerGlobalEventTap,
} from '@open-mercato/events/bus'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { DELETE, GET } from '../route'

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}))
jest.mock('@open-mercato/events/bus', () => ({
  CROSS_PROCESS_EVENT_INSTANCE_ID: 'local',
  registerCrossProcessEventListener: jest.fn(),
  registerGlobalEventTap: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

const auth = { sub: 'viewer', tenantId: 'test-tenant', orgId: 'test-org' }
const request = new Request('http://localhost/api/example/qa-events')

function expectNoCaptureSideEffects() {
  expect(registerGlobalEventTap).not.toHaveBeenCalled()
  expect(registerCrossProcessEventListener).not.toHaveBeenCalled()
  expect(fs.existsSync).not.toHaveBeenCalled()
  expect(fs.readFileSync).not.toHaveBeenCalled()
  expect(fs.mkdirSync).not.toHaveBeenCalled()
  expect(fs.appendFileSync).not.toHaveBeenCalled()
  expect(fs.writeFileSync).not.toHaveBeenCalled()
}

describe('QA events route', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.replaceProperty(process, 'env', { ...process.env })
    delete process.env.OM_INTEGRATION_TEST
    Reflect.deleteProperty(globalThis, '__exampleCapturedQaEvents__')
    Reflect.deleteProperty(globalThis, '__exampleCapturedQaEventsTap__')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    Reflect.deleteProperty(globalThis, '__exampleCapturedQaEvents__')
    Reflect.deleteProperty(globalThis, '__exampleCapturedQaEventsTap__')
  })

  describe.each([['GET', GET], ['DELETE', DELETE]] as const)('%s', (_method, handler) => {
    it.each([undefined, 'false', 'invalid'])('returns 404 with integration flag %s', async (flag) => {
      if (flag !== undefined) process.env.OM_INTEGRATION_TEST = flag
      jest.mocked(getAuthFromRequest).mockResolvedValue(auth)

      expect((await handler(request)).status).toBe(404)
      expect(getAuthFromRequest).not.toHaveBeenCalled()
      expectNoCaptureSideEffects()
    })

    it.each([null, { ...auth, tenantId: null }, { ...auth, orgId: null }])(
      'requires scoped authentication before initializing capture (%j)',
      async (authContext) => {
        process.env.OM_INTEGRATION_TEST = 'true'
        jest.mocked(getAuthFromRequest).mockResolvedValue(authContext)

        expect((await handler(request)).status).toBe(401)
        expectNoCaptureSideEffects()
      },
    )
  })

  it('keeps scoped reads and cleanup available in integration mode', async () => {
    process.env.OM_INTEGRATION_TEST = 'true'
    jest.mocked(getAuthFromRequest).mockResolvedValue(auth)
    const scoped = {
      event: 'example.fixture.updated',
      payload: { tenantId: auth.tenantId, organizationId: auth.orgId },
      capturedAt: '2026-01-01T00:00:00.000Z',
    }
    const otherScope = { ...scoped, payload: { ...scoped.payload, organizationId: 'other-org' } }
    jest.mocked(fs.existsSync).mockReturnValue(true)
    jest.mocked(fs.readFileSync).mockReturnValue(`${JSON.stringify(scoped)}\n${JSON.stringify(otherScope)}\n`)

    const list = await GET(request)
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual({ items: [scoped] })

    const clear = await DELETE(request)
    expect(clear.status).toBe(200)
    expect(await clear.json()).toEqual({ ok: true })
    expect(fs.writeFileSync).toHaveBeenCalledWith(expect.any(String), `${JSON.stringify(otherScope)}\n`, 'utf8')
    expect(registerGlobalEventTap).toHaveBeenCalledTimes(1)
    expect(registerCrossProcessEventListener).toHaveBeenCalledTimes(1)
  })

  it('stops persisting events when an installed tap runs outside integration mode', async () => {
    process.env.OM_INTEGRATION_TEST = 'true'
    jest.mocked(getAuthFromRequest).mockResolvedValue(auth)
    await GET(request)

    const [[captureLocalEvent]] = jest.mocked(registerGlobalEventTap).mock.calls
    const [[captureRelayedEvent]] = jest.mocked(registerCrossProcessEventListener).mock.calls
    const fixture = {
      event: 'example.fixture.updated',
      payload: { tenantId: auth.tenantId, organizationId: auth.orgId },
      originPid: 100,
      originInstanceId: 'fixture-worker',
    }
    await captureLocalEvent(fixture.event, fixture.payload)
    await captureRelayedEvent(fixture)
    expect(fs.appendFileSync).toHaveBeenCalledTimes(2)

    delete process.env.OM_INTEGRATION_TEST
    await captureLocalEvent(fixture.event, fixture.payload)
    await captureRelayedEvent(fixture)
    expect(fs.appendFileSync).toHaveBeenCalledTimes(2)
  })
})
