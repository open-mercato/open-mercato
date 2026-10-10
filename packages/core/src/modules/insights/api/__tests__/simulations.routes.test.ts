/** @jest-environment node */
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'

const TENANT_ID = '11111111-0000-4000-8000-0000000000a1'
const ORG_ID = '22222222-0000-4000-8000-0000000000a1'
const USER_ID = '33333333-0000-4000-8000-0000000000a1'
const RUN_ID = '44444444-0000-4000-8000-0000000000a1'
const JOB_ID = '55555555-0000-4000-8000-0000000000a1'

const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()
const isOrganizationInTenantMock = jest.fn(async (..._args: unknown[]) => true)
const runRouteMutationGuardsMock = jest.fn()
const commandExecuteMock = jest.fn()
const findSimulationRunMock = jest.fn()
const findSimulationDecisionsMock = jest.fn(async (..._args: unknown[]) => [])
const listSimulationRunsMock = jest.fn()
let grantedFeatures: string[] = []

const container = {
  resolve: (name: string): unknown => {
    if (name === 'em') return { fork: () => ({}) }
    if (name === 'rbacService') return { userHasAllFeatures: async (_userId: string, required: string[]) => hasAllFeatures(required, grantedFeatures) }
    if (name === 'commandBus') return { execute: commandExecuteMock }
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
  return { ...actual, isOrganizationInTenant: (...args: unknown[]) => isOrganizationInTenantMock(...args) }
})
jest.mock('../../lib/simulation/store', () => {
  const actual = jest.requireActual('../../lib/simulation/store')
  return {
    ...actual,
    findSimulationRun: (...args: unknown[]) => findSimulationRunMock(...args),
    findSimulationDecisions: (...args: unknown[]) => findSimulationDecisionsMock(...args),
    listSimulationRuns: (...args: unknown[]) => listSimulationRunsMock(...args),
  }
})

import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { registerSimulateConfigEntries, resetSimulationRegistryForTests } from '../../lib/simulation/registry'
import { GET as listGet, POST as requestPost, metadata as collectionMetadata } from '../simulations/route'
import { GET as capabilitiesGet, metadata as capabilitiesMetadata } from '../simulations/capabilities/route'
import { GET as detailGet, metadata as detailMetadata } from '../simulations/[id]/route'
import { POST as cancelPost, metadata as cancelMetadata } from '../simulations/[id]/cancel/route'
import { POST as decisionPost, metadata as decisionMetadata } from '../simulations/[id]/decision/route'

function request(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const BASE = 'http://localhost/api/insights/simulations'
const params = (id: string) => ({ params: { id } })

function storedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    kind: 'test_module.backtest',
    status: 'completed',
    progressJobId: JOB_ID,
    requestedByUserId: USER_ID,
    inputJson: { name: 'p' },
    artifactKind: 'test_module.thing',
    artifactId: null,
    artifactVersionJson: null,
    proposalFingerprint: 'fp',
    windowFrom: new Date('2026-07-01T00:00:00Z'),
    windowTo: new Date('2026-10-01T00:00:00Z'),
    budgetsJson: { maxRecords: 50_000, maxDurationMs: 120_000, recordsUsed: 3, elapsedMs: 100, slices: 1 },
    fidelity: 'observed',
    coverageJson: { observed_rows: 3 },
    resultJson: { k: 10, truncated: false, groups: [{ key: 'test_module.thing.updated', labelKey: null, sampleResourceKind: null, total: 30, suppressed: false, cells: [{ key: 'fires', count: null, suppressed: 'below_k', sampleIds: [] }], warnings: [], flags: [] }] },
    caveats: ['test_module.caveat'],
    errorCode: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    startedAt: new Date('2026-10-01T00:00:01Z'),
    completedAt: new Date('2026-10-01T00:00:05Z'),
    expiresAt: new Date('2026-10-31T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:05Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetSimulationRegistryForTests()
  registerSimulateConfigEntries([{
    moduleId: 'test_module',
    config: {
      version: 1,
      kinds: [{
        kind: 'test_module.backtest',
        artifactKind: 'test_module.thing',
        labelKey: 'test_module.label',
        requiredFeatures: ['test_module.view', 'test_module.view_logs'],
        inputSchema: z.object({ name: z.string() }),
        version: 1,
        cellKeys: ['fires'],
        readArtifactVersion: async () => null,
        fingerprintProposal: () => 'fp',
        run: async () => ({ status: 'done' as const, recordsProcessed: 0, result: { groups: [], coverage: {}, caveats: [], fidelity: 'none' as const, truncated: false } }),
        applyHref: ({ runId }: { runId: string }) => `/backend/things?simulationRunId=${runId}`,
      }],
    },
  }])
  grantedFeatures = ['insights.simulator.*', 'test_module.*']
  getAuthFromRequestMock.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
  resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID], tenantId: TENANT_ID })
  isOrganizationInTenantMock.mockResolvedValue(true)
  runRouteMutationGuardsMock.mockResolvedValue({ ok: true, modifiedPayload: null, runAfterSuccess: async () => undefined })
  commandExecuteMock.mockResolvedValue({ result: { runId: RUN_ID, progressJobId: JOB_ID, status: 'queued', created: true } })
})

describe('simulation route metadata', () => {
  it('guards reads with insights.simulator.view and writes with insights.simulator.run', () => {
    expect(collectionMetadata).toEqual({
      GET: { requireAuth: true, requireFeatures: ['insights.simulator.view'] },
      POST: { requireAuth: true, requireFeatures: ['insights.simulator.run'] },
    })
    expect(capabilitiesMetadata.GET.requireFeatures).toEqual(['insights.simulator.view'])
    expect(detailMetadata.GET.requireFeatures).toEqual(['insights.simulator.view'])
    expect(cancelMetadata.POST.requireFeatures).toEqual(['insights.simulator.run'])
    expect(decisionMetadata.POST.requireFeatures).toEqual(['insights.simulator.run'])
  })
})

describe('POST /api/insights/simulations', () => {
  const body = { kind: 'test_module.backtest', artifactId: null, proposal: { name: 'p' }, window: { days: 30 } }

  it('queues a run (202) through the guarded command, with wildcard-granted kind features', async () => {
    const response = await requestPost(request('POST', BASE, body))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, runId: RUN_ID, progressJobId: JOB_ID, status: 'queued', deduplicated: false })
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ resourceKind: 'insights.simulation_run', operation: 'create', mutationPayload: { kind: 'test_module.backtest', artifactId: null } }),
    }))
    const command = commandExecuteMock.mock.calls[0]
    expect(command[0]).toBe('insights.simulation.request')
    expect(command[1].input).toEqual(expect.objectContaining({ tenantId: TENANT_ID, organizationId: ORG_ID, userId: USER_ID, kind: 'test_module.backtest', proposal: { name: 'p' } }))
    expect(Date.parse(command[1].input.windowTo) - Date.parse(command[1].input.windowFrom)).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('answers 200 for the caller\'s identical live run', async () => {
    commandExecuteMock.mockResolvedValue({ result: { runId: RUN_ID, progressJobId: JOB_ID, status: 'running', created: false } })
    const response = await requestPost(request('POST', BASE, body))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ deduplicated: true, status: 'running' }))
  })

  it('refuses unauthenticated callers, API keys and unresolved organizations', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce(null)
    expect((await requestPost(request('POST', BASE, body))).status).toBe(401)
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: 'api_key:1', tenantId: TENANT_ID, isApiKey: true })
    expect((await requestPost(request('POST', BASE, body))).status).toBe(403)
    resolveOrganizationScopeForRequestMock.mockResolvedValueOnce({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID })
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: USER_ID, tenantId: TENANT_ID, orgId: null })
    const scope = await requestPost(request('POST', BASE, body))
    expect(scope.status).toBe(400)
    expect(await scope.json()).toEqual({ error: 't:insights.simulation.errors.organization_scope_required', code: 'organization_scope_required' })
    isOrganizationInTenantMock.mockResolvedValueOnce(false)
    expect((await requestPost(request('POST', BASE, body))).status).toBe(400)
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  it('answers 403 without the kind\'s features and lists them', async () => {
    grantedFeatures = ['insights.simulator.*', 'test_module.view']
    const response = await requestPost(request('POST', BASE, body))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 't:insights.simulation.errors.forbidden', code: 'forbidden', requiredFeatures: ['test_module.view', 'test_module.view_logs'] })
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  it('validates the body, the kind, the proposal size and the window before anything runs', async () => {
    expect((await requestPost(request('POST', BASE, { ...body, extra: 1 }))).status).toBe(400)
    const unknown = await requestPost(request('POST', BASE, { ...body, kind: 'gone_module.kind' }))
    expect(unknown.status).toBe(422)
    expect((await unknown.json()).code).toBe('unsupported_kind')
    const tooLarge = await requestPost(request('POST', BASE, { ...body, proposal: { name: 'x'.repeat(70 * 1024) } }))
    expect(tooLarge.status).toBe(422)
    expect((await tooLarge.json()).code).toBe('proposal_too_large')
    const window = await requestPost(request('POST', BASE, { ...body, window: { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' } }))
    expect(window.status).toBe(422)
    expect((await window.json()).code).toBe('invalid_window')
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  it('returns the guard\'s response when a mutation guard blocks', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, response: new Response(JSON.stringify({ error: 'blocked' }), { status: 422 }) })
    expect((await requestPost(request('POST', BASE, body))).status).toBe(422)
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  it('passes the command\'s 429 and 422 answers through', async () => {
    commandExecuteMock.mockRejectedValueOnce(new CrudHttpError(429, { error: 'busy', code: 'simulation_busy' }))
    const busy = await requestPost(request('POST', BASE, body))
    expect(busy.status).toBe(429)
    expect((await busy.json()).code).toBe('simulation_busy')
    commandExecuteMock.mockRejectedValueOnce(new Error('boom: secret detail'))
    const failed = await requestPost(request('POST', BASE, body))
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 't:insights.simulation.errors.internal_error', code: 'internal_error' })
  })
})

describe('GET /api/insights/simulations/{id}', () => {
  it('returns the caller\'s run with its k-suppressed result', async () => {
    findSimulationRunMock.mockResolvedValue(storedRun())
    const response = await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(findSimulationRunMock).toHaveBeenCalledWith(expect.anything(), { scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, runId: RUN_ID, requesterUserId: USER_ID })
    expect(body.result).toEqual(expect.objectContaining({ id: RUN_ID, status: 'completed', canDecide: true, applyHref: `/backend/things?simulationRunId=${RUN_ID}`, caveats: ['test_module.caveat'] }))
    expect(body.result.result.groups[0].cells[0]).toEqual({ key: 'fires', count: null, suppressed: 'below_k', samples: [] })
  })

  it('answers one identical 404 for unknown, foreign, other-organization or expired runs and for lost kind features', async () => {
    findSimulationRunMock.mockResolvedValue(null)
    const missing = await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))
    const malformed = await detailGet(request('GET', `${BASE}/nope`), params('nope'))
    findSimulationRunMock.mockResolvedValue(storedRun())
    grantedFeatures = ['insights.simulator.*', 'test_module.view']
    const lostFeatures = await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))
    const bodies = await Promise.all([missing, malformed, lostFeatures].map((response) => response.json()))
    expect([missing.status, malformed.status, lostFeatures.status]).toEqual([404, 404, 404])
    expect(bodies[0]).toEqual({ error: 't:insights.simulation.errors.run_not_found', code: 'run_not_found' })
    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[2]).toEqual(bodies[0])
  })
})

describe('GET /api/insights/simulations and /capabilities', () => {
  it('lists only own runs of the kinds the caller may still read', async () => {
    listSimulationRunsMock.mockResolvedValue({ items: [storedRun()], total: 1 })
    const response = await listGet(request('GET', `${BASE}?page=1&pageSize=200`))
    expect(response.status).toBe(400)
    const ok = await listGet(request('GET', `${BASE}?page=1&pageSize=50`))
    expect(ok.status).toBe(200)
    expect(listSimulationRunsMock).toHaveBeenCalledWith(expect.anything(), { scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, requesterUserId: USER_ID, kinds: ['test_module.backtest'], page: 1, pageSize: 50 })
    grantedFeatures = ['insights.simulator.view']
    await listGet(request('GET', BASE))
    expect(listSimulationRunsMock).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ kinds: [] }))
  })

  it('lists runnable kinds wildcard-aware, and none without insights.simulator.run', async () => {
    const response = await capabilitiesGet(request('GET', `${BASE}/capabilities`))
    expect(await response.json()).toEqual(expect.objectContaining({ canRun: true, kinds: [{ kind: 'test_module.backtest', artifactKind: 'test_module.thing', labelKey: 'test_module.label', cellKeys: ['fires'], execution: 'queued' }] }))
    grantedFeatures = ['insights.simulator.view', 'test_module.*']
    expect(await (await capabilitiesGet(request('GET', `${BASE}/capabilities`))).json()).toEqual(expect.objectContaining({ canRun: false, kinds: [] }))
  })
})

describe('POST /api/insights/simulations/{id}/cancel and /decision', () => {
  it('cancels through the guarded command; only progress managers may reach other users\' runs', async () => {
    commandExecuteMock.mockResolvedValue({ result: { runId: RUN_ID, status: 'cancelled' } })
    const response = await cancelPost(request('POST', `${BASE}/${RUN_ID}/cancel`), params(RUN_ID))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, runId: RUN_ID, status: 'cancelled' })
    expect(commandExecuteMock).toHaveBeenLastCalledWith('insights.simulation.cancel', expect.objectContaining({ input: expect.objectContaining({ runId: RUN_ID, userId: USER_ID, allowForeign: false }) }))
    grantedFeatures = ['insights.simulator.*', 'progress.*']
    await cancelPost(request('POST', `${BASE}/${RUN_ID}/cancel`), params(RUN_ID))
    expect(commandExecuteMock).toHaveBeenLastCalledWith('insights.simulation.cancel', expect.objectContaining({ input: expect.objectContaining({ allowForeign: true }) }))
    commandExecuteMock.mockRejectedValueOnce(new CrudHttpError(409, { error: 'done', code: 'run_not_active' }))
    expect((await cancelPost(request('POST', `${BASE}/${RUN_ID}/cancel`), params(RUN_ID))).status).toBe(409)
    commandExecuteMock.mockRejectedValueOnce(new CrudHttpError(404, { error: 'missing', code: 'run_not_found' }))
    expect((await cancelPost(request('POST', `${BASE}/${RUN_ID}/cancel`), params(RUN_ID))).status).toBe(404)
  })

  it('records a decision for the caller\'s run only; the body carries the decision alone', async () => {
    findSimulationRunMock.mockResolvedValue(storedRun())
    commandExecuteMock.mockResolvedValue({ result: { id: 'd1', runId: RUN_ID, decision: { decision: 'applied', verified: true, artifactId: null, artifactUpdatedAtAfter: null, createdAt: '2026-10-02T00:00:00.000Z' } } })
    const response = await decisionPost(request('POST', `${BASE}/${RUN_ID}/decision`, { decision: 'applied' }), params(RUN_ID))
    expect(response.status).toBe(201)
    expect(commandExecuteMock).toHaveBeenLastCalledWith('insights.simulation.decision.record', expect.objectContaining({ input: { tenantId: TENANT_ID, organizationId: ORG_ID, runId: RUN_ID, userId: USER_ID, decision: 'applied' } }))
    expect((await decisionPost(request('POST', `${BASE}/${RUN_ID}/decision`, { decision: 'applied', verified: true }), params(RUN_ID))).status).toBe(400)
    findSimulationRunMock.mockResolvedValue(null)
    const foreign = await decisionPost(request('POST', `${BASE}/${RUN_ID}/decision`, { decision: 'applied' }), params(RUN_ID))
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toEqual({ error: 't:insights.simulation.errors.run_not_found', code: 'run_not_found' })
    findSimulationRunMock.mockResolvedValue(storedRun())
    commandExecuteMock.mockRejectedValueOnce(new CrudHttpError(409, { error: 'exists', code: 'decision_exists' }))
    expect((await decisionPost(request('POST', `${BASE}/${RUN_ID}/decision`, { decision: 'applied' }), params(RUN_ID))).status).toBe(409)
  })
})

describe('workflows trigger backtest through the simulation routes', () => {
  const triggerProposal = {
    workflowId: 'deal_followup',
    version: 1,
    enabled: true,
    triggers: [{ triggerId: 'deal_events', name: 'Deal events', eventPattern: 'customers.deal.*', enabled: true, priority: 0 }],
    startPreConditions: [],
  }

  beforeEach(async () => {
    const workflows = await import('../../../workflows/insights.simulate')
    const customers = await import('../../../customers/insights.simulate')
    registerSimulateConfigEntries([
      { moduleId: 'workflows', config: workflows.default },
      { moduleId: 'customers', config: customers.default },
    ])
  })

  it('answers 403 without workflows.definitions.view and lists the kind\'s features', async () => {
    grantedFeatures = ['insights.simulator.*', 'customers.*']
    const response = await requestPost(request('POST', BASE, { kind: 'workflows.trigger_backtest', artifactId: null, proposal: triggerProposal, window: { days: 30 } }))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 't:insights.simulation.errors.forbidden', code: 'forbidden', requiredFeatures: ['workflows.definitions.view'] })
    expect(commandExecuteMock).not.toHaveBeenCalled()
    grantedFeatures = ['insights.simulator.*', 'workflows.definitions.view']
    expect((await requestPost(request('POST', BASE, { kind: 'workflows.trigger_backtest', artifactId: null, proposal: triggerProposal, window: { days: 30 } }))).status).toBe(202)
  })

  it('lists the trigger backtest only for viewers of workflow definitions', async () => {
    grantedFeatures = ['insights.simulator.*', 'workflows.definitions.view']
    const allowed = await (await capabilitiesGet(request('GET', `${BASE}/capabilities`))).json()
    expect(allowed.kinds.map((kind: { kind: string }) => kind.kind)).toContain('workflows.trigger_backtest')
    grantedFeatures = ['insights.simulator.*', 'workflows.instances.view']
    const denied = await (await capabilitiesGet(request('GET', `${BASE}/capabilities`))).json()
    expect(denied.kinds.map((kind: { kind: string }) => kind.kind)).not.toContain('workflows.trigger_backtest')
  })

  it('answers the identical 404 for a trigger backtest run whose definition or record features the caller lost', async () => {
    const stored = storedRun({ kind: 'workflows.trigger_backtest', artifactKind: 'workflows.definition', inputJson: triggerProposal, resultJson: { k: 10, truncated: false, groups: [] } })
    findSimulationRunMock.mockResolvedValue(stored)
    grantedFeatures = ['insights.simulator.*', 'workflows.definitions.view', 'customers.deals.view']
    expect((await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).status).toBe(200)
    findSimulationRunMock.mockResolvedValue(null)
    const missing = await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))
    findSimulationRunMock.mockResolvedValue(stored)
    grantedFeatures = ['insights.simulator.*', 'customers.deals.view']
    const noDefinitions = await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))
    grantedFeatures = ['insights.simulator.*', 'workflows.definitions.view']
    const noRecords = await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))
    const decision = await decisionPost(request('POST', `${BASE}/${RUN_ID}/decision`, { decision: 'applied' }), params(RUN_ID))
    const bodies = await Promise.all([missing, noDefinitions, noRecords, decision].map((response) => response.json()))
    expect([missing.status, noDefinitions.status, noRecords.status, decision.status]).toEqual([404, 404, 404, 404])
    for (const body of bodies) expect(body).toEqual({ error: 't:insights.simulation.errors.run_not_found', code: 'run_not_found' })
  })
})

describe('catalog price backtest through the simulation routes', () => {
  const PRICE_ID = '66666666-0000-4000-8000-0000000000a1'
  const priceProposal = { priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '12.00' }
  const measures = [{ key: 'current_revenue', cell: 'priced_from_row', value: '300.00', currencyCode: 'EUR' }]

  function priceGroup(family: 'orders' | 'quotes') {
    return {
      key: `${family}:EUR:net`,
      labelKey: `sales.simulation.priceBacktest.families.${family}`,
      sampleResourceKind: family === 'orders' ? 'sales.order' : 'sales.quote',
      total: 20,
      suppressed: false,
      cells: [{ key: 'priced_from_row', count: 20, suppressed: null, sampleIds: [] }],
      warnings: [],
      flags: [],
      measures,
      requiredFeatures: [family === 'orders' ? 'sales.orders.view' : 'sales.quotes.view'],
    }
  }

  beforeEach(async () => {
    const catalog = await import('../../../catalog/insights.simulate')
    registerSimulateConfigEntries([{ moduleId: 'catalog', config: catalog.default }])
  })

  it('needs catalog.pricing.manage to request or list the price backtest', async () => {
    grantedFeatures = ['insights.simulator.*', 'sales.orders.view']
    const denied = await requestPost(request('POST', BASE, { kind: 'catalog.price_backtest', artifactId: PRICE_ID, proposal: priceProposal, window: { days: 30 } }))
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 't:insights.simulation.errors.forbidden', code: 'forbidden', requiredFeatures: ['catalog.pricing.manage'] })
    const hidden = await (await capabilitiesGet(request('GET', `${BASE}/capabilities`))).json()
    expect(hidden.kinds.map((kind: { kind: string }) => kind.kind)).not.toContain('catalog.price_backtest')
    grantedFeatures = ['insights.simulator.*', 'catalog.pricing.manage']
    const shown = await (await capabilitiesGet(request('GET', `${BASE}/capabilities`))).json()
    expect(shown.kinds).toContainEqual({ kind: 'catalog.price_backtest', artifactKind: 'catalog.price', labelKey: 'catalog.simulation.kind.priceBacktest', cellKeys: ['priced_from_row', 'manual_override', 'cannot_tell'], execution: 'queued' })
    expect((await requestPost(request('POST', BASE, { kind: 'catalog.price_backtest', artifactId: PRICE_ID, proposal: priceProposal, window: { days: 30 } }))).status).toBe(202)
  })

  it('re-checks each document family on read: a family the viewer may no longer read is left out with the coverage', async () => {
    findSimulationRunMock.mockResolvedValue(storedRun({
      kind: 'catalog.price_backtest',
      artifactKind: 'catalog.price',
      artifactId: PRICE_ID,
      inputJson: { priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: 12 },
      coverageJson: { orders_lines_scanned: 20, quotes_lines_scanned: 20 },
      caveats: ['catalog.simulation.caveats.priceIdBrowserOnly'],
      resultJson: { k: 5, truncated: false, groups: [priceGroup('orders'), priceGroup('quotes')] },
    }))
    grantedFeatures = ['insights.simulator.*', 'catalog.pricing.manage', 'sales.orders.view', 'sales.quotes.view']
    const both = (await (await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).json()).result
    expect(both.result.groups.map((group: { key: string }) => group.key)).toEqual(['orders:EUR:net', 'quotes:EUR:net'])
    expect(both.result.groups[0].measures).toEqual(measures)
    expect(both.result.groups[0]).not.toHaveProperty('requiredFeatures')
    expect(both.coverage).toEqual({ orders_lines_scanned: 20, quotes_lines_scanned: 20 })
    expect(both.caveats).toEqual(['catalog.simulation.caveats.priceIdBrowserOnly'])
    expect(both.budgets.recordsUsed).toBe(3)
    grantedFeatures = ['insights.simulator.*', 'catalog.pricing.manage', 'sales.orders.view']
    const ordersOnly = (await (await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).json()).result
    expect(ordersOnly.result.groups.map((group: { key: string }) => group.key)).toEqual(['orders:EUR:net'])
    expect(ordersOnly.coverage).toBeNull()
    expect(ordersOnly.budgets.recordsUsed).toBeNull()
    expect(ordersOnly.caveats).toEqual(['catalog.simulation.caveats.priceIdBrowserOnly', 'insights.simulation.caveats.groupsHidden'])
    grantedFeatures = ['insights.simulator.*', 'sales.orders.view', 'sales.quotes.view']
    expect((await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).status).toBe(404)
  })

  it('withholds the records read of any kind whenever a group or cell of its result is suppressed', async () => {
    grantedFeatures = ['insights.simulator.*', 'test_module.*']
    const group = { key: 'test_module.thing.updated', labelKey: null, sampleResourceKind: null, total: 30, suppressed: false, warnings: [], flags: [] }
    findSimulationRunMock.mockResolvedValue(storedRun({
      coverageJson: {},
      caveats: ['test_module.caveat', 'insights.simulation.caveats.coverageHidden'],
      resultJson: { k: 10, truncated: false, groups: [{ ...group, total: null, suppressed: true, cells: [{ key: 'fires', count: null, suppressed: 'below_k', sampleIds: [] }] }] },
    }))
    const groupHidden = (await (await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).json()).result
    expect(groupHidden.budgets).toEqual({ maxRecords: 50_000, maxDurationMs: 120_000, recordsUsed: null, elapsedMs: 100 })
    findSimulationRunMock.mockResolvedValue(storedRun({ coverageJson: {}, caveats: ['insights.simulation.caveats.coverageHiddenCells'] }))
    const cellHidden = (await (await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).json()).result
    expect(cellHidden.budgets.recordsUsed).toBeNull()
    findSimulationRunMock.mockResolvedValue(storedRun({ resultJson: { k: 10, truncated: false, groups: [{ ...group, cells: [{ key: 'fires', count: 30, suppressed: null, sampleIds: [] }] }] } }))
    const visible = (await (await detailGet(request('GET', `${BASE}/${RUN_ID}`), params(RUN_ID))).json()).result
    expect(visible.budgets.recordsUsed).toBe(3)
  })
})
