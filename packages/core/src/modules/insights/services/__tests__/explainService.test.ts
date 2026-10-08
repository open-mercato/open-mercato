import type { ExplainFieldResponse, ExplainOverviewResponse } from '../../data/validators'
import { encodeExplainCursor } from '../../data/validators'
import {
  DEAL_ID,
  OTHER_ORG_DEAL_ID,
  OTHER_USER_ID,
  ORG_A,
  ORG_B,
  TENANT_ID,
  VIEWER_ID,
  WORKFLOW_ID,
  buildService,
  buildViewer,
  deals,
  historyEntry,
  registerTestExplainConfig,
  resetDeals,
  statusReferenceResolver,
  testExplainConfig,
  testLogId,
  workflowResolver,
  type HistoryStore,
} from '../../__tests__/explainTestSupport'
import type { ExplainViewer } from '../../lib/viewer'

const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => [
    { id: '33333333-0000-4000-8000-000000000002', name: 'Other User', email: 'other@example.com' },
    { id: '33333333-0000-4000-8000-000000000001', name: '', email: 'viewer@example.com' },
  ]),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

const ALL_FEATURES = ['insights.*', 'test.deals.view', 'test.deals.secret', 'workflows.instances.view', 'audit_logs.view_tenant', 'audit_logs.view_self']
const NOT_FOUND = { ok: false, status: 404, body: { error: 'not_found' } }

let granted: string[] = ALL_FEATURES
let store: HistoryStore

function service() {
  return buildService(store, () => granted)
}

async function explainField(query: Partial<{ field: string; itemId: string; limit: number; before: string; resourceId: string; resourceKind: string }> = {}) {
  const { service: explainService, actionLogService } = service()
  const outcome = await explainService.explain(buildViewer(), {
    resourceKind: 'test.deal',
    resourceId: DEAL_ID,
    field: 'status',
    limit: 20,
    ...query,
  })
  return { outcome, actionLogService }
}

function fieldBody(outcome: Awaited<ReturnType<typeof explainField>>['outcome']): ExplainFieldResponse {
  if (!outcome.ok) throw new Error(`[internal] expected success, got ${outcome.status}`)
  return outcome.body as ExplainFieldResponse
}

beforeEach(() => {
  registerTestExplainConfig()
  resetDeals()
  granted = ALL_FEATURES
  workflowResolver.mockClear()
  statusReferenceResolver.mockClear()
  reportErrorMock.mockClear()
  store = {
    entries: [
      historyEntry({ at: '2026-10-08T07:00:00.000Z', from: 'open', to: 'won' }),
      historyEntry({ at: '2026-10-08T06:00:00.000Z', from: 'new', to: 'open', actorUserId: VIEWER_ID, causeKind: 'user', causeId: null, causation: { correlationId: 'c', frames: [{ kind: 'user' }] } }),
    ],
    scopes: [],
  }
})

describe('ExplainService.explain — not found and validation', () => {
  it('returns the same not_found outcome for unknown kinds, missing features, invisible and out-of-scope records', async () => {
    const { service: explainService } = service()
    const viewer = buildViewer()
    const unknownKind = await explainService.explain(viewer, { resourceKind: 'nope.kind', resourceId: DEAL_ID, field: 'status', limit: 20 })
    const missingRecord = await explainService.explain(viewer, { resourceKind: 'test.deal', resourceId: '44444444-0000-4000-8000-0000000000ff', field: 'status', limit: 20 })
    const otherOrg = await explainService.explain(viewer, { resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status', limit: 20 })
    granted = ['insights.explain.view']
    const missingFeature = await service().service.explain(viewer, { resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status', limit: 20 })

    for (const outcome of [unknownKind, missingRecord, otherOrg, missingFeature]) expect(outcome).toEqual(NOT_FOUND)
  })

  it('returns not_found without loading anything for an empty organization scope', async () => {
    const { service: explainService, actionLogService } = service()
    const outcome = await explainService.explain(buildViewer({ organizationIds: [] }), {
      resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status', limit: 20,
    })
    expect(outcome).toEqual(NOT_FOUND)
    expect(actionLogService.findFieldHistory).not.toHaveBeenCalled()
  })

  it('rejects a record that loadCurrent returned from another organization', async () => {
    const { service: explainService } = service()
    const outcome = await explainService.explain(buildViewer({ organizationIds: null }), {
      resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status', limit: 20,
    })
    expect(outcome.ok).toBe(true)
    const restricted = await explainService.explain(buildViewer({ organizationIds: [ORG_A] }), {
      resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status', limit: 20,
    })
    expect(restricted).toEqual(NOT_FOUND)
  })

  it.each([
    ['an undeclared field', { field: 'title' }, 'unknown_field'],
    ['a field the viewer cannot read', { field: 'secret' }, 'unknown_field'],
    ['a custom field outside allowKeys', { field: 'cf:internal' }, 'unknown_field'],
    ['a collection field without itemId', { field: 'lines.price' }, 'item_required'],
    ['an itemId on a scalar field', { field: 'status', itemId: 'line-1' }, 'item_not_supported'],
  ])('returns 400 for %s', async (_label, query, error) => {
    if (query.field === 'secret') granted = ALL_FEATURES.filter((feature) => feature !== 'test.deals.secret')
    const { outcome } = await explainField(query)
    expect(outcome).toEqual({ ok: false, status: 400, body: { error } })
  })

  it('returns not_found for a collection item that does not exist on the record', async () => {
    const { outcome } = await explainField({ field: 'lines.price', itemId: 'missing' })
    expect(outcome).toEqual(NOT_FOUND)
  })
})

describe('ExplainService.explain — field explanation', () => {
  it('explains a field for a tenant auditor with actors, values and resolved causes', async () => {
    const { outcome, actionLogService } = await explainField()
    const body = fieldBody(outcome)

    expect(actionLogService.findFieldHistory).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      organizationIds: [ORG_A],
      resourceKinds: ['test.deal'],
      resourceId: DEAL_ID,
      includeChildren: false,
    }))
    expect(body.verdict).toBe('explained')
    expect(body.confidence).toBe('proven')
    expect(body.current).toEqual({ value: 'won', display: 'Label won', valueKind: 'enum' })
    expect(body.viewer).toEqual({ canSeeActors: true, canSeePastValues: true, canSeeOwnValues: true })
    const [head, older] = body.chain
    expect(head.actor).toEqual({ kind: 'user', id: OTHER_USER_ID, label: 'Other User', isSelf: false, redacted: false })
    expect(head.from).toEqual({ value: 'open', display: 'Label open', valueKind: 'enum', source: 'snapshot', redacted: false })
    expect(head.cause).toEqual(expect.objectContaining({
      kind: 'workflow',
      id: WORKFLOW_ID,
      label: 'Workflow 5555',
      href: `/backend/instances/${WORKFLOW_ID}`,
      available: true,
      labelKey: 'insights.explain.causeKinds.workflow',
    }))
    expect(head.cause.frames.map((frame) => frame.kind)).toEqual(['user', 'workflow'])
    expect(head.origin).toEqual(expect.objectContaining({ kind: 'user', available: true }))
    expect(older.actor).toEqual(expect.objectContaining({ id: VIEWER_ID, label: 'viewer@example.com', isSelf: true }))
    expect(workflowResolver).toHaveBeenCalledTimes(1)
    expect(body.page).toEqual({ limit: 20, nextBefore: null, scanned: 2, truncated: false, continuation: false })
  })

  it('redacts other users and their past values for a view_self viewer but keeps own changes and the current value', async () => {
    granted = ALL_FEATURES.filter((feature) => feature !== 'audit_logs.view_tenant')
    const body = fieldBody((await explainField()).outcome)

    expect(body.viewer).toEqual({ canSeeActors: false, canSeePastValues: false, canSeeOwnValues: true })
    expect(body.current.value).toBe('won')
    const [head, own] = body.chain
    expect(head.actor).toEqual({ kind: 'user', id: null, label: null, isSelf: false, redacted: true })
    expect(head.from).toEqual({ value: null, display: null, valueKind: 'enum', source: 'snapshot', redacted: true })
    expect(head.to?.redacted).toBe(true)
    expect(own.actor).toEqual(expect.objectContaining({ id: VIEWER_ID, isSelf: true, redacted: false }))
    expect(own.to).toEqual(expect.objectContaining({ value: 'open', redacted: false }))
    expect(JSON.stringify(body)).not.toContain(OTHER_USER_ID)
    expect(JSON.stringify(body)).not.toContain('Other User')
  })

  it('redacts even own past values for a viewer without any audit feature', async () => {
    granted = ['insights.explain.view', 'test.deals.view', 'workflows.instances.view']
    const body = fieldBody((await explainField()).outcome)

    expect(body.viewer).toEqual({ canSeeActors: false, canSeePastValues: false, canSeeOwnValues: false })
    expect(body.chain.every((entry) => entry.from?.redacted && entry.to?.redacted)).toBe(true)
    expect(body.chain[1].actor).toEqual(expect.objectContaining({ id: VIEWER_ID, isSelf: true }))
    expect(body.current.value).toBe('won')
  })

  it('marks causes unavailable when the resolver features are missing', async () => {
    granted = ALL_FEATURES.filter((feature) => feature !== 'workflows.instances.view')
    const body = fieldBody((await explainField()).outcome)

    expect(body.chain[0].cause).toEqual(expect.objectContaining({ kind: 'workflow', id: null, label: null, available: false }))
    expect(workflowResolver).not.toHaveBeenCalled()
  })

  it('marks causes unavailable when their target belongs to another organization', async () => {
    const otherWorkflow = '55555555-0000-4000-8000-0000000000b0'
    store.entries[0] = historyEntry({
      at: '2026-10-08T07:00:00.000Z',
      causeId: otherWorkflow,
      causation: { correlationId: 'c', frames: [{ kind: 'workflow', id: otherWorkflow }] },
    })
    const body = fieldBody((await explainField()).outcome)

    expect(body.chain[0].cause).toEqual(expect.objectContaining({ id: null, available: false }))
  })

  it('presents a caused_by_log_id in another organization exactly like a missing one', async () => {
    const missing = testLogId()
    const inOtherOrg = testLogId()
    const visible = testLogId()
    store.entries[0] = historyEntry({ at: '2026-10-08T07:00:00.000Z', causedByLogId: missing })
    store.entries[1] = historyEntry({ at: '2026-10-08T06:00:00.000Z', from: 'new', to: 'open', causedByLogId: inOtherOrg })
    store.entries.push(historyEntry({ at: '2026-10-08T05:00:00.000Z', from: 'x', to: 'new', causedByLogId: visible }))
    store.scopes = [
      { id: inOtherOrg, organizationId: ORG_B, resourceKind: 'other', resourceId: 'x' },
      { id: visible, organizationId: ORG_A, resourceKind: 'other', resourceId: 'y' },
    ]
    const body = fieldBody((await explainField()).outcome)

    const [missingEntry, otherOrgEntry, visibleEntry] = body.chain
    expect(missingEntry.causedBy).toEqual({ logId: null, available: false })
    expect(otherOrgEntry.causedBy).toEqual(missingEntry.causedBy)
    expect(missingEntry.confidence).toBe('inferred')
    expect(otherOrgEntry.confidence).toBe(missingEntry.confidence)
    expect(visibleEntry.causedBy).toEqual({ logId: visible, available: true })
    expect(visibleEntry.confidence).toBe('proven')
    expect(body.hints.filter((hint) => hint.key === 'insights.explain.hints.danglingCause')).toEqual([
      { key: 'insights.explain.hints.danglingCause', params: {} },
    ])
  })

  it('links undo traces to a visible source log', async () => {
    const source = historyEntry({ at: '2026-10-08T06:30:00.000Z', from: 'open', to: 'lost', executionState: 'undone' })
    const trace = historyEntry({
      at: '2026-10-08T06:45:00.000Z',
      from: 'lost',
      to: 'open',
      causeKind: 'undo',
      causeId: source.logId,
      causation: { correlationId: 'c', frames: [{ kind: 'user' }, { kind: 'undo', id: source.logId }] },
      historyAction: 'undo',
      sourceLogId: source.logId,
    })
    store.entries.push(source, trace)
    const body = fieldBody((await explainField()).outcome)

    const undo = body.chain.find((entry) => entry.logId === trace.logId)
    const undone = body.chain.find((entry) => entry.logId === source.logId)
    expect(undo?.cause).toEqual(expect.objectContaining({ kind: 'undo', id: source.logId, available: true }))
    expect(undone).toEqual(expect.objectContaining({ state: 'undone', undoneBy: trace.logId }))
    expect(body.gaps).toEqual([])
  })

  it('paginates the chain with an opaque cursor and continues from it', async () => {
    const first = fieldBody((await explainField({ limit: 1 })).outcome)
    expect(first.chain).toHaveLength(1)
    expect(first.page.nextBefore).toBe(encodeExplainCursor({ at: '2026-10-08T07:00:00.000000Z', id: store.entries[0].logId }))

    const { outcome, actionLogService } = await explainField({ limit: 1, before: first.page.nextBefore ?? undefined })
    const second = fieldBody(outcome)
    expect(actionLogService.findFieldHistory).toHaveBeenCalledWith(expect.objectContaining({
      before: { at: '2026-10-08T07:00:00.000000Z', id: store.entries[0].logId },
    }))
    expect(second.chain.map((entry) => entry.logId)).toEqual([store.entries[1].logId])
    expect(second.page.continuation).toBe(true)
    expect(second.page.nextBefore).toBeNull()
  })

  it('reports truncation and caps confidence when the scan budget is exhausted', async () => {
    const { service: limited } = buildService(store, () => granted, { scanMax: 1 })
    const outcome = await limited.explain(buildViewer(), { resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status', limit: 20 })
    const body = fieldBody(outcome)

    expect(body.page.truncated).toBe(true)
    expect(body.page.scanned).toBe(1)
    expect(body.confidence).toBe('inferred')
    expect(body.page.nextBefore).toBe(encodeExplainCursor({ at: '2026-10-08T07:00:00.000000Z', id: store.entries[0].logId }))
  })

  it('explains allowed custom fields from snapshot containers', async () => {
    store.entries = [historyEntry({
      at: '2026-10-08T07:00:00.000Z',
      changedFields: ['cf_priority'],
      changes: { cf_priority: { from: 'low', to: 'high' } },
      snapshotBefore: { custom: { priority: 'low' } },
      snapshotAfter: { custom: { priority: 'high' } },
    })]
    const body = fieldBody((await explainField({ field: 'cf:priority' })).outcome)

    expect(body.field).toBe('cf:priority')
    expect(body.current.value).toBe('high')
    expect(body.verdict).toBe('explained')
  })

  it('scans history by the canonical lowercase record id', async () => {
    const mixedCaseId = '4444aaaa-0000-4000-8000-0000000000ab'
    deals[mixedCaseId] = { ...deals[DEAL_ID], id: mixedCaseId }
    store.entries = [historyEntry({ at: '2026-10-08T07:00:00.000Z', resourceId: mixedCaseId })]
    const { outcome, actionLogService } = await explainField({ resourceId: mixedCaseId.toUpperCase() })
    const body = fieldBody(outcome)

    expect(actionLogService.findFieldHistory).toHaveBeenCalledWith(expect.objectContaining({ resourceId: mixedCaseId }))
    expect(body.resourceId).toBe(mixedCaseId)
    expect(body.verdict).toBe('explained')
    expect(body.chain).toHaveLength(1)
  })

  it('shows tenant-level reference details only to tenant-wide viewers', async () => {
    const tenantLevelLabels = async (_ctx: unknown, ids: string[]) => ids.map((id) => ({
      kind: 'test.status',
      id,
      label: `Label ${id}`,
      href: null,
      organizationId: null,
    }))
    statusReferenceResolver.mockImplementationOnce(tenantLevelLabels).mockImplementationOnce(tenantLevelLabels)
    const { service: explainService } = service()

    const restricted = fieldBody(await explainService.explain(buildViewer(), { resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status', limit: 20 }))
    const tenantWide = fieldBody(await explainService.explain(buildViewer({ organizationIds: null }), { resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status', limit: 20 }))

    expect(restricted.current.display).toBeNull()
    expect(tenantWide.current.display).toBe('Label won')
  })

  it('queries resolvers only in the record organization and drops details from other organizations', async () => {
    statusReferenceResolver.mockImplementationOnce(async (_ctx, ids: string[]) => ids.map((id) => ({
      kind: 'test.status',
      id,
      label: `Other org ${id}`,
      href: null,
      organizationId: ORG_B,
    })))
    const { service: explainService } = service()
    const body = fieldBody(await explainService.explain(buildViewer({ organizationIds: [ORG_A, ORG_B], rbacOrganizationId: null }), {
      resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status', limit: 20,
    }))

    const [resolverContext] = statusReferenceResolver.mock.calls[0]
    expect(resolverContext.scope).toEqual({ tenantId: TENANT_ID, organizationIds: [ORG_A] })
    const [workflowContext] = workflowResolver.mock.calls[0]
    expect(workflowContext.scope).toEqual({ tenantId: TENANT_ID, organizationIds: [ORG_A] })
    expect(body.current.display).toBeNull()
  })

  it('shows tenant-level code identifier causes to organization-restricted viewers', async () => {
    const config = testExplainConfig()
    const subscriberResolver = jest.fn(async (_ctx: unknown, ids: string[]) => ids.map((id) => ({
      kind: 'subscriber' as const,
      id,
      label: 'Deal reconciler',
      href: null,
      organizationId: null,
    })))
    registerTestExplainConfig({
      ...config,
      causeResolvers: [...(config.causeResolvers ?? []), { kind: 'subscriber', requiredFeatures: ['test.deals.view'], resolve: subscriberResolver }],
    })
    store.entries = [historyEntry({
      at: '2026-10-08T07:00:00.000Z',
      causeKind: 'subscriber',
      causeId: 'customers.reconcile',
      causation: { correlationId: 'c', frames: [{ kind: 'subscriber', id: 'customers.reconcile' }] },
    })]
    const body = fieldBody((await explainField()).outcome)

    expect(body.chain[0].cause).toEqual(expect.objectContaining({ kind: 'subscriber', id: 'customers.reconcile', label: 'Deal reconciler', available: true }))
  })

  it('reports unexplained values with the current_differs gap', async () => {
    deals[DEAL_ID].status = 'lost'
    const body = fieldBody((await explainField()).outcome)

    expect(body.verdict).toBe('unexplained')
    expect(body.confidence).toBe('unknown')
    expect(body.gaps[0]).toEqual(expect.objectContaining({ reason: 'current_differs', afterLogId: store.entries[0].logId }))
  })
})

describe('ExplainService.explain — overview', () => {
  it('summarizes every readable field with one history scan', async () => {
    store.entries.push(historyEntry({ at: '2026-10-08T05:00:00.000Z', causeKind: null, causeId: null, causation: null, from: 'x', to: 'new' }))
    const { service: explainService, actionLogService } = service()
    granted = ALL_FEATURES.filter((feature) => feature !== 'test.deals.secret')
    const outcome = await explainService.explain(buildViewer(), { resourceKind: 'test.deal', resourceId: DEAL_ID, limit: 20 })
    if (!outcome.ok) throw new Error('[internal] expected overview')
    const body = outcome.body as ExplainOverviewResponse

    expect(actionLogService.findFieldHistory).toHaveBeenCalledTimes(1)
    expect(body.fields.map((field) => field.field)).toEqual(['status', 'cf:priority'])
    expect(body.fields[0]).toEqual(expect.objectContaining({ verdict: 'explained', confidence: 'proven', lastChangeAt: '2026-10-08T07:00:00.000Z' }))
    expect(body.coverage).toEqual({
      scanned: 3,
      truncated: false,
      legacyRows: 1,
      causeKinds: { workflow: 1, user: 1, legacy: 1 },
      noHistory: null,
      unloggedWriters: [],
    })
  })
})

describe('ExplainService — feature checks bound to the record organization', () => {
  const BASE_GRANTS = ['insights.explain.view', 'test.deals.view', 'workflows.instances.view']
  const AUDIT_GRANTS = ['audit_logs.view_tenant', 'audit_logs.view_self', 'test.deals.secret']

  function grantsAuditOnlyInOrgA(organizationId: string | null): string[] {
    if (organizationId === ORG_B) return BASE_GRANTS
    return [...BASE_GRANTS, ...AUDIT_GRANTS]
  }

  const allOrganizations = (): ExplainViewer => buildViewer({ organizationIds: [ORG_A, ORG_B], rbacOrganizationId: null })

  beforeEach(() => {
    store.entries = [historyEntry({ at: '2026-10-08T07:00:00.000Z', resourceId: OTHER_ORG_DEAL_ID, organizationId: ORG_B, from: 'new', to: 'open' })]
  })

  it('does not apply audit visibility granted by a role limited to another organization', async () => {
    const { service: explainService, rbacService } = buildService(store, grantsAuditOnlyInOrgA)
    const body = fieldBody(await explainService.explain(allOrganizations(), {
      resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status', limit: 20,
    }))

    expect(body.viewer).toEqual({ canSeeActors: false, canSeePastValues: false, canSeeOwnValues: false })
    expect(body.chain[0].actor).toEqual(expect.objectContaining({ id: null, redacted: true }))
    expect(body.chain[0].from).toEqual(expect.objectContaining({ value: null, redacted: true }))
    expect(JSON.stringify(body)).not.toContain(OTHER_USER_ID)
    expect(rbacService.userHasAllFeatures).toHaveBeenCalledWith(
      VIEWER_ID,
      ['audit_logs.view_tenant'],
      { tenantId: TENANT_ID, organizationId: ORG_B },
    )
  })

  it('evaluates field features at the record organization', async () => {
    const { service: explainService } = buildService(store, grantsAuditOnlyInOrgA)
    const outcome = await explainService.explain(allOrganizations(), {
      resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'secret', limit: 20,
    })

    expect(outcome).toEqual({ ok: false, status: 400, body: { error: 'unknown_field' } })
  })

  it('returns not_found when the resource feature is granted only in another organization', async () => {
    const grants = (organizationId: string | null) => (organizationId === ORG_B ? ['insights.explain.view'] : ALL_FEATURES)
    const { service: explainService } = buildService(store, grants)
    const outcome = await explainService.explain(allOrganizations(), {
      resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status', limit: 20,
    })

    expect(outcome).toEqual(NOT_FOUND)
  })

  it('does not deny before loading when the home organization is outside a feature-narrowed scope', async () => {
    const grantsOnlyInOrgB = (organizationId: string | null) => (organizationId === ORG_B ? ALL_FEATURES : [])
    const { service: explainService } = buildService(store, grantsOnlyInOrgB)
    const outcome = await explainService.explain(buildViewer({ organizationIds: [ORG_B], rbacOrganizationId: ORG_A }), {
      resourceKind: 'test.deal', resourceId: OTHER_ORG_DEAL_ID, field: 'status', limit: 20,
    })

    expect(outcome.ok).toBe(true)
  })

  it('evaluates explainLog visibility at the entry organization', async () => {
    const { service: explainService } = buildService(store, grantsAuditOnlyInOrgA)
    const outcome = await explainService.explainLog(allOrganizations(), store.entries[0].logId)

    expect(outcome).toEqual(NOT_FOUND)
  })

  it('re-resolves the explainLog scope with the owning resource features before loading the record', async () => {
    const { service: explainService } = buildService(store, () => ALL_FEATURES)
    const rescope = jest.fn(async () => buildViewer({ organizationIds: [ORG_A] }))
    const hidden = await explainService.explainLog(allOrganizations(), store.entries[0].logId, { rescope })

    expect(rescope).toHaveBeenCalledWith(['insights.explain.view', 'test.deals.view'])
    expect(hidden).toEqual(NOT_FOUND)

    const widened = jest.fn(async () => allOrganizations())
    const shown = await explainService.explainLog(allOrganizations(), store.entries[0].logId, { rescope: widened })
    expect(shown.ok).toBe(true)
  })
})

describe('ExplainService — error reporting', () => {
  it('logs a loader failure and leaves reporting to the route boundary', async () => {
    const config = testExplainConfig()
    const [resource] = config.resources ?? []
    registerTestExplainConfig({
      ...config,
      resources: [{ ...resource, loadCurrent: async () => { throw new Error('[internal] loader down') } }],
    })

    await expect(service().service.explain(buildViewer(), {
      resourceKind: 'test.deal', resourceId: DEAL_ID, field: 'status', limit: 20,
    })).rejects.toThrow('loader down')
    expect(reportErrorMock).not.toHaveBeenCalled()
  })
})

describe('ExplainService.describe', () => {
  it('lists only resources and fields the viewer may read', async () => {
    granted = ['insights.explain.view', 'test.deals.view']
    const body = await service().service.describe(buildViewer())

    expect(body.resources).toHaveLength(1)
    expect(body.resources[0]).toEqual(expect.objectContaining({
      resourceKind: 'test.deal',
      customFields: { entityId: 'test:deal', allowKeys: ['priority'] },
    }))
    expect(body.resources[0].fields.map((field) => field.key)).toEqual(['status'])
    expect(body.resources[0].fields[0]).toEqual(expect.objectContaining({ key: 'status', currentPath: 'status' }))
    expect(body.resources[0].collections[0].fields.map((field) => field.key)).toEqual(['price'])
    expect(body.resources[0].collections[0].fields[0].currentPath).toBeNull()
  })

  it('lists only dependencies the viewer may read', async () => {
    const config = testExplainConfig()
    const [resource] = config.resources ?? []
    registerTestExplainConfig({
      ...config,
      resources: [{
        ...resource,
        fields: [
          ...resource.fields,
          { key: 'total', labelKey: 'test.fields.total', valueKind: 'money', snapshotPaths: ['deal.total'], derived: { dependsOn: ['secret', 'status', 'lines'] } },
        ],
      }],
    })
    granted = ['insights.explain.view', 'test.deals.view']
    const body = await service().service.describe(buildViewer())

    const total = body.resources[0].fields.find((field) => field.key === 'total')
    expect(total).toEqual(expect.objectContaining({ derived: true, dependsOn: ['status', 'lines'] }))
  })

  it('returns nothing without the resource feature or the explain feature', async () => {
    granted = ['insights.explain.view']
    expect((await service().service.describe(buildViewer())).resources).toEqual([])
    granted = ['test.deals.view']
    expect((await service().service.describe(buildViewer())).resources).toEqual([])
  })
})

describe('ExplainService.explainLog', () => {
  it('explains the cause of a visible entry', async () => {
    const entry = store.entries[0]
    const outcome = await service().service.explainLog(buildViewer(), entry.logId)
    if (!outcome.ok) throw new Error('[internal] expected log explanation')

    expect(outcome.body).toEqual(expect.objectContaining({
      logId: entry.logId,
      resourceKind: 'test.deal',
      state: 'done',
      confidence: 'proven',
      cause: expect.objectContaining({ kind: 'workflow', available: true }),
    }))
  })

  it('hides entries of other users from view_self viewers and allows their own', async () => {
    granted = ALL_FEATURES.filter((feature) => feature !== 'audit_logs.view_tenant')
    const others = await service().service.explainLog(buildViewer(), store.entries[0].logId)
    const own = await service().service.explainLog(buildViewer(), store.entries[1].logId)

    expect(others).toEqual(NOT_FOUND)
    expect(own.ok).toBe(true)
  })

  it('returns not_found for entries outside the organization scope or of invisible records', async () => {
    const foreign = historyEntry({ organizationId: ORG_B, resourceId: OTHER_ORG_DEAL_ID })
    store.entries.push(foreign)
    expect(await service().service.explainLog(buildViewer(), foreign.logId)).toEqual(NOT_FOUND)

    delete deals[DEAL_ID]
    expect(await service().service.explainLog(buildViewer(), store.entries[0].logId)).toEqual(NOT_FOUND)
  })

  it('applies audit rules only for entries of unregistered resources', async () => {
    const unregistered = historyEntry({ resourceKind: 'other.thing', resourceId: 'thing-1' })
    store.entries.push(unregistered)
    const outcome = await service().service.explainLog(buildViewer(), unregistered.logId)
    expect(outcome.ok).toBe(true)
  })

  it('reports legacy entries as inferred', async () => {
    const legacy = historyEntry({ causeKind: null, causeId: null, causation: null })
    store.entries.push(legacy)
    const outcome = await service().service.explainLog(buildViewer(), legacy.logId)
    if (!outcome.ok) throw new Error('[internal] expected log explanation')

    expect(outcome.body.confidence).toBe('inferred')
    expect(outcome.body.cause).toEqual(expect.objectContaining({ kind: 'user', legacy: true, labelKey: 'insights.explain.cause.legacyUser' }))
  })
})

describe('ExplainService — field providers', () => {
  const providerExplain = jest.fn(async () => [{ key: 'test.provider.fact', params: { outcome: 'matched' }, confidence: 'inferred' as const }])

  function registerProviderConfig() {
    const config = testExplainConfig()
    const [resource] = config.resources ?? []
    resource.fields = resource.fields.map((field) => (field.key === 'status' ? { ...field, provider: 'test.provider' } : field))
    registerTestExplainConfig({ ...config, providers: [{ id: 'test.provider', explain: providerExplain }] })
  }

  beforeEach(() => {
    providerExplain.mockClear()
    registerProviderConfig()
  })

  it('adds provider facts to the first page with the scanned history', async () => {
    const body = fieldBody((await explainField()).outcome)
    expect(providerExplain).toHaveBeenCalledTimes(1)
    expect(providerExplain).toHaveBeenCalledWith(expect.objectContaining({ itemId: null, history: store.entries }))
    expect(body.hints).toEqual(expect.arrayContaining([
      { key: 'test.provider.fact', params: { outcome: 'matched' }, confidence: 'inferred', reference: null },
    ]))
  })

  it('passes no history to providers for viewers who cannot see past values', async () => {
    granted = ['insights.*', 'test.deals.view', 'audit_logs.view_self']
    await explainField()
    expect(providerExplain).toHaveBeenCalledWith(expect.objectContaining({ history: [] }))
  })

  it('does not run providers on continuation pages, whose history window is partial', async () => {
    const first = fieldBody((await explainField({ limit: 1 })).outcome)
    providerExplain.mockClear()
    const second = fieldBody((await explainField({ limit: 1, before: first.page.nextBefore ?? undefined })).outcome)
    expect(providerExplain).not.toHaveBeenCalled()
    expect(second.hints.some((hint) => hint.key === 'test.provider.fact')).toBe(false)
  })
})
