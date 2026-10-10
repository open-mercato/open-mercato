/** @jest-environment node */
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { StoredSuggestion } from '../../lib/suggestions/store'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_A = '22222222-0000-4000-8000-00000000000a'
const ORG_B = '22222222-0000-4000-8000-00000000000b'
const USER_ID = '33333333-0000-4000-8000-000000000001'
const SUGGESTION_ID = '66666666-0000-4000-8000-000000000001'
const WORKFLOW_ID = '55555555-0000-4000-8000-000000000001'

const reportErrorMock = jest.fn()
const getAuthFromRequestMock = jest.fn()
const resolveFeatureCheckContextMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()
const runRouteMutationGuardsMock = jest.fn()
const runAfterSuccessMock = jest.fn(async () => undefined)
const commandExecuteMock = jest.fn()
const listSuggestionsMock = jest.fn()
const findSuggestionMock = jest.fn()
const requestMiningMock = jest.fn(async (_container: unknown, _scope: unknown): Promise<{ status: string }> => ({ status: 'enqueued' }))
const isOrganizationInTenantMock = jest.fn(async () => true)
const grants: { byOrganization: Record<string, string[]> } = { byOrganization: {} }
const userHasAllFeaturesMock = jest.fn(async (_userId: string, required: string[], scope: { organizationId: string | null }) =>
  hasAllFeatures(required, grants.byOrganization[scope.organizationId ?? ''] ?? []))
const loadAclMock = jest.fn(async (_userId: string, scope: { organizationId: string | null }) => ({ isSuperAdmin: false, features: grants.byOrganization[scope.organizationId ?? ''] ?? [] }))
const draftService = { validateDraftDefinition: jest.fn(), getDefinitionForScope: jest.fn(), listAutomatedUpdates: jest.fn(async () => []) }
const services: { draft: typeof draftService | null } = { draft: draftService }

const container = {
  resolve: (name: string): unknown => {
    if (name === 'rbacService') return { userHasAllFeatures: userHasAllFeaturesMock, loadAcl: loadAclMock }
    if (name === 'workflowDraftService' && services.draft) return services.draft
    if (name === 'em') return { fork: () => ({ getKysely: () => ({ kind: 'db' }) }) }
    if (name === 'commandBus') return { execute: commandExecuteMock }
    throw new Error(`[internal] unexpected service ${name}`)
  },
}

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }) }))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => container }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: (...args: unknown[]) => resolveFeatureCheckContextMock(...args),
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args) }))
jest.mock('../../lib/suggestions/store', () => ({
  listSuggestions: (...args: unknown[]) => listSuggestionsMock(...args),
  findSuggestion: (...args: unknown[]) => findSuggestionMock(...args),
}))
jest.mock('../../lib/suggestions/request', () => ({
  requestXraySuggestionMining: (...args: unknown[]) => requestMiningMock(...(args as [unknown, unknown])),
}))
jest.mock('../../lib/projection/payloads', () => {
  const actual = jest.requireActual('../../lib/projection/payloads')
  return { ...actual, isOrganizationInTenant: (...args: unknown[]) => isOrganizationInTenantMock(...(args as [])) }
})
jest.mock('../../lib/suggestions/draft', () => {
  const actual = jest.requireActual('../../lib/suggestions/draft')
  return {
    ...actual,
    createDeclaredEventCatalog: () => ({ payloadPaths: (eventId: string) => (eventId === 'test.deal.created' ? new Set(['id', 'tenantId', 'organizationId']) : null) }),
  }
})
jest.mock('../../lib/process/registry', () => {
  const actual = jest.requireActual('../../lib/process/registry')
  const field = (key: string) => ({ key, labelKey: `test.fields.${key}`, valueKind: 'dictionary', snapshotPaths: [key], changeKeys: [key] })
  const process = (processKey: string, requiredFeatures: string[], automation: unknown) => ({
    moduleId: 'test',
    processKey,
    labelKey: `${processKey}.label`,
    resourceKind: processKey,
    logResourceKinds: [processKey],
    entityId: 'test:entity',
    requiredFeatures,
    stageFields: [field('status')],
    followupFields: [],
    milestones: [],
    exits: [],
    endStates: [],
    automation,
  })
  return {
    ...actual,
    getProcessRegistry: () => ({
      ready: true,
      contractHash: 'hash',
      processes: [
        process('test.deal', ['customers.deals.view'], { updateCommandId: 'customers.deals.update', recordIdInputKey: 'id', fieldInputKeys: { status: 'status' } }),
        process('test.order', ['sales.orders.view'], null),
      ],
      rejected: [],
      actorDimensionProviders: [],
    }),
  }
})

import { GET as listGet, metadata as listMetadata } from '../xray/suggestions/route'
import { GET as draftGet, metadata as draftMetadata } from '../xray/suggestions/[id]/draft/route'
import { PATCH as suggestionPatch, metadata as patchMetadata } from '../xray/suggestions/[id]/route'
import { POST as minePost, metadata as mineMetadata } from '../xray/suggestions/mine/route'

type Handler = (req: Request, context: { params: Record<string, string> }) => Promise<Response>

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function call(handler: Handler, req: Request, params: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handler(req, { params })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

function scopeOf(options: { selectedId?: string | null; filterIds?: string[] | null } = {}) {
  const selectedId = options.selectedId === undefined ? ORG_A : options.selectedId
  return {
    organizationId: selectedId,
    scope: { selectedId, filterIds: options.filterIds === undefined ? (selectedId ? [selectedId] : null) : options.filterIds, allowedIds: null, tenantId: TENANT_ID },
    allowedOrganizationIds: null,
  }
}

function suggestion(overrides: Partial<StoredSuggestion> = {}): StoredSuggestion {
  return {
    id: SUGGESTION_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_A,
    processKey: 'test.deal',
    signatureHash: 'a'.repeat(64),
    triggerActivityKey: 'created',
    trigger: { activityKey: 'created', activityKind: 'lifecycle', field: null, value: null, eventId: 'test.deal.created' },
    condition: null,
    followups: [{ field: 'status', value: 'qa_review', activityKind: 'stage', commandId: 'customers.deals.update' }],
    windowSeconds: 600,
    support: 9,
    triggerCount: 9,
    confidence: 0.7,
    lift: 3,
    distinctActorCount: 3,
    status: 'open',
    draftable: true,
    notDraftableReason: null,
    draftedArtifactId: null,
    computedAt: '2026-10-10T10:00:00.000Z',
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.123Z',
    ...overrides,
  }
}

const DEAL_VIEWER = ['insights.xray.view', 'customers.deals.view']
const DEAL_MANAGER = ['insights.xray.view', 'insights.xray.manage', 'customers.deals.view', 'customers.deals.manage']

beforeEach(() => {
  jest.clearAllMocks()
  grants.byOrganization = { [ORG_A]: DEAL_MANAGER, [ORG_B]: DEAL_MANAGER }
  services.draft = draftService
  getAuthFromRequestMock.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_A })
  resolveFeatureCheckContextMock.mockResolvedValue(scopeOf())
  resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: ORG_A, filterIds: [ORG_A], allowedIds: [ORG_A, ORG_B], tenantId: TENANT_ID })
  listSuggestionsMock.mockResolvedValue({ items: [suggestion()], total: 1 })
  findSuggestionMock.mockResolvedValue(suggestion())
  runRouteMutationGuardsMock.mockResolvedValue({ ok: true, modifiedPayload: null, runAfterSuccess: runAfterSuccessMock })
  commandExecuteMock.mockResolvedValue({ result: { id: SUGGESTION_ID, status: 'dismissed' } })
  draftService.validateDraftDefinition.mockImplementation(async (payload: unknown) => ({
    ok: true,
    payload,
    commands: [{ commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'] }],
    workflowIdAvailable: true,
  }))
  requestMiningMock.mockResolvedValue({ status: 'enqueued' })
  isOrganizationInTenantMock.mockResolvedValue(true)
})

describe('GET /api/insights/xray/suggestions', () => {
  it('declares insights.xray.view (list, draft), insights.xray.manage (update, mine)', () => {
    expect(listMetadata).toEqual({ GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] } })
    expect(draftMetadata).toEqual({ GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] } })
    expect(patchMetadata).toEqual({ PATCH: { requireAuth: true, requireFeatures: ['insights.xray.manage'] } })
    expect(mineMetadata).toEqual({ POST: { requireAuth: true, requireFeatures: ['insights.xray.manage'] } })
  })

  it('lists only the processes whose features the caller holds, each limited to its resolved organizations', async () => {
    grants.byOrganization = { [ORG_A]: DEAL_VIEWER }
    const response = await call(listGet, request('GET', '/api/insights/xray/suggestions?status=open&pageSize=10&page=2'))
    expect(response.status).toBe(200)
    expect(listSuggestionsMock).toHaveBeenCalledWith({ kind: 'db' }, {
      tenantId: TENANT_ID,
      visibility: [{ processKey: 'test.deal', organizationIds: [ORG_A] }],
      status: 'open',
      page: 2,
      pageSize: 10,
    })
    expect(response.body).toEqual(expect.objectContaining({ total: 1, page: 2, pageSize: 10, totalPages: 1 }))
    const [item] = response.body.items as Array<Record<string, unknown>>
    expect(item).toEqual(expect.objectContaining({ id: SUGGESTION_ID, processLabelKey: 'test.deal.label', updatedAt: '2026-10-10T10:00:00.123Z', distinctActorCount: 3 }))
    expect(JSON.stringify(response.body)).not.toMatch(/pseudonym|actorId|tk1:/)
  })

  it('labels each rule (trigger, condition, follow-ups) server-side, keeping the raw keys', async () => {
    listSuggestionsMock.mockResolvedValueOnce({
      items: [suggestion({ condition: { field: 'status', value: 'open' }, followups: [{ field: 'status', value: 'qa_review', activityKind: 'stage', commandId: null }] })],
      total: 1,
    })
    const response = await call(listGet, request('GET', '/api/insights/xray/suggestions'))
    const [item] = response.body.items as Array<{ trigger: { activityKey: string }; activityLabels: Record<string, string> }>
    expect(item.trigger.activityKey).toBe('created')
    expect(Object.keys(item.activityLabels).sort()).toEqual(['created', 'status:open', 'status:qa_review'])
    expect(item.activityLabels.created).toBe('insights.xray.ui.activity.created')
  })

  it('honours wildcard grants (insights.*, customers.*)', async () => {
    grants.byOrganization = { [ORG_A]: ['insights.*', 'customers.*'] }
    await call(listGet, request('GET', '/api/insights/xray/suggestions'))
    expect(listSuggestionsMock.mock.calls[0][1]).toEqual(expect.objectContaining({ visibility: [{ processKey: 'test.deal', organizationIds: [ORG_A] }], page: 1, pageSize: 50 }))
  })

  it('lists nothing for an unknown or invisible process, refuses page sizes over 100 and answers 403 without a tenant', async () => {
    expect((await call(listGet, request('GET', '/api/insights/xray/suggestions?processKey=test.unknown'))).body).toEqual({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 0 })
    grants.byOrganization = { [ORG_A]: DEAL_VIEWER }
    expect((await call(listGet, request('GET', '/api/insights/xray/suggestions?processKey=test.order'))).body).toEqual(expect.objectContaining({ items: [], total: 0 }))
    expect(listSuggestionsMock).not.toHaveBeenCalled()
    expect((await call(listGet, request('GET', '/api/insights/xray/suggestions?pageSize=101'))).status).toBe(400)
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: USER_ID, tenantId: null, orgId: null })
    resolveFeatureCheckContextMock.mockResolvedValueOnce({ organizationId: null, scope: { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }, allowedOrganizationIds: null })
    expect((await call(listGet, request('GET', '/api/insights/xray/suggestions'))).status).toBe(403)
  })

  it('maps an unexpected failure to the standard reported 500', async () => {
    listSuggestionsMock.mockRejectedValueOnce(new Error('relation does not exist (secret)'))
    const response = await call(listGet, request('GET', '/api/insights/xray/suggestions'))
    expect(response).toEqual({ status: 500, body: { error: 'insights.xray.errors.internal_error', code: 'internal_error', hint: null } })
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'insights.xray_route_failed', attributes: { route: 'xray.suggestions.list' } }))
  })
})

describe('GET /api/insights/xray/suggestions/{id}/draft', () => {
  const path = `/api/insights/xray/suggestions/${SUGGESTION_ID}/draft`

  it('returns a validated disabled draft when the caller holds the command features at the suggestion organization (persists nothing)', async () => {
    const response = await call(draftGet, request('GET', path), { id: SUGGESTION_ID })
    expect(response.status).toBe(200)
    expect(response.body).toEqual(expect.objectContaining({ ok: true, persisted: false, draftable: true, reason: null, workflowIdAvailable: true, suggestionId: SUGGESTION_ID }))
    const payload = response.body.payload as { enabled: boolean; lifecycle: string; definition: { triggers: Array<{ eventPattern: string }> } }
    expect(payload).toEqual(expect.objectContaining({ enabled: false, lifecycle: 'draft' }))
    expect(payload.definition.triggers[0].eventPattern).toBe('test.deal.created')
    expect(draftService.validateDraftDefinition).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT_ID, organizationId: ORG_A })
    expect(userHasAllFeaturesMock).toHaveBeenCalledWith(USER_ID, ['customers.deals.manage'], { tenantId: TENANT_ID, organizationId: ORG_A })
    expect(runRouteMutationGuardsMock).not.toHaveBeenCalled()
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  it('answers draftable false (command_forbidden) when the caller lacks the command features, wildcards honoured', async () => {
    grants.byOrganization = { [ORG_A]: DEAL_VIEWER }
    expect((await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).body).toEqual(expect.objectContaining({ draftable: false, reason: 'command_forbidden' }))
    grants.byOrganization = { [ORG_A]: ['insights.xray.view', 'customers.*'] }
    expect((await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).body).toEqual(expect.objectContaining({ draftable: true }))
  })

  it('recomputes the reason: a stage trigger is not expressible and the workflows module may be absent', async () => {
    findSuggestionMock.mockResolvedValueOnce(suggestion({ trigger: { activityKey: 'status:won', activityKind: 'stage', field: 'status', value: 'won', eventId: null } }))
    expect((await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).body).toEqual(expect.objectContaining({ draftable: false, reason: 'trigger_not_expressible' }))
    services.draft = null
    expect((await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).body).toEqual(expect.objectContaining({ draftable: false, reason: 'workflows_unavailable' }))
    expect(draftService.validateDraftDefinition).not.toHaveBeenCalled()
  })

  it('answers the identical 404 for unknown, malformed, invisible and out-of-scope suggestions', async () => {
    const notFound = { status: 404, body: { error: 'insights.xray.errors.suggestion_not_found', code: 'suggestion_not_found', hint: null } }
    findSuggestionMock.mockResolvedValueOnce(null)
    expect(await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).toEqual(notFound)
    expect(await call(draftGet, request('GET', '/api/insights/xray/suggestions/nope/draft'), { id: 'nope' })).toEqual(notFound)
    findSuggestionMock.mockResolvedValueOnce(suggestion({ processKey: 'test.order' }))
    expect(await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).toEqual(notFound)
    findSuggestionMock.mockResolvedValueOnce(suggestion({ processKey: 'test.unregistered' }))
    expect(await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).toEqual(notFound)
    findSuggestionMock.mockResolvedValueOnce(suggestion({ organizationId: ORG_B }))
    expect(await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).toEqual(notFound)
    resolveFeatureCheckContextMock.mockResolvedValue(scopeOf({ selectedId: null, filterIds: [ORG_A, ORG_B] }))
    grants.byOrganization = { [ORG_A]: DEAL_MANAGER, [ORG_B]: ['insights.xray.view'] }
    findSuggestionMock.mockResolvedValueOnce(suggestion({ organizationId: ORG_B }))
    expect(await call(draftGet, request('GET', path), { id: SUGGESTION_ID })).toEqual(notFound)
  })
})

describe('PATCH /api/insights/xray/suggestions/{id}', () => {
  const path = `/api/insights/xray/suggestions/${SUGGESTION_ID}`
  const lock = { 'x-om-ext-optimistic-lock-expected-updated-at': '2026-10-10T10:00:00.123Z' }

  it('runs the guards, then the command in the suggestion organization, and answers the updated view', async () => {
    findSuggestionMock.mockResolvedValueOnce(suggestion()).mockResolvedValueOnce(suggestion({ status: 'drafted', draftedArtifactId: WORKFLOW_ID, updatedAt: '2026-10-10T10:00:01.000Z' }))
    const response = await call(suggestionPatch, request('PATCH', path, { status: 'drafted', draftedArtifactId: WORKFLOW_ID }, lock), { id: SUGGESTION_ID })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, result: expect.objectContaining({ status: 'drafted', draftedArtifactId: WORKFLOW_ID, updatedAt: '2026-10-10T10:00:01.000Z' }) })
    expect(Object.keys((response.body.result as { activityLabels: Record<string, string> }).activityLabels).sort()).toEqual(['created', 'status:qa_review'])
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(expect.objectContaining({
      auth: { userId: USER_ID, tenantId: TENANT_ID, organizationId: ORG_A },
      input: { resourceKind: 'insights.xray_suggestion', resourceId: SUGGESTION_ID, operation: 'update', mutationPayload: { status: 'drafted', draftedArtifactId: WORKFLOW_ID } },
    }))
    expect(commandExecuteMock).toHaveBeenCalledWith('insights.xray.suggestion.update', {
      input: { status: 'drafted', draftedArtifactId: WORKFLOW_ID, tenantId: TENANT_ID, organizationId: ORG_A, id: SUGGESTION_ID },
      ctx: expect.objectContaining({ selectedOrganizationId: ORG_A, organizationIds: [ORG_A] }),
    })
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('returns the guard response and never runs the command when a guard blocks', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, response: Response.json({ error: 'blocked' }, { status: 422 }) })
    expect(await call(suggestionPatch, request('PATCH', path, { status: 'dismissed' }), { id: SUGGESTION_ID })).toEqual({ status: 422, body: { error: 'blocked' } })
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  it('applies a guard-modified payload after re-validating it', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: true, modifiedPayload: { status: 'open' }, runAfterSuccess: runAfterSuccessMock })
    await call(suggestionPatch, request('PATCH', path, { status: 'dismissed' }), { id: SUGGESTION_ID })
    expect(commandExecuteMock.mock.calls[0][1].input).toEqual(expect.objectContaining({ status: 'open' }))
  })

  it('passes the standard optimistic-lock 409 body through', async () => {
    commandExecuteMock.mockRejectedValueOnce(new CrudHttpError(409, { error: 'optimistic_lock_conflict', code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-10-10T10:00:05.000Z', expectedUpdatedAt: '2026-10-10T10:00:00.123Z' }))
    const response = await call(suggestionPatch, request('PATCH', path, { status: 'dismissed' }, lock), { id: SUGGESTION_ID })
    expect(response.status).toBe(409)
    expect(response.body).toEqual(expect.objectContaining({ code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-10-10T10:00:05.000Z', expectedUpdatedAt: '2026-10-10T10:00:00.123Z' }))
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('refuses an invalid body (400) and answers the identical 404 without insights.xray.manage at the suggestion organization', async () => {
    expect((await call(suggestionPatch, request('PATCH', path, { status: 'drafted' }), { id: SUGGESTION_ID })).status).toBe(400)
    expect((await call(suggestionPatch, request('PATCH', path, { status: 'superseded' }), { id: SUGGESTION_ID })).status).toBe(400)
    grants.byOrganization = { [ORG_A]: DEAL_VIEWER }
    expect(await call(suggestionPatch, request('PATCH', path, { status: 'dismissed' }), { id: SUGGESTION_ID })).toEqual({
      status: 404,
      body: { error: 'insights.xray.errors.suggestion_not_found', code: 'suggestion_not_found', hint: null },
    })
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/insights/xray/suggestions/mine', () => {
  const path = '/api/insights/xray/suggestions/mine'

  it('requests a forced pass of the selected organization after the guards', async () => {
    const response = await call(minePost as unknown as Handler, request('POST', path, {}))
    expect(response).toEqual({ status: 202, body: { ok: true, enqueued: true } })
    expect(requestMiningMock).toHaveBeenCalledWith(container, { tenantId: TENANT_ID, organizationId: ORG_A })
    expect(runRouteMutationGuardsMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ resourceKind: 'insights.xray_suggestion_mining', resourceId: ORG_A, operation: 'update' }),
    }))
    expect(runRouteMutationGuardsMock.mock.invocationCallOrder[0]).toBeLessThan(requestMiningMock.mock.invocationCallOrder[0])
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it('answers 202 without a second job while a requested pass is still pending (idempotent)', async () => {
    requestMiningMock.mockResolvedValueOnce({ status: 'pending' })
    expect(await call(minePost as unknown as Handler, request('POST', path, {}))).toEqual({ status: 202, body: { ok: true, enqueued: true } })
    expect(runAfterSuccessMock).toHaveBeenCalled()
  })

  it.each([
    ['disabled', 'Process X-Ray ingest is disabled for this organization.'],
    ['projection_incomplete', 'The process projection is still catching up. Try again once the backfill has finished.'],
    ['no_processes', 'No module declares a process for Process X-Ray.'],
    ['busy', 'Process X-Ray is busy. Try again in a moment.'],
  ])('refuses with 409 %s (translated) and runs no after-success callback', async (code, message) => {
    requestMiningMock.mockResolvedValueOnce({ status: code })
    expect(await call(minePost as unknown as Handler, request('POST', path, {}))).toEqual({ status: 409, body: { error: message, code } })
    expect(runAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('refuses a blocked guard and an invalid body without requesting a pass', async () => {
    runRouteMutationGuardsMock.mockResolvedValueOnce({ ok: false, response: Response.json({ error: 'blocked' }, { status: 422 }) })
    expect((await call(minePost as unknown as Handler, request('POST', path, {}))).status).toBe(422)
    expect((await call(minePost as unknown as Handler, request('POST', path, { force: true }))).status).toBe(400)
    expect(requestMiningMock).not.toHaveBeenCalled()
  })
})
