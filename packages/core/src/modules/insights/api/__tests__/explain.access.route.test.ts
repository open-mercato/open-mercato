/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  AccessExplanation,
  AccessExplanationDetail,
  RbacService,
} from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActionLogFieldHistoryEntry, ActionLogFieldHistoryQuery } from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import type { AccessExplainResponse } from '../../data/validators'

const reportErrorMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const listSuperAdminUserIdsMock = jest.fn()
let mockModules: Array<{ id: string; features?: Array<{ id: string; title: string; module: string }> }> | null = null

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/auth/lib/grantChecks', () => ({
  listSuperAdminUserIds: (...args: unknown[]) => listSuperAdminUserIdsMock(...args),
}))

jest.mock('@open-mercato/shared/lib/modules/registry', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/modules/registry')
  return { ...actual, tryGetModules: () => mockModules }
})

jest.mock('@open-mercato/shared/lib/logger', () => {
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn() }
  return { createLogger: () => ({ ...silent, child: () => silent }) }
})

const containerServices: Record<string, unknown> = {}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => containerServices[name],
  })),
}))

import * as accessRoute from '../explain/access/route'
import { AccessExplainService, listAclCatalogFeatureIds } from '../../services/accessExplainService'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import {
  applyAclFeatureOverrides,
  resetModuleContractOverridesForTests,
} from '@open-mercato/shared/modules/overrides'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const CALLER_ID = '44444444-4444-4444-8444-444444444444'
const TARGET_ID = '55555555-5555-4555-8555-555555555555'
const ROLE_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_ROLE_ID = '77777777-7777-4777-8777-777777777777'
const ACCESS_URL = 'http://localhost/api/insights/explain/access'
const CATALOG = ['customers.people.view', 'sales.orders.view', 'insights.explain.view', 'entities.records.view']

type ScopeShape = { selectedId: string | null; filterIds: string[] | null; allowedIds: string[] | null; tenantId: string | null }

let callerFeatures: string[]
let callerIsSuperAdmin: boolean
let scope: ScopeShape
let explanation: AccessExplanation
let historyEntries: Record<string, ActionLogFieldHistoryEntry[]>
let rbacService: {
  userHasAllFeatures: jest.Mock
  loadAcl: jest.Mock
  explainAccess: jest.Mock
}
let actionLogService: { findFieldHistory: jest.Mock }

function baseDetail(overrides: Partial<AccessExplanationDetail> = {}): AccessExplanationDetail {
  return {
    principal: 'user',
    source: 'roles',
    organizationId: ORG_A,
    organizationAllowed: true,
    aclOrganizations: null,
    features: [{ feature: 'sales.orders.view', granted: false, reason: 'missing_feature' }],
    userAcl: null,
    roles: [
      { roleId: ROLE_ID, roleName: 'CRM', isSuperAdmin: false, organizations: [ORG_A, ORG_B], appliesToOrganization: true, grantedFeatures: [] },
    ],
    rolesThatWouldGrant: [
      { roleId: OTHER_ROLE_ID, roleName: 'Sales', isSuperAdmin: false, organizations: null, appliesToOrganization: true, grantedFeatures: ['sales.orders.view'] },
    ],
    grantedOrganizationIds: [ORG_B],
    ...overrides,
  }
}

function deniedExplanation(withDetail: boolean): AccessExplanation {
  return {
    decision: 'denied',
    required: [{ feature: 'sales.orders.view', granted: false, reason: 'missing_feature' }],
    reasons: ['missing_feature'],
    confidence: 'proven',
    consistentWithFreshRead: true,
    detail: withDetail ? baseDetail() : null,
  }
}

function grantedExplanation(): AccessExplanation {
  return {
    decision: 'granted',
    required: [{ feature: 'customers.people.view', granted: true, reason: null }],
    reasons: [],
    confidence: 'proven',
    consistentWithFreshRead: true,
    detail: null,
  }
}

function historyEntry(input: Partial<ActionLogFieldHistoryEntry> & { logId: string; at: string }): ActionLogFieldHistoryEntry {
  return {
    commandId: 'auth.acl.update',
    actionType: 'update',
    executionState: 'done',
    actorUserId: CALLER_ID,
    resourceKind: 'auth.user_acl',
    resourceId: TARGET_ID,
    changedFields: null,
    snapshotBefore: null,
    snapshotAfter: null,
    changes: null,
    causeKind: 'user',
    causeId: CALLER_ID,
    cursorAt: input.at,
    organizationId: ORG_A,
    actionLabel: 'Change user permissions',
    onBehalfOfUserId: null,
    parentResourceKind: null,
    parentResourceId: null,
    correlationId: null,
    causedByLogId: null,
    causation: null,
    historyAction: null,
    sourceLogId: null,
    actorKind: 'user',
    ...input,
  }
}

function accessUrl(params: Record<string, string | string[]>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? value : [value]) search.append(key, entry)
  }
  return `${ACCESS_URL}?${search.toString()}`
}

async function callRoute(params: Record<string, string | string[]>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await accessRoute.GET(new Request(accessUrl(params)))
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

async function mocks() {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { resolveFeatureCheckContext } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
  return {
    getAuthFromRequest: getAuthFromRequest as jest.Mock,
    resolveFeatureCheckContext: resolveFeatureCheckContext as jest.Mock,
  }
}

function featureMatches(granted: readonly string[], required: string): boolean {
  return granted.some((grant) => grant === required || (grant.endsWith('.*') && required.startsWith(grant.slice(0, -1))))
}

beforeEach(async () => {
  jest.clearAllMocks()
  mockModules = null
  callerFeatures = []
  callerIsSuperAdmin = false
  scope = { selectedId: ORG_A, filterIds: [ORG_A], allowedIds: [ORG_A], tenantId: TENANT_ID }
  explanation = deniedExplanation(false)
  historyEntries = {}
  rbacService = {
    userHasAllFeatures: jest.fn(async (_sub: string, required: string[]) => required.every((feature) => featureMatches(callerFeatures, feature))),
    loadAcl: jest.fn(async () => ({ isSuperAdmin: callerIsSuperAdmin, features: callerFeatures, organizations: null })),
    explainAccess: jest.fn(async (_principal: string, _features: string[], _scope: unknown, options: { detail?: boolean }) =>
      ({ ...explanation, detail: options.detail ? explanation.detail ?? baseDetail() : null })),
  }
  actionLogService = {
    findFieldHistory: jest.fn(async (query: ActionLogFieldHistoryQuery) => ({
      entries: historyEntries[`${query.resourceKinds[0]}:${query.resourceId}`] ?? [],
      nextBefore: null,
    })),
  }
  containerServices.accessExplainService = new AccessExplainService({
    em: {} as EntityManager,
    rbacService: rbacService as unknown as RbacService,
    actionLogService,
    listFeatureCatalog: () => new Set(CATALOG),
  })
  findOneWithDecryptionMock.mockResolvedValue({ id: TARGET_ID, tenantId: TENANT_ID, organizationId: ORG_A })
  listSuperAdminUserIdsMock.mockResolvedValue(new Set<string>())
  const { getAuthFromRequest, resolveFeatureCheckContext } = await mocks()
  getAuthFromRequest.mockResolvedValue({ sub: CALLER_ID, tenantId: TENANT_ID, orgId: ORG_A })
  resolveFeatureCheckContext.mockImplementation(async () => ({ organizationId: scope.selectedId ?? ORG_A, scope, allowedOrganizationIds: scope.allowedIds }))
})

afterEach(() => {
  resetModuleContractOverridesForTests()
})

describe('GET /api/insights/explain/access — contract', () => {
  it('requires authentication only and documents the route', () => {
    expect(accessRoute.metadata).toEqual({ GET: { requireAuth: true } })
    expect(accessRoute.openApi.methods.GET?.query).toBeDefined()
    expect(accessRoute.openApi.methods.GET?.responses?.[0]?.status).toBe(200)
  })
})

describe('GET /api/insights/explain/access — validation', () => {
  it.each([
    ['no features', {}],
    ['a wildcard feature', { features: 'customers.*' }],
    ['a feature without a module prefix', { features: 'customers' }],
    ['more than 20 features', { features: Array.from({ length: 21 }, (_unused, index) => `customers.f${index}`).join(',') }],
    ['a malformed user id', { features: 'customers.people.view', userId: 'user-1' }],
    ['an absolute URL path', { features: 'customers.people.view', path: 'https://evil.example/backend' }],
    ['a protocol-relative path', { features: 'customers.people.view', path: '//evil.example' }],
    ['a path with control characters', { features: 'customers.people.view', path: '/backend/\u0007' }],
  ])('rejects %s with 400', async (_label, params) => {
    const { status, body } = await callRoute(params)
    expect(status).toBe(400)
    expect(body.error).toBe('invalid_query')
    expect(rbacService.explainAccess).not.toHaveBeenCalled()
  })

  it('rejects feature ids that are not in the ACL catalog', async () => {
    const { status, body } = await callRoute({ features: 'customers.people.view,customers.typo.view' })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'unknown_feature', details: { features: ['customers.typo.view'] } })
    expect(rbacService.explainAccess).not.toHaveBeenCalled()
  })

  it('accepts per-entity record features of custom entities by their reserved shape', async () => {
    const accepted = await callRoute({ features: 'entities.records.user:vault.view,entities.records.user:vault.manage' })
    expect(accepted.status).toBe(200)
    const rejected = await callRoute({ features: 'entities.records.user:vault.delete,entities.records.vault.view' })
    expect(rejected.status).toBe(400)
    expect(rejected.body).toEqual({
      error: 'unknown_feature',
      details: { features: ['entities.records.user:vault.delete', 'entities.records.vault.view'] },
    })
  })

  it('requires a resolved tenant', async () => {
    const { getAuthFromRequest } = await mocks()
    getAuthFromRequest.mockResolvedValueOnce({ sub: CALLER_ID, tenantId: null, orgId: null })
    scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
    const { status, body } = await callRoute({ features: 'customers.people.view' })
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'tenant_required' })
  })

  it('returns 401 without an authenticated caller', async () => {
    const { getAuthFromRequest } = await mocks()
    getAuthFromRequest.mockResolvedValueOnce(null)
    const { status } = await callRoute({ features: 'customers.people.view' })
    expect(status).toBe(401)
  })
})

describe('GET /api/insights/explain/access — self', () => {
  it('returns a minimal explanation without detail for a caller lacking access_detail', async () => {
    const { status, body } = await callRoute({ features: ['sales.orders.view', 'sales.orders.view'] })
    expect(status).toBe(200)
    expect(rbacService.explainAccess).toHaveBeenCalledWith(
      CALLER_ID,
      ['sales.orders.view'],
      { tenantId: TENANT_ID, organizationId: ORG_A },
      { detail: false },
    )
    const response = body as AccessExplainResponse
    expect(response).toEqual({
      decision: 'denied',
      required: [{ feature: 'sales.orders.view', granted: false }],
      reasons: ['missing_feature'],
      summary: { key: 'insights.explain.access.summary.missingFeature', params: { features: 'sales.orders.view', count: 1 } },
      detail: null,
      confidence: 'proven',
    })
  })

  it('accepts comma-separated and repeated feature parameters', async () => {
    explanation = grantedExplanation()
    await callRoute({ features: ['customers.people.view,sales.orders.view', 'insights.explain.view'] })
    expect(rbacService.explainAccess).toHaveBeenCalledWith(
      CALLER_ID,
      ['customers.people.view', 'sales.orders.view', 'insights.explain.view'],
      expect.anything(),
      expect.anything(),
    )
  })

  it('reports a denial outside RBAC as not_determinable when every feature is granted at a path', async () => {
    explanation = grantedExplanation()
    const { body } = await callRoute({ features: 'customers.people.view', path: '/backend/customers/people' })
    expect(body).toMatchObject({
      decision: 'granted',
      reasons: ['not_determinable'],
      confidence: 'unknown',
      summary: { key: 'insights.explain.access.summary.notDeterminable', params: {} },
    })
  })

  it('reports no reasons for a granted check without a path', async () => {
    explanation = grantedExplanation()
    const { body } = await callRoute({ features: 'customers.people.view' })
    expect(body).toMatchObject({
      decision: 'granted',
      reasons: [],
      confidence: 'proven',
      summary: { key: 'insights.explain.access.summary.granted', params: { count: 1 } },
    })
  })

  it('hides super-administrator roles that would grant from callers who are not super administrators', async () => {
    callerFeatures = ['insights.explain.access_detail']
    explanation = deniedExplanation(true)
    explanation.detail = baseDetail({
      rolesThatWouldGrant: [
        { roleId: OTHER_ROLE_ID, roleName: 'Sales', isSuperAdmin: false, organizations: null, appliesToOrganization: true, grantedFeatures: ['sales.orders.view'] },
        { roleId: 'role-super', roleName: 'Root', isSuperAdmin: true, organizations: null, appliesToOrganization: true, grantedFeatures: ['sales.orders.view'] },
        { roleId: 'role-named', roleName: 'superadmin', isSuperAdmin: false, organizations: null, appliesToOrganization: true, grantedFeatures: ['sales.orders.view'] },
      ],
    })
    const hidden = await callRoute({ features: 'sales.orders.view' })
    expect((hidden.body.detail as { rolesThatWouldGrant: Array<{ id: string }> }).rolesThatWouldGrant.map((role) => role.id)).toEqual([OTHER_ROLE_ID])

    callerIsSuperAdmin = true
    const visible = await callRoute({ features: 'sales.orders.view' })
    expect((visible.body.detail as { rolesThatWouldGrant: Array<{ id: string }> }).rolesThatWouldGrant.map((role) => role.id)).toEqual([
      OTHER_ROLE_ID,
      'role-super',
      'role-named',
    ])
  })

  it('treats a userId equal to the caller as a self explanation', async () => {
    const { status } = await callRoute({ features: 'sales.orders.view', userId: CALLER_ID.toUpperCase() })
    expect(status).toBe(200)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(rbacService.explainAccess).toHaveBeenCalledWith(CALLER_ID, expect.anything(), expect.anything(), { detail: false })
  })

  it('explains an API key caller as its own principal', async () => {
    const { getAuthFromRequest } = await mocks()
    getAuthFromRequest.mockResolvedValueOnce({ sub: 'api_key:key-1', tenantId: TENANT_ID, orgId: ORG_A, isApiKey: true })
    callerFeatures = ['insights.explain.access_detail']
    explanation = { ...deniedExplanation(true), detail: baseDetail({ principal: 'api_key', source: 'api_key' }) }
    const { body } = await callRoute({ features: 'sales.orders.view' })
    expect(rbacService.explainAccess).toHaveBeenCalledWith('api_key:key-1', ['sales.orders.view'], expect.anything(), { detail: true })
    expect(body.detail).toMatchObject({ subject: { kind: 'api_key', id: 'key-1', isSelf: true }, source: 'api_key' })
  })

  it('returns detail with organizations outside the caller scope redacted for access_detail holders', async () => {
    callerFeatures = ['insights.explain.access_detail']
    explanation = deniedExplanation(true)
    const { status, body } = await callRoute({ features: 'sales.orders.view' })
    expect(status).toBe(200)
    expect(rbacService.explainAccess).toHaveBeenCalledWith(CALLER_ID, ['sales.orders.view'], expect.anything(), { detail: true })
    expect(body.detail).toEqual({
      subject: { kind: 'user', id: CALLER_ID, isSelf: true },
      source: 'roles',
      organizationId: ORG_A,
      organizationAllowed: true,
      aclOrganizations: null,
      features: [{ feature: 'sales.orders.view', granted: false, reason: 'missing_feature' }],
      userAcl: null,
      roles: [{ id: ROLE_ID, name: 'CRM', isSuperAdmin: false, organizations: [ORG_A], appliesToOrganization: true, grantedFeatures: [] }],
      rolesThatWouldGrant: [{ id: OTHER_ROLE_ID, name: 'Sales', isSuperAdmin: false, organizations: null, appliesToOrganization: true, grantedFeatures: ['sales.orders.view'] }],
      grantedOrganizationIds: [],
      organizationsRedacted: true,
      recentChanges: null,
      consistentWithFreshRead: true,
    })
    expect(actionLogService.findFieldHistory).not.toHaveBeenCalled()
  })

  it('keeps every organization for a tenant-wide caller', async () => {
    callerFeatures = ['insights.explain.access_detail']
    explanation = deniedExplanation(true)
    scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID }
    const { body } = await callRoute({ features: 'sales.orders.view' })
    expect(body.detail).toMatchObject({
      roles: [{ organizations: [ORG_A, ORG_B] }],
      grantedOrganizationIds: [ORG_B],
      organizationsRedacted: false,
    })
  })

  it('adds recent ACL and role changes for callers with tenant audit access', async () => {
    callerFeatures = ['insights.explain.access_detail', 'audit_logs.view_tenant']
    explanation = deniedExplanation(true)
    historyEntries = {
      [`auth.user_acl:${CALLER_ID}`]: [historyEntry({ logId: 'aaaaaaaa-0000-4000-8000-000000000001', at: '2026-10-08T10:00:00.000Z', resourceId: CALLER_ID })],
      [`auth.user:${CALLER_ID}`]: [
        historyEntry({ logId: 'aaaaaaaa-0000-4000-8000-000000000002', at: '2026-10-08T11:00:00.000Z', resourceKind: 'auth.user', resourceId: CALLER_ID, changedFields: ['name'], actionLabel: 'Update user' }),
        historyEntry({ logId: 'aaaaaaaa-0000-4000-8000-000000000003', at: '2026-10-08T09:00:00.000Z', resourceKind: 'auth.user', resourceId: CALLER_ID, changes: { roles: { from: [], to: ['CRM'] } }, actionLabel: 'Update user' }),
        historyEntry({ logId: 'aaaaaaaa-0000-4000-8000-000000000004', at: '2026-10-08T12:00:00.000Z', resourceKind: 'auth.user', resourceId: CALLER_ID, changedFields: ['roles'], executionState: 'failed' }),
      ],
      [`auth.role_acl:${ROLE_ID}`]: [historyEntry({ logId: 'aaaaaaaa-0000-4000-8000-000000000005', at: '2026-10-08T13:00:00.000Z', resourceKind: 'auth.role_acl', resourceId: ROLE_ID, actionLabel: 'Change role permissions' })],
    }
    const { body } = await callRoute({ features: 'sales.orders.view' })
    expect(actionLogService.findFieldHistory).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID, organizationIds: [ORG_A] }))
    expect((body.detail as { recentChanges: unknown }).recentChanges).toEqual([
      { logId: 'aaaaaaaa-0000-4000-8000-000000000005', at: '2026-10-08T13:00:00.000Z', kind: 'role_acl', resourceId: ROLE_ID, commandId: 'auth.acl.update', actionLabel: 'Change role permissions' },
      { logId: 'aaaaaaaa-0000-4000-8000-000000000001', at: '2026-10-08T10:00:00.000Z', kind: 'user_acl', resourceId: CALLER_ID, commandId: 'auth.acl.update', actionLabel: 'Change user permissions' },
      { logId: 'aaaaaaaa-0000-4000-8000-000000000003', at: '2026-10-08T09:00:00.000Z', kind: 'user_roles', resourceId: CALLER_ID, commandId: 'auth.acl.update', actionLabel: 'Update user' },
    ])
  })

  it('reports a failed recent-changes read and still explains the decision', async () => {
    callerFeatures = ['insights.explain.access_detail', 'audit_logs.view_tenant']
    explanation = deniedExplanation(true)
    actionLogService.findFieldHistory.mockRejectedValueOnce(new Error('timeout'))
    const { status, body } = await callRoute({ features: 'sales.orders.view' })
    expect(status).toBe(200)
    expect((body.detail as { recentChanges: unknown }).recentChanges).toBeNull()
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'insights.access_recent_changes_failed' }))
  })

  it('lowers confidence when the cached decision disagrees with a fresh read', async () => {
    explanation = { ...deniedExplanation(false), confidence: 'inferred', consistentWithFreshRead: false }
    const { body } = await callRoute({ features: 'sales.orders.view' })
    expect(body.confidence).toBe('inferred')
  })

  it('returns 500 and reports an unexpected failure', async () => {
    rbacService.explainAccess.mockRejectedValueOnce(new Error('boom'))
    const { status, body } = await callRoute({ features: 'sales.orders.view' })
    expect(status).toBe(500)
    expect(body).toEqual({ error: 'internal_error' })
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'insights.explain_failed', attributes: { route: 'access' } }))
  })
})

describe('GET /api/insights/explain/access — another user', () => {
  it.each([
    ['neither feature', []],
    ['only access_detail', ['insights.explain.access_detail']],
    ['only auth.users.list', ['auth.users.list']],
  ])('returns 403 for a caller with %s', async (_label, features) => {
    callerFeatures = features
    const { status, body } = await callRoute({ features: 'sales.orders.view', userId: TARGET_ID })
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'forbidden' })
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(rbacService.explainAccess).not.toHaveBeenCalled()
  })

  it('explains a user inside the caller scope with detail', async () => {
    callerFeatures = ['insights.*', 'auth.users.list']
    explanation = deniedExplanation(true)
    const { status, body } = await callRoute({ features: 'sales.orders.view', userId: TARGET_ID })
    expect(status).toBe(200)
    const [, entity, where] = findOneWithDecryptionMock.mock.calls[0]
    expect(entity).toBe(User)
    expect(where).toEqual({ id: TARGET_ID, tenantId: TENANT_ID, deletedAt: null })
    expect(rbacService.explainAccess).toHaveBeenCalledWith(TARGET_ID, ['sales.orders.view'], { tenantId: TENANT_ID, organizationId: ORG_A }, { detail: true })
    expect(body.detail).toMatchObject({ subject: { kind: 'user', id: TARGET_ID, isSelf: false } })
  })

  it('does not report a denial outside RBAC for another user, who was not denied at the path', async () => {
    callerFeatures = ['insights.explain.access_detail', 'auth.users.list']
    explanation = grantedExplanation()
    const { body } = await callRoute({ features: 'customers.people.view', userId: TARGET_ID, path: '/backend/customers/people' })
    expect(body).toMatchObject({ decision: 'granted', reasons: [], confidence: 'proven' })
  })

  it('evaluates at the target user organization when the caller has no organization selected', async () => {
    callerFeatures = ['insights.explain.access_detail', 'auth.users.list']
    scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID }
    findOneWithDecryptionMock.mockResolvedValueOnce({ id: TARGET_ID, tenantId: TENANT_ID, organizationId: ORG_B })
    await callRoute({ features: 'sales.orders.view', userId: TARGET_ID })
    expect(rbacService.explainAccess).toHaveBeenCalledWith(TARGET_ID, expect.anything(), { tenantId: TENANT_ID, organizationId: ORG_B }, { detail: true })
  })

  it.each([
    ['a missing user', null],
    ['a user in another organization', { id: TARGET_ID, tenantId: TENANT_ID, organizationId: ORG_B }],
    ['a user without an organization for an organization-scoped caller', { id: TARGET_ID, tenantId: TENANT_ID, organizationId: null }],
  ])('returns an identical 404 for %s', async (_label, user) => {
    callerFeatures = ['insights.explain.access_detail', 'auth.users.list']
    findOneWithDecryptionMock.mockResolvedValueOnce(user)
    const { status, body } = await callRoute({ features: 'sales.orders.view', userId: TARGET_ID })
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'not_found' })
    expect(rbacService.explainAccess).not.toHaveBeenCalled()
  })

  it('returns 404 without querying when the caller has no visible organization', async () => {
    callerFeatures = ['insights.explain.access_detail', 'auth.users.list']
    scope = { selectedId: null, filterIds: [], allowedIds: [], tenantId: TENANT_ID }
    const { status } = await callRoute({ features: 'sales.orders.view', userId: TARGET_ID })
    expect(status).toBe(404)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('hides super administrators from callers who are not super administrators', async () => {
    callerFeatures = ['insights.explain.access_detail', 'auth.users.list']
    listSuperAdminUserIdsMock.mockResolvedValue(new Set([TARGET_ID]))
    const hidden = await callRoute({ features: 'sales.orders.view', userId: TARGET_ID })
    expect(hidden.status).toBe(404)
    expect(listSuperAdminUserIdsMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID)

    callerIsSuperAdmin = true
    const visible = await callRoute({ features: 'sales.orders.view', userId: TARGET_ID })
    expect(visible.status).toBe(200)
  })
})

describe('ACL catalog', () => {
  it('lists features declared by enabled modules plus features removed by overrides', () => {
    mockModules = [
      { id: 'customers', features: [{ id: 'customers.people.view', title: 'View people', module: 'customers' }] },
      { id: 'sales' },
    ]
    applyAclFeatureOverrides({ 'sales.orders.view': null })
    expect(Array.from(listAclCatalogFeatureIds()).sort()).toEqual(['customers.people.view', 'sales.orders.view'])
  })

  it('is empty before the module registry is bootstrapped', () => {
    mockModules = null
    expect(listAclCatalogFeatureIds().size).toBe(0)
  })
})
