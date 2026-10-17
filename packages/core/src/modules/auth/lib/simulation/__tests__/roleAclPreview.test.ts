import fs from 'node:fs'
import path from 'node:path'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import type { SimulationRunContext } from '@open-mercato/shared/modules/insights/simulate'
import { RbacService, type RoleAclChangePreview } from '@open-mercato/core/modules/auth/services/rbacService'
import { createFakeEntityManager, emptyRows, uuidOf, type FakeRole, type FakeRows } from '../../../services/__tests__/rbacPreviewFixture'
import type { GatedSurface } from '../gatedSurface'

const loadGatedSurfaceMock = jest.fn<Promise<GatedSurface>, []>()
jest.mock('../gatedSurface', () => {
  const actual = jest.requireActual('../gatedSurface')
  return { ...actual, loadGatedSurface: () => loadGatedSurfaceMock() }
})

import {
  ROLE_ACL_PREVIEW_CELLS,
  ROLE_ACL_PREVIEW_I18N,
  buildRoleAclPreviewResult,
  fingerprintRoleAcl,
  roleAclPreviewGroupKey,
  roleAclPreviewKind,
} from '../roleAclPreview'

const TENANT = '11111111-0000-4000-8000-0000000000d7'
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000d8'
const ORG_A = '22222222-0000-4000-8000-0000000000a7'
const ORG_B = '22222222-0000-4000-8000-0000000000b7'
const ACTOR = '33333333-0000-4000-8000-0000000000a7'
const SCOPE = { tenantId: TENANT, organizationId: ORG_A }

registerModules([
  { id: 'auth', features: [{ id: 'auth.acl.manage', title: 'ACL', module: 'auth' }, { id: 'auth.users.list', title: 'Users', module: 'auth' }] },
  { id: 'sales', features: [{ id: 'sales.orders.view', title: 'Orders', module: 'sales' }, { id: 'sales.orders.manage', title: 'Manage', module: 'sales' }] },
] as unknown as Module[])

type ActorAcl = { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }

function setup(options: { actor?: ActorAcl; roleIsSuperAdmin?: boolean; aclUpdatedAt?: Date | null; noAcl?: boolean } = {}) {
  const rows: FakeRows = emptyRows()
  const role: FakeRole = { id: uuidOf(1, 1), tenantId: TENANT, name: 'Sales', deletedAt: null }
  const foreignRole: FakeRole = { id: uuidOf(1, 2), tenantId: OTHER_TENANT, name: 'Sales', deletedAt: null }
  rows.roles.push(role, foreignRole)
  if (!options.noAcl) {
    rows.roleAcls.push({
      id: uuidOf(2, 1),
      role,
      tenantId: TENANT,
      isSuperAdmin: options.roleIsSuperAdmin === true,
      featuresJson: ['sales.orders.view', 'legacy.removed_feature'],
      organizationsJson: null,
      updatedAt: options.aclUpdatedAt === undefined ? new Date('2026-10-01T10:00:00.000Z') : options.aclUpdatedAt,
    })
  }
  rows.organizations.push(
    { id: ORG_A, tenant: { id: TENANT }, tenantId: TENANT, name: 'Alpha', ancestorIds: [], deletedAt: null },
    { id: ORG_B, tenant: { id: TENANT }, tenantId: TENANT, name: 'Beta', ancestorIds: [], deletedAt: null },
  )
  const em = createFakeEntityManager(rows)
  const actor = options.actor ?? { isSuperAdmin: false, features: ['sales.*', 'auth.acl.manage'], organizations: null }
  const rbac = {
    previewRoleAclChange: jest.fn(),
    loadAclWithEntityManager: jest.fn(async () => actor),
    resolveFeatureOrganizationAccess: jest.fn(async () => ({
      unrestricted: true,
      filterOrganizationIds: (candidates: ReadonlyArray<{ id: string }>) => candidates.map((candidate) => candidate.id),
    })),
  }
  const resolve = <T,>(name: string): T | undefined => (name === 'rbacService' ? (rbac as unknown as T) : undefined)
  return { rows, role, foreignRole, em, rbac, resolve }
}

function proposal(overrides: Record<string, unknown> = {}) {
  return { roleId: uuidOf(1, 1), isSuperAdmin: false, features: ['sales.orders.view', 'sales.orders.manage'], organizations: null, ...overrides }
}

function validationContext(env: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
  return { em: env.em as never, scope: SCOPE, eventAdapters: [], artifactId: env.role.id, requesterUserId: ACTOR, resolve: env.resolve, ...overrides }
}

function previewOf(overrides: Partial<RoleAclChangePreview> = {}): RoleAclChangePreview {
  return {
    roleId: uuidOf(1, 1),
    tenantId: TENANT,
    current: { isSuperAdmin: false, features: ['sales.orders.view'], organizations: null },
    currentExists: true,
    proposed: { isSuperAdmin: false, features: ['sales.orders.manage'], organizations: null },
    organizationIds: [ORG_A, ORG_B],
    featureSets: [[], ['auth.acl.manage', 'sales.orders.view'], ['sales.orders.manage'], ['auth.acl.manage', 'sales.orders.manage', 'sales.orders.view']],
    cohorts: [],
    self: null,
    truncated: { users: false, apiKeys: false, organizations: false },
    ...overrides,
  }
}

const FULL_SURFACE: GatedSurface = {
  pagesAvailable: true,
  apiRoutesAvailable: true,
  items: [
    { kind: 'page', id: '/backend/sales/orders', requiredFeatures: ['sales.orders.view'] },
    { kind: 'menu_item', id: '/backend/sales/orders', requiredFeatures: ['sales.orders.view'] },
    { kind: 'page', id: '/backend/sales/orders/[id]/edit', requiredFeatures: ['sales.orders.manage'] },
    { kind: 'api_route', id: 'PUT /sales/orders', requiredFeatures: ['sales.orders.manage'] },
    { kind: 'api_route', id: 'GET /sales/orders', requiredFeatures: ['sales.orders.view'] },
    { kind: 'api_route', id: 'GET /auth/roles/acl', requiredFeatures: ['auth.acl.manage'] },
  ],
}

beforeEach(() => {
  loadGatedSurfaceMock.mockReset()
  loadGatedSurfaceMock.mockResolvedValue(FULL_SURFACE)
})

describe('auth.role_acl_preview contract', () => {
  it('runs inline with the ACL and user-list features, four cells, a 24 h TTL, an access-logged run and live principals', () => {
    expect(roleAclPreviewKind.kind).toBe('auth.role_acl_preview')
    expect(roleAclPreviewKind.artifactKind).toBe('auth.role_acl')
    expect(roleAclPreviewKind.requiredFeatures).toEqual(['auth.acl.manage', 'auth.users.list'])
    expect(roleAclPreviewKind.cellKeys).toEqual([...ROLE_ACL_PREVIEW_CELLS])
    expect(roleAclPreviewKind.execution).toBe('inline')
    expect(roleAclPreviewKind.ttlHours).toBe(24)
    expect(roleAclPreviewKind.accessLogResourceKind).toBe('insights.simulation.permission_preview')
    expect(roleAclPreviewKind.liveRecords?.requiredFeatures).toEqual(['auth.users.list'])
    expect(roleAclPreviewKind.applyHref!({ artifactId: 'r 1', runId: 'run' })).toBe('/backend/roles/r%201/edit?simulationRunId=run')
    expect(roleAclPreviewKind.applyHref!({ artifactId: null, runId: 'run' })).toBeNull()
  })

  it('accepts only a well-formed proposal', () => {
    const schema = roleAclPreviewKind.inputSchema
    expect(schema.safeParse(proposal()).success).toBe(true)
    expect(schema.safeParse(proposal({ organizations: ['__all__', ORG_A] })).success).toBe(true)
    expect(schema.safeParse(proposal({ organizations: ['not-an-org'] })).success).toBe(false)
    expect(schema.safeParse(proposal({ roleId: 'x' })).success).toBe(false)
    expect(schema.safeParse(proposal({ extra: true })).success).toBe(false)
    expect(schema.safeParse(proposal({ features: [''] })).success).toBe(false)
  })

  it('fingerprints what decides access only: grant order is irrelevant, no organizations ≠ every organization', () => {
    const base = { isSuperAdmin: false, features: ['b', 'a'], organizations: null }
    expect(fingerprintRoleAcl(base)).toBe(fingerprintRoleAcl({ ...base, features: ['a', 'b', ' a '] }))
    expect(fingerprintRoleAcl(base)).not.toBe(fingerprintRoleAcl({ ...base, organizations: [] }))
    expect(fingerprintRoleAcl(base)).not.toBe(fingerprintRoleAcl({ ...base, isSuperAdmin: true }))
    expect(roleAclPreviewKind.fingerprintProposal(proposal({ features: ['sales.orders.manage', 'sales.orders.view'] })))
      .toBe(roleAclPreviewKind.fingerprintProposal(proposal()))
  })

  it('reads the role ACL version within the tenant: updatedAt and fingerprint, none for a foreign role', async () => {
    const env = setup()
    const version = await roleAclPreviewKind.readArtifactVersion({ em: env.em as never, scope: SCOPE }, { artifactId: env.role.id, input: proposal() as never })
    expect(version).toEqual({
      artifactId: env.role.id,
      updatedAt: '2026-10-01T10:00:00.000Z',
      fingerprint: fingerprintRoleAcl({ isSuperAdmin: false, features: ['sales.orders.view', 'legacy.removed_feature'], organizations: null }),
    })
    expect(await roleAclPreviewKind.readArtifactVersion({ em: env.em as never, scope: SCOPE }, { artifactId: env.foreignRole.id, input: proposal() as never })).toBeNull()
    const legacy = setup({ aclUpdatedAt: null })
    expect((await roleAclPreviewKind.readArtifactVersion({ em: legacy.em as never, scope: SCOPE }, { artifactId: null, input: proposal() as never }))?.updatedAt).toBeNull()
    const none = setup({ noAcl: true })
    expect(await roleAclPreviewKind.readArtifactVersion({ em: none.em as never, scope: SCOPE }, { artifactId: null, input: proposal() as never }))
      .toEqual({ artifactId: none.role.id, updatedAt: null, fingerprint: fingerprintRoleAcl({ isSuperAdmin: false, features: [], organizations: null }) })
  })
})

describe('auth.role_acl_preview validation', () => {
  const validate = roleAclPreviewKind.validate!

  it('accepts catalog grants and grants the role already holds', async () => {
    const env = setup({ actor: { isSuperAdmin: true, features: ['*'], organizations: null } })
    expect(await validate(proposal({ features: ['sales.orders.view', 'sales.*', 'legacy.removed_feature', '*'] }) as never, validationContext(env))).toEqual({ ok: true })
    expect(await validate(proposal({ features: ['sales.orders.view', 'sales.*'] }) as never, validationContext(setup()))).toEqual({ ok: true })
  })

  it('answers the same artifact_unavailable for an unknown and a foreign role', async () => {
    const env = setup()
    const unknown = await validate(proposal({ roleId: uuidOf(1, 9) }) as never, validationContext(env, { artifactId: uuidOf(1, 9) }))
    const foreign = await validate(proposal({ roleId: env.foreignRole.id }) as never, validationContext(env, { artifactId: env.foreignRole.id }))
    expect(unknown).toEqual({ ok: false, code: 'artifact_unavailable' })
    expect(foreign).toEqual(unknown)
  })

  it('refuses a proposal for another role than the requested artifact and grants unknown to the ACL catalog', async () => {
    const env = setup()
    expect(await validate(proposal() as never, validationContext(env, { artifactId: env.foreignRole.id }))).toEqual({ ok: false, code: 'invalid_proposal' })
    expect(await validate(proposal({ features: ['made.up.feature'] }) as never, validationContext(env))).toEqual({ ok: false, code: 'invalid_proposal' })
    expect(await validate(proposal({ features: ['nomodule.*'] }) as never, validationContext(env))).toEqual({ ok: false, code: 'invalid_proposal' })
  })

  it('evaluates the write guards at the requester\'s own organization, like the role ACL save', async () => {
    const env = setup()
    env.rows.users.push({ id: ACTOR, tenantId: TENANT, organizationId: ORG_B, email: 'actor@example.com', name: null, deletedAt: null })
    await validate(proposal() as never, validationContext(env))
    expect(env.rbac.loadAclWithEntityManager).toHaveBeenCalledWith(env.em, ACTOR, { tenantId: TENANT, organizationId: ORG_B })
  })

  it('mirrors the role ACL write guards: super-admin roles and grants, grants beyond the requester\'s own, and fails closed without the requester', async () => {
    const env = setup()
    expect(await validate(proposal({ isSuperAdmin: true }) as never, validationContext(env))).toEqual({ ok: false, code: 'forbidden' })
    expect(await validate(proposal({ features: ['auth.users.list'] }) as never, validationContext(env))).toEqual({ ok: false, code: 'forbidden' })
    expect(await validate(proposal({ organizations: [ORG_B] }) as never, validationContext(setup({ actor: { isSuperAdmin: false, features: ['sales.*'], organizations: [ORG_A] } })))).toEqual({ ok: false, code: 'forbidden' })
    expect(await validate(proposal() as never, validationContext(setup({ roleIsSuperAdmin: true })))).toEqual({ ok: false, code: 'forbidden' })
    expect(await validate(proposal({ isSuperAdmin: true }) as never, validationContext(setup({ actor: { isSuperAdmin: true, features: ['*'], organizations: null } })))).toEqual({ ok: true })
    expect(await validate(proposal() as never, validationContext(env, { requesterUserId: undefined }))).toEqual({ ok: false, code: 'forbidden' })
    expect(await validate(proposal() as never, validationContext(env, { resolve: undefined }))).toEqual({ ok: false, code: 'forbidden' })
  })
})

describe('auth.role_acl_preview result', () => {
  const usersA = roleAclPreviewGroupKey(ORG_A, 'user')

  it('counts principals per organization and type by outcome and never stores a principal id', () => {
    const preview = previewOf({
      cohorts: [
        { principalType: 'user', principals: [{ id: 'u1', homeOrganizationId: ORG_A }, { id: 'u2', homeOrganizationId: ORG_A }], access: [{ organizationId: ORG_A, before: 1, after: 3 }] },
        { principalType: 'user', principals: [{ id: 'u3', homeOrganizationId: ORG_A }], access: [{ organizationId: ORG_A, before: 1, after: 2 }, { organizationId: ORG_B, before: 1, after: 0 }] },
        { principalType: 'user', principals: [{ id: 'u4', homeOrganizationId: ORG_B }], access: [{ organizationId: ORG_B, before: 2, after: 2 }] },
        { principalType: 'api_key', principals: [{ id: 'k1', homeOrganizationId: null }], access: [{ organizationId: ORG_A, before: 0, after: 2 }] },
      ],
    })
    const result = buildRoleAclPreviewResult(preview, FULL_SURFACE)
    expect(result.groups.map((group) => group.key)).toEqual([usersA, roleAclPreviewGroupKey(ORG_A, 'api_key'), roleAclPreviewGroupKey(ORG_B, 'user')])
    const cells = (key: string) => Object.fromEntries(result.groups.find((group) => group.key === key)!.cells.map((cell) => [cell.key, cell.count]))
    expect(cells(usersA)).toEqual({ gains: 2, loses: 0, gains_and_loses: 1, unchanged: 0 })
    expect(cells(roleAclPreviewGroupKey(ORG_A, 'api_key'))).toEqual({ gains: 1, loses: 0, gains_and_loses: 0, unchanged: 0 })
    expect(cells(roleAclPreviewGroupKey(ORG_B, 'user'))).toEqual({ gains: 0, loses: 1, gains_and_loses: 0, unchanged: 1 })
    expect(result.groups.every((group) => group.sampleResourceKind === null && group.labelKey !== null)).toBe(true)
    expect(result.summary?.lists).toEqual({
      features_gained: ['sales.orders.manage'],
      features_lost: ['auth.acl.manage', 'sales.orders.view'],
    })
    expect(JSON.stringify(result)).not.toMatch(/"u1"|"u2"|"u3"|"u4"|"k1"/)
    expect(result.fidelity).toBe('observed')
    expect(result.coverage).toEqual({})
  })

  it('counts the gated pages, navigation entries and API route methods some principal gains or loses', () => {
    const preview = previewOf({
      cohorts: [{ principalType: 'user', principals: [{ id: 'u1', homeOrganizationId: ORG_A }], access: [{ organizationId: ORG_A, before: 1, after: 2 }] }],
    })
    const result = buildRoleAclPreviewResult(preview, FULL_SURFACE)
    expect(result.summary?.counts).toEqual({
      organizations_evaluated: 2,
      pages_gained: 1,
      pages_lost: 1,
      menu_items_gained: 0,
      menu_items_lost: 1,
      api_routes_gained: 1,
      api_routes_lost: 2,
    })
    const partial = buildRoleAclPreviewResult(preview, { ...FULL_SURFACE, apiRoutesAvailable: false })
    expect(partial.summary?.counts).not.toHaveProperty('api_routes_lost')
    expect(partial.caveats).toContain(ROLE_ACL_PREVIEW_I18N.caveats.apiRoutesUnavailable)
    const noPages = buildRoleAclPreviewResult(preview, { ...FULL_SURFACE, pagesAvailable: false })
    expect(noPages.summary?.counts).not.toHaveProperty('pages_lost')
    expect(noPages.caveats).toContain(ROLE_ACL_PREVIEW_I18N.caveats.pagesUnavailable)
  })

  it('warns when the requester would lose auth.acl.manage or access to the current organization', () => {
    const managing = buildRoleAclPreviewResult(previewOf({ self: { organizationId: ORG_A, before: 1, after: 2, organizationAllowedBefore: true, organizationAllowedAfter: true } }), FULL_SURFACE)
    expect(managing.summary?.warnings).toEqual([ROLE_ACL_PREVIEW_I18N.warnings.selfLockoutAclManage])
    const lockedOut = buildRoleAclPreviewResult(previewOf({ self: { organizationId: ORG_A, before: 2, after: 0, organizationAllowedBefore: true, organizationAllowedAfter: false } }), FULL_SURFACE)
    expect(lockedOut.summary?.warnings).toEqual([ROLE_ACL_PREVIEW_I18N.warnings.selfLockoutOrganization])
    const both = buildRoleAclPreviewResult(previewOf({ self: { organizationId: ORG_A, before: 1, after: 0, organizationAllowedBefore: true, organizationAllowedAfter: true } }), FULL_SURFACE)
    expect(both.summary?.warnings).toEqual([ROLE_ACL_PREVIEW_I18N.warnings.selfLockoutAclManage, ROLE_ACL_PREVIEW_I18N.warnings.selfLockoutOrganization])
    const fine = buildRoleAclPreviewResult(previewOf({ self: { organizationId: ORG_A, before: 1, after: 3, organizationAllowedBefore: true, organizationAllowedAfter: true } }), FULL_SURFACE)
    expect(fine.summary?.warnings).toEqual([])
  })

  it('reports truncation and a vanished role', () => {
    const truncated = buildRoleAclPreviewResult(previewOf({ truncated: { users: true, apiKeys: false, organizations: false } }), FULL_SURFACE)
    expect(truncated.truncated).toBe(true)
    expect(truncated.caveats).toContain(ROLE_ACL_PREVIEW_I18N.caveats.truncated)
    const gone = buildRoleAclPreviewResult(null, null)
    expect(gone.groups).toEqual([])
    expect(gone.caveats[0]).toBe(ROLE_ACL_PREVIEW_I18N.caveats.roleUnavailable)
  })
})

describe('auth.role_acl_preview run', () => {
  function runContext(env: ReturnType<typeof setup>, inline: boolean): SimulationRunContext<null> {
    return {
      em: env.em as never,
      scope: SCOPE,
      requesterUserId: ACTOR,
      artifactId: env.role.id,
      window: { from: new Date(0), to: new Date(0) },
      budget: { recordsRemaining: 1, sliceDeadlineAt: 0, runDeadlineAt: 0, maxBatchRows: 1, maxBatchBytes: 1 },
      state: null,
      now: () => Date.parse('2026-10-10T12:00:00.000Z'),
      hasFeatures: async () => true,
      eventAdapters: [],
      scanAuditLog: async () => ({ entries: [], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 }),
      ...(inline ? { inline: { organizationIds: [ORG_A], resolve: env.resolve } } : {}),
    }
  }

  it('runs inline only, within the requester\'s organization scope, and evaluates the requester at the run\'s organization', async () => {
    const env = setup()
    env.rbac.previewRoleAclChange.mockResolvedValue(previewOf({
      cohorts: [{ principalType: 'user', principals: [{ id: 'u1', homeOrganizationId: ORG_A }], access: [{ organizationId: ORG_A, before: 1, after: 2 }] }],
    }))
    await expect(roleAclPreviewKind.run(proposal() as never, runContext(env, false) as never)).rejects.toThrow('[internal]')
    const slice = await roleAclPreviewKind.run(proposal() as never, runContext(env, true) as never)
    expect(slice.status).toBe('done')
    expect(slice.recordsProcessed).toBe(1)
    expect(env.rbac.previewRoleAclChange).toHaveBeenCalledWith(
      TENANT,
      uuidOf(1, 1),
      { isSuperAdmin: false, features: ['sales.orders.view', 'sales.orders.manage'], organizations: null },
      expect.objectContaining({ em: env.em, organizationIds: [ORG_A], principalOrganizationIds: [ORG_A], selfUserId: ACTOR, selfOrganizationId: ORG_A }),
    )
  })

  it('leaves API keys out for a requester who may not view API keys, and says so', async () => {
    const env = setup()
    env.rbac.previewRoleAclChange.mockResolvedValue(previewOf())
    const context = { ...runContext(env, true), hasFeatures: async (features: readonly string[]) => !features.includes('api_keys.view') }
    const slice = await roleAclPreviewKind.run(proposal() as never, context as never)
    expect(env.rbac.previewRoleAclChange).toHaveBeenCalledWith(TENANT, uuidOf(1, 1), expect.any(Object), expect.objectContaining({ includeApiKeys: false }))
    expect(slice.status === 'done' && slice.result.caveats).toContain(ROLE_ACL_PREVIEW_I18N.caveats.apiKeysHidden)
    const allowed = await roleAclPreviewKind.run(proposal() as never, runContext(env, true) as never)
    expect(allowed.status === 'done' && allowed.result.caveats).not.toContain(ROLE_ACL_PREVIEW_I18N.caveats.apiKeysHidden)
  })

  it('has no side effects: nothing is written, emitted or executed', async () => {
    const env = setup()
    env.rbac.previewRoleAclChange.mockResolvedValue(previewOf())
    await roleAclPreviewKind.validate!(proposal() as never, validationContext(env))
    await roleAclPreviewKind.run(proposal() as never, runContext(env, true) as never)
    await roleAclPreviewKind.liveRecords!.list(proposal() as never, {
      em: env.em as never, scope: SCOPE, viewerUserId: ACTOR, artifactId: env.role.id, organizationIds: null, page: 1, pageSize: 50, hasFeatures: async () => true, resolve: env.resolve,
    })
    for (const write of [env.em.persist, env.em.flush, env.em.nativeUpdate, env.em.nativeDelete, env.em.insert, env.em.remove, env.em.create, env.em.transactional]) {
      expect(write).not.toHaveBeenCalled()
    }
    for (const file of ['roleAclPreview.ts', 'aclCatalog.ts', 'gatedSurface.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      expect(source).not.toMatch(/emitEvent\(|eventBus|commandBus|\.persist\(|\.flush\(|nativeUpdate|nativeDelete|\.insert\(|\.remove\(|updateCrud|\.execute\(/)
    }
  })
})

describe('auth.role_acl_preview live principals', () => {
  function listContext(env: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) {
    return {
      em: env.em as never,
      scope: SCOPE,
      viewerUserId: ACTOR,
      artifactId: env.role.id,
      organizationIds: [ORG_A, ORG_B],
      page: 1,
      pageSize: 50,
      hasFeatures: async () => true,
      resolve: env.resolve,
      ...overrides,
    }
  }

  function seedPrincipals(env: ReturnType<typeof setup>) {
    env.rows.users.push(
      { id: uuidOf(5, 1), tenantId: TENANT, organizationId: ORG_A, email: 'ann@example.com', name: 'Ann', deletedAt: null },
      { id: uuidOf(5, 2), tenantId: TENANT, organizationId: ORG_B, email: 'bob@example.com', name: null, deletedAt: null },
    )
    env.rows.apiKeys.push({ id: uuidOf(6, 1), tenantId: TENANT, organizationId: ORG_A, rolesJson: [env.role.id], deletedAt: null, expiresAt: null, sessionUserId: null, name: 'Sync', keyPrefix: 'omk_ab' })
    env.rbac.previewRoleAclChange.mockResolvedValue(previewOf({
      cohorts: [
        { principalType: 'user', principals: [{ id: uuidOf(5, 1), homeOrganizationId: ORG_A }], access: [{ organizationId: ORG_A, before: 1, after: 2 }, { organizationId: ORG_B, before: 1, after: 1 }] },
        { principalType: 'user', principals: [{ id: uuidOf(5, 2), homeOrganizationId: ORG_B }], access: [{ organizationId: ORG_B, before: 1, after: 0 }] },
        { principalType: 'user', principals: [{ id: uuidOf(5, 3), homeOrganizationId: ORG_B }], access: [{ organizationId: ORG_B, before: 2, after: 2 }] },
        { principalType: 'api_key', principals: [{ id: uuidOf(6, 1), homeOrganizationId: ORG_A }], access: [{ organizationId: ORG_A, before: 0, after: 2 }] },
      ],
    }))
  }

  it('lists the principals whose access changes with live labels, links and per-principal counts, under the viewer\'s scope', async () => {
    const env = setup()
    seedPrincipals(env)
    const page = await roleAclPreviewKind.liveRecords!.list(proposal() as never, listContext(env))
    expect(env.rbac.previewRoleAclChange).toHaveBeenCalledWith(TENANT, uuidOf(1, 1), expect.any(Object), expect.objectContaining({ organizationIds: [ORG_A, ORG_B], principalOrganizationIds: [ORG_A, ORG_B] }))
    expect(env.rbac.previewRoleAclChange.mock.calls[0][3]).not.toHaveProperty('selfUserId')
    expect(page.total).toBe(3)
    expect(page.items).toEqual([
      { id: uuidOf(5, 1), type: 'user', label: 'Ann <ann@example.com>', href: `/backend/users/${uuidOf(5, 1)}/edit`, groupKeys: [roleAclPreviewGroupKey(ORG_A, 'user')], counts: { organizations: 1, features_gained: 1, features_lost: 2 } },
      { id: uuidOf(5, 2), type: 'user', label: 'bob@example.com', href: `/backend/users/${uuidOf(5, 2)}/edit`, groupKeys: [roleAclPreviewGroupKey(ORG_B, 'user')], counts: { organizations: 1, features_gained: 0, features_lost: 2 } },
      { id: uuidOf(6, 1), type: 'api_key', label: 'Sync (omk_ab…)', href: null, groupKeys: [roleAclPreviewGroupKey(ORG_A, 'api_key')], counts: { organizations: 1, features_gained: 1, features_lost: 0 } },
    ])
    expect(page.groupLabels).toEqual(expect.objectContaining({ [roleAclPreviewGroupKey(ORG_A, 'user')]: 'Alpha', [roleAclPreviewGroupKey(ORG_B, 'user')]: 'Beta' }))
    expect(page.notes).toEqual([])
  })

  it('lists API keys only for viewers holding api_keys.view and pages the list', async () => {
    const env = setup()
    seedPrincipals(env)
    const withoutKeys = await roleAclPreviewKind.liveRecords!.list(proposal() as never, listContext(env, { hasFeatures: async (features: readonly string[]) => !features.includes('api_keys.view') }))
    expect(withoutKeys.items.map((item) => item.type)).toEqual(['user', 'user'])
    expect(withoutKeys.total).toBe(2)
    const second = await roleAclPreviewKind.liveRecords!.list(proposal() as never, listContext(env, { page: 2, pageSize: 2 }))
    expect(second.total).toBe(3)
    expect(second.items.map((item) => item.id)).toEqual([uuidOf(6, 1)])
  })

  it('notes a proposal that is already saved and an unknown role', async () => {
    const env = setup()
    env.rbac.previewRoleAclChange.mockResolvedValueOnce(previewOf({ proposed: { isSuperAdmin: false, features: ['sales.orders.view'], organizations: null } }))
    expect((await roleAclPreviewKind.liveRecords!.list(proposal() as never, listContext(env))).notes).toEqual([ROLE_ACL_PREVIEW_I18N.notes.proposalInEffect])
    env.rbac.previewRoleAclChange.mockResolvedValueOnce(previewOf({ currentExists: false, current: { isSuperAdmin: false, features: [], organizations: null }, proposed: { isSuperAdmin: false, features: [], organizations: null } }))
    expect((await roleAclPreviewKind.liveRecords!.list(proposal() as never, listContext(env))).notes).toEqual([])
    env.rbac.previewRoleAclChange.mockResolvedValueOnce(null)
    expect(await roleAclPreviewKind.liveRecords!.list(proposal() as never, listContext(env))).toEqual({ items: [], total: 0, notes: [ROLE_ACL_PREVIEW_I18N.caveats.roleUnavailable] })
  })
})

describe('auth.role_acl_preview API keys per organization', () => {
  const ORG_C = '22222222-0000-4000-8000-0000000000c7'
  const KEY_A = uuidOf(6, 1)
  const KEY_C = uuidOf(6, 2)

  function apiKeyEnv(apiKeyViewOrganizations: string[]) {
    const env = setup()
    env.rows.organizations.push({ id: ORG_C, tenant: { id: TENANT }, tenantId: TENANT, name: 'Gamma', ancestorIds: [ORG_A], deletedAt: null })
    env.rows.apiKeys.push(
      { id: KEY_A, tenantId: TENANT, organizationId: ORG_A, rolesJson: [env.role.id], deletedAt: null, expiresAt: null, sessionUserId: null, name: 'Alpha key', keyPrefix: 'omk_a' },
      { id: KEY_C, tenantId: TENANT, organizationId: ORG_C, rolesJson: [env.role.id], deletedAt: null, expiresAt: null, sessionUserId: null, name: 'Gamma key', keyPrefix: 'omk_c' },
    )
    const service = new RbacService(env.em as never)
    const featureAccess = jest.spyOn(service, 'resolveFeatureOrganizationAccess').mockImplementation(async (_userId, required) => ({
      unrestricted: false,
      filterOrganizationIds: (candidates) => candidates
        .map((candidate) => candidate.id)
        .filter((id) => required.length === 1 && required[0] === 'api_keys.view' && apiKeyViewOrganizations.includes(id)),
    }))
    const resolve = <T,>(name: string): T | undefined => (name === 'rbacService' ? (service as unknown as T) : undefined)
    return { env, resolve, featureAccess }
  }

  function inlineRunContext(env: ReturnType<typeof setup>, resolve: <T>(name: string) => T | undefined): SimulationRunContext<null> {
    return {
      em: env.em as never,
      scope: SCOPE,
      requesterUserId: ACTOR,
      artifactId: env.role.id,
      window: { from: new Date(0), to: new Date(0) },
      budget: { recordsRemaining: 1, sliceDeadlineAt: 0, runDeadlineAt: 0, maxBatchRows: 1, maxBatchBytes: 1 },
      state: null,
      now: () => Date.parse('2026-10-10T12:00:00.000Z'),
      hasFeatures: async () => true,
      eventAdapters: [],
      scanAuditLog: async () => ({ entries: [], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 }),
      inline: { organizationIds: [ORG_A, ORG_C], resolve },
    }
  }

  const apiKeyGroups = (slice: Awaited<ReturnType<typeof roleAclPreviewKind.run>>) => (slice.status === 'done'
    ? slice.result.groups.map((group) => group.key).filter((key) => key.endsWith(':api_keys'))
    : [])

  it('counts API keys only in organizations where the requester holds api_keys.view, not everywhere the run-organization check reaches', async () => {
    const { env, resolve, featureAccess } = apiKeyEnv([ORG_A])
    const slice = await roleAclPreviewKind.run(proposal() as never, inlineRunContext(env, resolve) as never)
    expect(apiKeyGroups(slice)).toEqual([roleAclPreviewGroupKey(ORG_A, 'api_key')])
    expect(slice.status === 'done' && slice.result.caveats).not.toContain(ROLE_ACL_PREVIEW_I18N.caveats.apiKeysHidden)
    expect(featureAccess).toHaveBeenCalledWith(ACTOR, ['api_keys.view'], { tenantId: TENANT })
  })

  it('hides API keys, with the caveat, when no organization of the run grants api_keys.view', async () => {
    const { env, resolve } = apiKeyEnv([])
    const slice = await roleAclPreviewKind.run(proposal() as never, inlineRunContext(env, resolve) as never)
    expect(apiKeyGroups(slice)).toEqual([])
    expect(slice.status === 'done' && slice.result.caveats).toContain(ROLE_ACL_PREVIEW_I18N.caveats.apiKeysHidden)
  })

  it('lists live API keys only of organizations where the viewer holds api_keys.view', async () => {
    const { env, resolve } = apiKeyEnv([ORG_A])
    const page = await roleAclPreviewKind.liveRecords!.list(proposal() as never, {
      em: env.em as never, scope: SCOPE, viewerUserId: ACTOR, artifactId: env.role.id, organizationIds: [ORG_A, ORG_C], page: 1, pageSize: 50, hasFeatures: async () => true, resolve,
    })
    expect(page.items.filter((item) => item.type === 'api_key').map((item) => item.id)).toEqual([KEY_A])
    expect(page.items.flatMap((item) => item.groupKeys)).not.toContain(roleAclPreviewGroupKey(ORG_C, 'api_key'))
  })
})
