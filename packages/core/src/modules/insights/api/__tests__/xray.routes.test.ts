/** @jest-environment node */
import type { XrayStatus } from '../../lib/projection/jobs'
import { XRAY_SETTINGS_DEFAULTS } from '../../lib/projection/settings'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const OTHER_TENANT_ID = '11111111-0000-4000-8000-000000000002'
const ORG_ID = '22222222-0000-4000-8000-000000000001'
const OTHER_ORG_ID = '22222222-0000-4000-8000-000000000002'
const USER_ID = '33333333-0000-4000-8000-000000000001'
const PROGRESS_JOB_ID = 'dddddddd-0000-4000-8000-000000000001'
const SCAN_ID = 'eeeeeeee-0000-4000-8000-000000000001'

const reportErrorMock = jest.fn()
const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()
const isOrganizationInTenantMock = jest.fn(async (..._args: unknown[]) => true)
const runRouteMutationGuardsMock = jest.fn()
const startXrayBackfillMock = jest.fn()
const readXrayStatusMock = jest.fn()
const userHasAllFeaturesMock = jest.fn(async (_userId: string, _features: readonly string[], _scope?: unknown) => true)
const commandExecuteMock = jest.fn()
const invalidateXrayAnalyticsMock = jest.fn(async (..._args: unknown[]) => undefined)
const findXraySettingsRecordMock = jest.fn(async (..._args: unknown[]) => null)

const container = {
  resolve: (name: string): unknown => {
    if (name === 'em') return { fork: () => ({}) }
    if (name === 'rbacService') return { userHasAllFeatures: userHasAllFeaturesMock }
    if (name === 'commandBus') return { execute: commandExecuteMock }
    throw new Error(`[internal] unexpected service ${name}`)
  },
}

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => container,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

jest.mock('../../lib/projection/payloads', () => {
  const actual = jest.requireActual('../../lib/projection/payloads')
  return { ...actual, isOrganizationInTenant: (...args: unknown[]) => isOrganizationInTenantMock(...args) }
})

jest.mock('../../lib/projection/jobs', () => {
  const actual = jest.requireActual('../../lib/projection/jobs')
  return {
    ...actual,
    startXrayBackfill: (...args: unknown[]) => startXrayBackfillMock(...args),
    readXrayStatus: (...args: unknown[]) => readXrayStatusMock(...args),
  }
})

jest.mock('../../lib/analytics/index', () => ({
  invalidateXrayAnalytics: (...args: unknown[]) => invalidateXrayAnalyticsMock(...args),
}))

jest.mock('../../lib/projection/settings', () => {
  const actual = jest.requireActual('../../lib/projection/settings')
  return { ...actual, findXraySettingsRecord: (...args: unknown[]) => findXraySettingsRecordMock(...args) }
})

jest.mock('../../lib/process/registry', () => {
  const actual = jest.requireActual('../../lib/process/registry')
  return {
    ...actual,
    getProcessRegistry: () => ({
      ready: true,
      contractHash: 'hash',
      processes: [
        { processKey: 'test.deal', labelKey: 'test.deal', moduleId: 'test', requiredFeatures: ['test.deals.view'] },
        { processKey: 'test.order', labelKey: 'test.order', moduleId: 'test', requiredFeatures: ['sales.orders.view'] },
        { processKey: 'test.quote', labelKey: 'test.quote', moduleId: 'test', requiredFeatures: ['sales.orders.view'] },
      ],
      rejected: [],
    }),
  }
})

import { POST as backfillPost } from '../xray/backfill/route'
import { GET as statusGet } from '../xray/status/route'
import { GET as settingsGet, PUT as settingsPut } from '../xray/settings/route'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

function request(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function backfillRequest(): Request {
  return request('POST', 'http://localhost/api/insights/xray/backfill', {})
}

function passedGuard(runAfterSuccess: jest.Mock = jest.fn(async () => undefined)) {
  return { ok: true as const, runAfterSuccess }
}

function status(): XrayStatus {
  const count = (processKey: string) => ({ processKey, events: 5, voidedEvents: 0, cases: 2, openCases: 1, firstOccurredAt: null, lastOccurredAt: null })
  return {
    scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    ingestEnabled: true,
    settings: { id: null, updatedAt: null, ...XRAY_SETTINGS_DEFAULTS },
    registry: {
      ready: true,
      contractHash: 'hash',
      processes: ['test.deal', 'test.order', 'test.quote'].map((processKey) => ({ processKey, labelKey: processKey, moduleId: 'test' })),
      rejected: 0,
    },
    cursor: null,
    counts: [count('test.deal'), count('test.order'), count('test.quote')],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequestMock.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
  resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID], tenantId: TENANT_ID })
  isOrganizationInTenantMock.mockResolvedValue(true)
  runRouteMutationGuardsMock.mockResolvedValue(passedGuard())
  startXrayBackfillMock.mockResolvedValue({ ok: true, scanId: SCAN_ID, chainId: SCAN_ID, progressJobId: PROGRESS_JOB_ID, scheduleRegistered: true })
  readXrayStatusMock.mockResolvedValue(status())
  userHasAllFeaturesMock.mockResolvedValue(true)
})

describe('POST /api/insights/xray/backfill — mutation guards', () => {
  it('runs the registered mutation guards for the organization before starting the backfill', async () => {
    const runAfterSuccess = jest.fn(async () => undefined)
    runRouteMutationGuardsMock.mockResolvedValueOnce(passedGuard(runAfterSuccess))
    const response = await backfillPost(backfillRequest())
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, progressJobId: PROGRESS_JOB_ID, scanId: SCAN_ID, scheduleRegistered: true })
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(expect.objectContaining({
      container,
      auth: { userId: USER_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      input: { resourceKind: 'insights.xray_backfill', resourceId: ORG_ID, operation: 'update', mutationPayload: {} },
    }))
    expect(runRouteMutationGuardsMock.mock.invocationCallOrder[0]).toBeLessThan(startXrayBackfillMock.mock.invocationCallOrder[0])
    expect(runAfterSuccess).toHaveBeenCalledTimes(1)
    expect(startXrayBackfillMock.mock.invocationCallOrder[0]).toBeLessThan(runAfterSuccess.mock.invocationCallOrder[0])
  })

  it('returns the guard response and starts nothing when a guard blocks', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({
      ok: false,
      errorStatus: 423,
      errorBody: { error: 'Locked' },
      response: Response.json({ error: 'Locked' }, { status: 423 }),
    })
    const response = await backfillPost(backfillRequest())
    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({ error: 'Locked' })
    expect(startXrayBackfillMock).not.toHaveBeenCalled()
  })

  it('keeps the 202 when an after-success callback fails, and reports it', async () => {
    const failure = new Error('after-success failed')
    runRouteMutationGuardsMock.mockResolvedValueOnce(passedGuard(jest.fn(async () => { throw failure })))
    const response = await backfillPost(backfillRequest())
    expect(response.status).toBe(202)
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'insights.xray_guard_after_success_failed' }))
  })

  it('skips the after-success callbacks when the backfill did not start', async () => {
    const runAfterSuccess = jest.fn(async () => undefined)
    runRouteMutationGuardsMock.mockResolvedValueOnce(passedGuard(runAfterSuccess))
    startXrayBackfillMock.mockResolvedValueOnce({ ok: false, reason: 'disabled' })
    const response = await backfillPost(backfillRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Process X-Ray ingest is disabled for this organization.', code: 'disabled' })
    expect(runAfterSuccess).not.toHaveBeenCalled()
  })
})

describe('GET /api/insights/xray/status — process features', () => {
  it('lists only the processes whose required features the caller holds (wildcard-aware rbac)', async () => {
    userHasAllFeaturesMock.mockImplementation(async (_userId: string, features: readonly string[]) => !features.includes('sales.orders.view'))
    const response = await statusGet(request('GET', 'http://localhost/api/insights/xray/status'))
    expect(response.status).toBe(200)
    const body = await response.json() as { processes: Array<{ processKey: string; n: number | null }>; registry: { processes: Array<{ processKey: string }> } }
    expect(body.processes.map((process) => process.processKey)).toEqual(['test.deal'])
    expect(body.registry.processes.map((process) => process.processKey)).toEqual(['test.deal'])
    expect(userHasAllFeaturesMock).toHaveBeenCalledTimes(3)
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(USER_ID, ['insights.xray.manage'], { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(USER_ID, ['sales.orders.view'], { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(USER_ID, ['test.deals.view'], { tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('keeps every process for a caller holding all of them', async () => {
    const response = await statusGet(request('GET', 'http://localhost/api/insights/xray/status'))
    const body = await response.json() as { processes: Array<{ processKey: string }> }
    expect(body.processes.map((process) => process.processKey)).toEqual(['test.deal', 'test.order', 'test.quote'])
  })
})

describe('X-Ray route scope', () => {
  it('refuses an organization that does not belong to the resolved tenant before any write', async () => {
    isOrganizationInTenantMock.mockResolvedValueOnce(false)
    const response = await backfillPost(backfillRequest())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'organization_scope_required' }))
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
    expect(startXrayBackfillMock).not.toHaveBeenCalled()
  })

  it('never pairs an organization selected in another tenant with the caller tenant', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValueOnce({ selectedId: OTHER_ORG_ID, filterIds: [OTHER_ORG_ID], allowedIds: null, tenantId: OTHER_TENANT_ID })
    isOrganizationInTenantMock.mockImplementationOnce(async (...args: unknown[]) => (args[1] as { organizationId: string }).organizationId === ORG_ID)
    const response = await backfillPost(backfillRequest())
    expect(response.status).toBe(400)
    expect(isOrganizationInTenantMock).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT_ID, organizationId: OTHER_ORG_ID })
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
    expect(startXrayBackfillMock).not.toHaveBeenCalled()
  })
})

describe('X-Ray manage routes — organization outside the caller\'s scope', () => {
  const statusRequest = () => request('GET', 'http://localhost/api/insights/xray/status')
  const settingsRequest = () => request('GET', 'http://localhost/api/insights/xray/settings')

  it('refuses a home organization outside the caller\'s allowed organizations before reading or writing anything', async () => {
    getAuthFromRequestMock.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: OTHER_ORG_ID })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: null, filterIds: [ORG_ID], allowedIds: [ORG_ID], tenantId: TENANT_ID })
    for (const response of [await backfillPost(backfillRequest()), await statusGet(statusRequest()), await settingsGet(settingsRequest())]) {
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual(expect.objectContaining({ code: 'organization_scope_required' }))
    }
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
    expect(startXrayBackfillMock).not.toHaveBeenCalled()
    expect(readXrayStatusMock).not.toHaveBeenCalled()
    expect(findXraySettingsRecordMock).not.toHaveBeenCalled()
  })

  it('checks insights.xray.manage at the exact organization the route acts on', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID })
    userHasAllFeaturesMock.mockImplementation(async (_userId: string, features: readonly string[], scope?: unknown) => (
      !(features.includes('insights.xray.manage') && (scope as { organizationId: string | null }).organizationId === ORG_ID)
    ))
    for (const response of [await backfillPost(backfillRequest()), await statusGet(statusRequest()), await settingsGet(settingsRequest())]) {
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'forbidden' })
    }
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(USER_ID, ['insights.xray.manage'], { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
    expect(startXrayBackfillMock).not.toHaveBeenCalled()
    expect(readXrayStatusMock).not.toHaveBeenCalled()
    expect(findXraySettingsRecordMock).not.toHaveBeenCalled()
  })
})

describe('PUT /api/insights/xray/settings — analytics invalidation', () => {
  function savedSettings() {
    return { ...XRAY_SETTINGS_DEFAULTS, id: 'settings-1', settingsId: 'settings-1', updatedAt: '2026-10-10T10:00:00.000Z', timeZone: 'Europe/Warsaw' }
  }

  it('invalidates the organization\'s analytics after a successful save', async () => {
    commandExecuteMock.mockResolvedValueOnce({ result: savedSettings() })
    const response = await settingsPut(request('PUT', 'http://localhost/api/insights/xray/settings', { timeZone: 'Europe/Warsaw' }))
    expect(response.status).toBe(200)
    expect((await response.json()).result).toEqual(expect.objectContaining({ timeZone: 'Europe/Warsaw' }))
    expect(commandExecuteMock).toHaveBeenCalledWith('insights.xray.settings.save', expect.objectContaining({ input: expect.objectContaining({ timeZone: 'Europe/Warsaw' }) }))
    expect(invalidateXrayAnalyticsMock).toHaveBeenCalledWith(container, { tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('keeps the save when the invalidation fails (reported), and never invalidates a refused save', async () => {
    commandExecuteMock.mockResolvedValueOnce({ result: savedSettings() })
    invalidateXrayAnalyticsMock.mockRejectedValueOnce(new Error('cache down'))
    expect((await settingsPut(request('PUT', 'http://localhost/api/insights/xray/settings', { kAnonymity: 12 }))).status).toBe(200)
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'insights.xray_analytics_invalidation_failed' }))
    invalidateXrayAnalyticsMock.mockClear()
    commandExecuteMock.mockRejectedValueOnce(new CrudHttpError(422, { error: 'nope', code: 'conformance_workflow_not_found' }))
    const refused = await settingsPut(request('PUT', 'http://localhost/api/insights/xray/settings', { conformanceWorkflowId: '55555555-0000-4000-8000-000000000001' }))
    expect(refused.status).toBe(422)
    expect(invalidateXrayAnalyticsMock).not.toHaveBeenCalled()
    expect((await settingsPut(request('PUT', 'http://localhost/api/insights/xray/settings', { timeZone: '+01:00' }))).status).toBe(400)
  })
})
