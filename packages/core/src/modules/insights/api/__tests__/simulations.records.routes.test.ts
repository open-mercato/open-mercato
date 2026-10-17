/** @jest-environment node */
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'

const TENANT_ID = '11111111-0000-4000-8000-0000000000b7'
const ORG_ID = '22222222-0000-4000-8000-0000000000b7'
const OTHER_ORG_ID = '22222222-0000-4000-8000-0000000000b8'
const CHILD_ORG_ID = '22222222-0000-4000-8000-0000000000b9'
const USER_ID = '33333333-0000-4000-8000-0000000000b7'
const RUN_ID = '44444444-0000-4000-8000-0000000000b7'
const ROLE_ID = '55555555-0000-4000-8000-0000000000b7'

const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()
const runRouteMutationGuardsMock = jest.fn()
const commandExecuteMock = jest.fn()
const findSimulationRunMock = jest.fn()
const findSimulationDecisionsMock = jest.fn(async (..._args: unknown[]) => [])
const listMock = jest.fn()
const accessLogMock = jest.fn(async (..._args: unknown[]): Promise<unknown> => ({ id: 'row' }))
let grantedFeatures: string[] = []
let featureOrganizations: string[] = []
const featureAccessCalls: Array<readonly string[]> = []
let accessLogAvailable = true

type OrganizationWhere = { id?: string | { $in: string[] }; tenant?: string }

const ORGANIZATIONS = [
  { id: ORG_ID, tenant: TENANT_ID, ancestorIds: [] as string[], descendantIds: [CHILD_ORG_ID] },
  { id: CHILD_ORG_ID, tenant: TENANT_ID, ancestorIds: [ORG_ID], descendantIds: [] as string[] },
  { id: OTHER_ORG_ID, tenant: TENANT_ID, ancestorIds: [] as string[], descendantIds: [] as string[] },
]

function matchesOrganization(row: (typeof ORGANIZATIONS)[number], where: OrganizationWhere): boolean {
  if (where.tenant !== undefined && where.tenant !== row.tenant) return false
  if (typeof where.id === 'string') return where.id === row.id
  if (where.id && Array.isArray(where.id.$in)) return where.id.$in.includes(row.id)
  return true
}

const organizationEm = {
  find: async (_entity: unknown, where: OrganizationWhere) => ORGANIZATIONS.filter((row) => matchesOrganization(row, where)).map((row) => ({ ...row })),
  findOne: async (_entity: unknown, where: OrganizationWhere) => {
    const row = ORGANIZATIONS.find((candidate) => matchesOrganization(candidate, where))
    return row ? { ...row } : null
  },
}

const container = {
  resolve: (name: string): unknown => {
    if (name === 'em') return { fork: () => organizationEm }
    if (name === 'rbacService') {
      return {
        userHasAllFeatures: async (_userId: string, required: string[]) => hasAllFeatures(required, grantedFeatures),
        resolveFeatureOrganizationAccess: async (_userId: string, required: readonly string[]) => {
          featureAccessCalls.push(required)
          return {
            unrestricted: false,
            filterOrganizationIds: (candidates: ReadonlyArray<{ id: string }>) => (
              hasAllFeatures([...required], grantedFeatures) ? candidates.map((candidate) => candidate.id).filter((id) => featureOrganizations.includes(id)) : []
            ),
          }
        },
      }
    }
    if (name === 'commandBus') return { execute: commandExecuteMock }
    if (name === 'accessLogService' && accessLogAvailable) return { log: accessLogMock }
    throw new Error(`[internal] unexpected service ${name}`)
  },
}

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: jest.fn() }) }))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => container }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string) => `t:${key}`, translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))
jest.mock('../../lib/projection/payloads', () => {
  const actual = jest.requireActual('../../lib/projection/payloads')
  return { ...actual, isOrganizationInTenant: async () => true }
})
const READ_ONLY_TRX = { readOnly: true }
jest.mock('../../lib/simulation/inline', () => {
  const actual = jest.requireActual('../../lib/simulation/inline')
  return { ...actual, runInReadOnlyTransaction: async (_em: unknown, run: (trx: unknown) => Promise<unknown>) => run(READ_ONLY_TRX) }
})
jest.mock('../../lib/simulation/store', () => {
  const actual = jest.requireActual('../../lib/simulation/store')
  return {
    ...actual,
    findSimulationRun: (...args: unknown[]) => findSimulationRunMock(...args),
    findSimulationDecisions: (...args: unknown[]) => findSimulationDecisionsMock(...args),
  }
})

import { z } from 'zod'
import { registerSimulateConfigEntries, resetSimulationRegistryForTests } from '../../lib/simulation/registry'
import { POST as requestPost } from '../simulations/route'
import { GET as detailGet } from '../simulations/[id]/route'
import { GET as recordsGet, metadata as recordsMetadata } from '../simulations/[id]/records/route'

const BASE = 'http://localhost/api/insights/simulations'
const params = (id: string) => ({ params: { id } })

function request(method: string, url: string, body?: unknown): Request {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
}

function storedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'test_module.preview',
    status: 'completed',
    progressJobId: null,
    requestedByUserId: USER_ID,
    inputJson: { roleId: ROLE_ID },
    artifactKind: 'test_module.acl',
    artifactId: ROLE_ID,
    artifactVersionJson: { updatedAt: null, fingerprint: 'fp' },
    proposalFingerprint: 'fp',
    windowFrom: new Date('2026-10-10T12:00:00Z'),
    windowTo: new Date('2026-10-10T12:00:00Z'),
    budgetsJson: { maxRecords: 50_000, maxDurationMs: 120_000, recordsUsed: 3, elapsedMs: 10, slices: 1 },
    fidelity: 'observed',
    coverageJson: {},
    resultJson: { k: 10, truncated: false, groups: [], summary: { warnings: ['test_module.warning'], counts: { pages_lost: 2 }, lists: { features_lost: ['a.b'] } } },
    caveats: [],
    errorCode: null,
    createdAt: new Date('2026-10-10T12:00:00Z'),
    startedAt: new Date('2026-10-10T12:00:00Z'),
    completedAt: new Date('2026-10-10T12:00:01Z'),
    expiresAt: new Date('2026-10-11T12:00:01Z'),
    updatedAt: new Date('2026-10-10T12:00:01Z'),
    ...overrides,
  }
}

function registerKinds(kindFeatures: string[] = ['test_module.manage', 'test_module.users']) {
  registerSimulateConfigEntries([{
    moduleId: 'test_module',
    config: {
      version: 1,
      kinds: [
        {
          kind: 'test_module.preview',
          artifactKind: 'test_module.acl',
          labelKey: 'test_module.label',
          requiredFeatures: kindFeatures,
          inputSchema: z.object({ roleId: z.string() }),
          version: 1,
          cellKeys: ['gains'],
          ttlHours: 24,
          execution: 'inline',
          accessLogResourceKind: 'insights.simulation.permission_preview',
          readArtifactVersion: async () => null,
          fingerprintProposal: () => 'fp',
          run: async () => ({ status: 'done' as const, recordsProcessed: 0, result: { groups: [], coverage: {}, caveats: [], fidelity: 'observed' as const, truncated: false } }),
          liveRecords: { requiredFeatures: ['test_module.users'], list: listMock },
        },
        {
          kind: 'test_module.backtest',
          artifactKind: 'test_module.thing',
          labelKey: 'test_module.backtest',
          requiredFeatures: ['test_module.manage'],
          inputSchema: z.object({ roleId: z.string() }),
          version: 1,
          cellKeys: ['fires'],
          readArtifactVersion: async () => null,
          fingerprintProposal: () => 'fp',
          run: async () => ({ status: 'done' as const, recordsProcessed: 0, result: { groups: [], coverage: {}, caveats: [], fidelity: 'none' as const, truncated: false } }),
        },
      ],
    },
  }])
}

beforeEach(() => {
  jest.clearAllMocks()
  resetSimulationRegistryForTests()
  registerKinds()
  grantedFeatures = ['insights.simulator.*', 'test_module.*']
  featureOrganizations = [ORG_ID, CHILD_ORG_ID, OTHER_ORG_ID]
  featureAccessCalls.length = 0
  accessLogAvailable = true
  accessLogMock.mockResolvedValue({ id: 'row' })
  getAuthFromRequestMock.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
  resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID, OTHER_ORG_ID], tenantId: TENANT_ID })
  runRouteMutationGuardsMock.mockResolvedValue({ ok: true, modifiedPayload: null, runAfterSuccess: async () => undefined })
  findSimulationRunMock.mockResolvedValue(storedRun())
  listMock.mockResolvedValue({
    items: [
      { id: 'user-1', type: 'user', label: 'Ann', href: '/backend/users/user-1/edit', groupKeys: ['org:users'], counts: { features_gained: 1 } },
      { id: 'user-2', type: 'user', label: 'Bob', href: 'https://evil.example/x', groupKeys: ['org:users'], counts: { features_lost: -3, weird_KEY: 1 } },
      { id: 'bad', type: 'Bad Type', label: 'x', href: null, groupKeys: [], counts: {} },
    ],
    total: 3,
    notes: ['test_module.note', 'not a key'],
    groupLabels: { 'org:users': 'Alpha' },
  })
})

describe('inline requests', () => {
  it('answers 200 with the completed run of an inline kind', async () => {
    commandExecuteMock.mockResolvedValue({ result: { runId: RUN_ID, progressJobId: null, status: 'completed', created: true } })
    const response = await requestPost(request('POST', BASE, { kind: 'test_module.preview', artifactId: ROLE_ID, proposal: { roleId: ROLE_ID } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, runId: RUN_ID, progressJobId: null, status: 'completed', deduplicated: false })
  })

  it('answers 403 without the kind\'s features before anything runs', async () => {
    grantedFeatures = ['insights.simulator.*', 'test_module.users']
    const response = await requestPost(request('POST', BASE, { kind: 'test_module.preview', artifactId: ROLE_ID, proposal: { roleId: ROLE_ID } }))
    expect(response.status).toBe(403)
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  it('exposes how the run executed, whether it lists live records and its summary', async () => {
    const response = await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))
    const body = await response.json()
    expect(body.result).toEqual(expect.objectContaining({ execution: 'inline', hasLiveRecords: true }))
    expect(body.result.result.summary).toEqual({ warnings: ['test_module.warning'], counts: { pages_lost: 2 }, lists: { features_lost: ['a.b'] } })
    expect(body.result.budgets.recordsUsed).toBe(3)
    findSimulationRunMock.mockResolvedValueOnce(storedRun({ resultJson: { k: 10, truncated: false, groups: [{ key: 'org:api_keys', labelKey: null, sampleResourceKind: null, total: null, suppressed: true, cells: [{ key: 'gains', count: null, suppressed: 'below_k', sampleIds: [] }], warnings: [], flags: [] }] } }))
    const suppressed = await (await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).json()
    expect(suppressed.result.budgets.recordsUsed).toBeNull()
    findSimulationRunMock.mockResolvedValue(storedRun({ kind: 'test_module.backtest', status: 'running', resultJson: { partial: {} } }))
    const queued = await (await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).json()
    expect(queued.result).toEqual(expect.objectContaining({ execution: 'queued', hasLiveRecords: false, result: null }))
  })
})

describe('GET /api/insights/simulations/{id}/records', () => {
  const url = (query = '') => `${BASE}/${RUN_ID}/records${query}`

  it('is guarded by insights.simulator.view', () => {
    expect(recordsMetadata).toEqual({ GET: { requireAuth: true, requireFeatures: ['insights.simulator.view'] } })
  })

  it('writes the access-log row first, then lists live records for the viewer\'s scope, sanitized', async () => {
    const response = await recordsGet(request('GET', url('?page=2&pageSize=10')), params(RUN_ID))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(accessLogMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      actorUserId: USER_ID,
      resourceKind: 'insights.simulation.permission_preview',
      resourceId: ROLE_ID,
      accessType: 'read',
    }))
    expect(accessLogMock.mock.invocationCallOrder[0]).toBeLessThan(listMock.mock.invocationCallOrder[0])
    expect(listMock).toHaveBeenCalledWith({ roleId: ROLE_ID }, expect.objectContaining({
      em: READ_ONLY_TRX,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      viewerUserId: USER_ID,
      artifactId: ROLE_ID,
      organizationIds: [ORG_ID, CHILD_ORG_ID],
      page: 2,
      pageSize: 10,
    }))
    expect(body).toEqual({
      ok: true,
      items: [
        { id: 'user-1', type: 'user', label: 'Ann', href: '/backend/users/user-1/edit', groupKeys: ['org:users'], counts: { features_gained: 1 } },
        { id: 'user-2', type: 'user', label: 'Bob', href: null, groupKeys: ['org:users'], counts: {} },
      ],
      total: 3,
      page: 2,
      pageSize: 10,
      totalPages: 1,
      notes: ['test_module.note'],
      groupLabels: { 'org:users': 'Alpha' },
    })
  })

  it('lists principals only in the run organization\'s subtree where the viewer holds the kind and live-records features, not in other allowed organizations (D10)', async () => {
    resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID, CHILD_ORG_ID], allowedIds: [ORG_ID, CHILD_ORG_ID, OTHER_ORG_ID], tenantId: TENANT_ID })
    featureOrganizations = [ORG_ID, OTHER_ORG_ID]
    expect((await recordsGet(request('GET', url()), params(RUN_ID))).status).toBe(200)
    expect(listMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ organizationIds: [ORG_ID] }))
    expect(featureAccessCalls).toEqual([['test_module.manage', 'test_module.users']])
    featureOrganizations = [ORG_ID, CHILD_ORG_ID, OTHER_ORG_ID]
    expect((await recordsGet(request('GET', url()), params(RUN_ID))).status).toBe(200)
    expect(listMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ organizationIds: [ORG_ID, CHILD_ORG_ID] }))
  })

  it('fails closed with 503 when the access log cannot record the read', async () => {
    accessLogAvailable = false
    const unavailable = await recordsGet(request('GET', url()), params(RUN_ID))
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ error: 't:insights.simulation.errors.access_log_unavailable', code: 'access_log_unavailable' })
    accessLogAvailable = true
    accessLogMock.mockResolvedValueOnce(null)
    expect((await recordsGet(request('GET', url()), params(RUN_ID))).status).toBe(503)
    expect(listMock).not.toHaveBeenCalled()
  })

  it('answers the identical 404 for unknown or foreign runs, lost kind features and kinds without live records', async () => {
    findSimulationRunMock.mockResolvedValueOnce(null)
    const missing = await recordsGet(request('GET', url()), params(RUN_ID))
    expect(missing.status).toBe(404)
    const missingBody = await missing.json()
    expect(findSimulationRunMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requesterUserId: USER_ID }))
    grantedFeatures = ['insights.simulator.*', 'test_module.users']
    const lostFeature = await recordsGet(request('GET', url()), params(RUN_ID))
    expect(lostFeature.status).toBe(404)
    expect(await lostFeature.json()).toEqual(missingBody)
    grantedFeatures = ['insights.simulator.*', 'test_module.*']
    findSimulationRunMock.mockResolvedValueOnce(storedRun({ kind: 'test_module.backtest' }))
    const noRecords = await recordsGet(request('GET', url()), params(RUN_ID))
    expect(noRecords.status).toBe(404)
    expect(await noRecords.json()).toEqual(missingBody)
    expect((await recordsGet(request('GET', `${BASE}/not-a-uuid/records`), params('not-a-uuid'))).status).toBe(404)
    expect(listMock).not.toHaveBeenCalled()
    expect(accessLogMock).not.toHaveBeenCalled()
  })

  it('requires the live-records features and a completed run', async () => {
    resetSimulationRegistryForTests()
    registerKinds(['test_module.manage'])
    grantedFeatures = ['insights.simulator.*', 'test_module.manage']
    const forbidden = await recordsGet(request('GET', url()), params(RUN_ID))
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual(expect.objectContaining({ code: 'forbidden', requiredFeatures: ['test_module.users'] }))
    grantedFeatures = ['insights.simulator.*', 'test_module.*']
    findSimulationRunMock.mockResolvedValueOnce(storedRun({ status: 'running' }))
    expect((await recordsGet(request('GET', url()), params(RUN_ID))).status).toBe(409)
    expect(listMock).not.toHaveBeenCalled()
  })

  it('validates the page size (at most 100)', async () => {
    expect((await recordsGet(request('GET', url('?pageSize=101')), params(RUN_ID))).status).toBe(400)
    await recordsGet(request('GET', url()), params(RUN_ID))
    expect(listMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ page: 1, pageSize: 50 }))
  })
})
