import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  Document,
  DocumentShare,
  type DocumentSharePermission,
  type DocumentSharePrincipalType,
} from '../data/entities'
import {
  hasTier,
  resolveActiveSubjectRoleIds,
  resolvePermission,
  resolveUserAccess,
  TIER_RANK,
  type DocumentTier,
} from '../lib/permissions'

const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'
const DOCUMENT_ID = 'document-1'
const OWNER_ID = 'owner-1'
const USER_ID = 'user-1'
const ROLE_ID = 'role-1'
const KEY_ROLE_ID = 'role-key'
const API_KEY_ID = 'key-1'

type MockDocumentRow = Pick<
  Document,
  'id' | 'tenantId' | 'organizationId' | 'ownerUserId' | 'deletedAt'
>

type MockShareRow = Pick<
  DocumentShare,
  | 'documentId'
  | 'tenantId'
  | 'organizationId'
  | 'principalType'
  | 'principalId'
  | 'permission'
  | 'deletedAt'
>

type PrincipalFilter = {
  principalType?: unknown
  principalId?: unknown
}

type MockUserRoleRow = {
  user: string
  role: { id: string; tenantId: string; deletedAt: Date | null }
  deletedAt: Date | null
}

type MockApiKeyRow = {
  id: string
  tenantId: string
  rolesJson: string[]
  expiresAt: Date | null
  deletedAt: Date | null
}

type MockRoleRow = {
  id: string
  tenantId: string
  deletedAt: Date | null
}

function makeDocument(overrides: Partial<MockDocumentRow> = {}): MockDocumentRow {
  return {
    id: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ownerUserId: OWNER_ID,
    deletedAt: null,
    ...overrides,
  }
}

function makeShare(input: {
  permission: DocumentSharePermission
  principalType?: DocumentSharePrincipalType
  principalId?: string
  deletedAt?: Date | null
}): MockShareRow {
  return {
    documentId: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    principalType: input.principalType ?? 'user',
    principalId: input.principalId ?? USER_ID,
    permission: input.permission,
    deletedAt: input.deletedAt ?? null,
  }
}

function makeCtx(overrides: Partial<NonNullable<AuthContext>> = {}): NonNullable<AuthContext> {
  return {
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    organizationId: ORGANIZATION_ID,
    roles: [],
    roleIds: [],
    features: [],
    ...overrides,
  }
}

function readQuery(where: unknown): Record<string, unknown> {
  return where && typeof where === 'object' ? where as Record<string, unknown> : {}
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function principalMatches(share: MockShareRow, filter: PrincipalFilter): boolean {
  if (filter.principalType !== share.principalType) return false
  if (typeof filter.principalId === 'string') return filter.principalId === share.principalId
  const principalIdFilter = readQuery(filter.principalId)
  const ids = stringArray(principalIdFilter.$in)
  return ids.includes(share.principalId)
}

class MockEntityManager {
  constructor(
    private readonly document: MockDocumentRow | null,
    private readonly shares: MockShareRow[] = [],
    private readonly userRoles: MockUserRoleRow[] = [],
    private readonly apiKeys: MockApiKeyRow[] = [],
    private readonly roles: MockRoleRow[] = [],
  ) {}

  async findOne(entity: unknown, where: unknown): Promise<unknown> {
    const query = readQuery(where)
    if (entity !== Document || !this.document) return null
    if (query.id !== this.document.id) return null
    if (query.tenantId !== this.document.tenantId) return null
    if (query.organizationId !== this.document.organizationId) return null
    if (query.deletedAt === null && this.document.deletedAt !== null) return null
    return this.document
  }

  async find(entity: unknown, where: unknown): Promise<unknown[]> {
    const query = readQuery(where)
    if (entity !== DocumentShare) return []
    const principalFilters = Array.isArray(query.$or)
      ? query.$or.map((filter) => readQuery(filter) as PrincipalFilter)
      : []

    return this.shares.filter((share) => {
      if (query.documentId !== share.documentId) return false
      if (query.tenantId !== share.tenantId) return false
      if (query.organizationId !== share.organizationId) return false
      if (query.deletedAt === null && share.deletedAt !== null) return false
      return principalFilters.some((filter) => principalMatches(share, filter))
    })
  }
}

function mockServiceContainer(input: {
  userRoles?: MockUserRoleRow[]
  apiKeys?: MockApiKeyRow[]
  roles?: MockRoleRow[]
  manageUserIds?: string[]
  missingAuth?: boolean
  missingApiKeys?: boolean
  missingRbac?: boolean
} = {}) {
  const userRoles = input.userRoles ?? []
  const apiKeys = input.apiKeys ?? []
  const roles = input.roles ?? []
  const manageUserIds = input.manageUserIds ?? []
  const authPrincipalService = {
    principalExists: jest.fn(async () => false),
    resolveLabels: jest.fn(async () => []),
    listSuperAdminUserIds: jest.fn(async () => []),
    resolveActiveUserRoleIds: jest.fn(async (userId: string, scope: { tenantId: string }) =>
      userRoles.filter((row) => row.user === userId
        && row.deletedAt === null
        && row.role.tenantId === scope.tenantId
        && row.role.deletedAt === null)
        .map((row) => row.role.id)),
    filterActiveRoleIds: jest.fn(async (ids: string[], scope: { tenantId: string }) =>
      roles.filter((role) => ids.includes(role.id)
        && role.tenantId === scope.tenantId
        && role.deletedAt === null)
        .map((role) => role.id)),
  }
  const apiKeyPrincipalService = {
    resolveAssignedRoleIds: jest.fn(async (apiKeyId: string, scope: { tenantId: string }) => {
      const key = apiKeys.find((candidate) => candidate.id === apiKeyId
        && candidate.tenantId === scope.tenantId
        && candidate.deletedAt === null)
      if (!key || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) return []
      return key.rolesJson
    }),
  }
  const rbacService = {
    userHasAllFeatures: jest.fn(async (userId: string, required: string[]) => (
      required.length === 1
      && required[0] === 'documents.manage'
      && manageUserIds.includes(userId)
    )),
  }
  return {
    resolve(name: string) {
      if (name === 'authPrincipalService' && !input.missingAuth) return authPrincipalService
      if (name === 'apiKeyPrincipalService' && !input.missingApiKeys) return apiKeyPrincipalService
      if (name === 'rbacService' && !input.missingRbac) return rbacService
      throw new Error('missing')
    },
  }
}

function mockEm(
  document: MockDocumentRow | null,
  shares: MockShareRow[] = [],
  userRoles: MockUserRoleRow[] = [],
  apiKeys: MockApiKeyRow[] = [],
  roles: MockRoleRow[] = [],
): EntityManager {
  return new MockEntityManager(document, shares, userRoles, apiKeys, roles) as unknown as EntityManager
}

describe('documents permission tiers', () => {
  it('returns owner when the actor owns the document', async () => {
    const result = await resolvePermission(
      mockEm(makeDocument({ ownerUserId: USER_ID })),
      DOCUMENT_ID,
      makeCtx(),
    )
    expect(result).toBe('owner')
  })

  it('returns owner when the actor has documents.manage', async () => {
    const result = await resolvePermission(
      mockEm(makeDocument()),
      DOCUMENT_ID,
      makeCtx({ features: ['documents.manage'] }),
    )
    expect(result).toBe('owner')
  })

  it.each<DocumentSharePermission>(['viewer', 'commenter', 'editor'])(
    'resolves direct user share tier %s',
    async (permission) => {
      const result = await resolvePermission(
        mockEm(makeDocument(), [makeShare({ permission })]),
        DOCUMENT_ID,
        makeCtx(),
      )
      expect(result).toBe(permission)
    },
  )

  it('ignores a matching role share carried only by stale token claims', async () => {
    const result = await resolvePermission(
      mockEm(makeDocument(), [
        makeShare({ principalType: 'role', principalId: ROLE_ID, permission: 'commenter' }),
      ]),
      DOCUMENT_ID,
      makeCtx({ roleIds: [ROLE_ID] }),
    )
    expect(result).toBeNull()
  })

  it('resolves a matching role share from an active current-tenant assignment', async () => {
    const result = await resolvePermission(
      mockEm(
        makeDocument(),
        [makeShare({ principalType: 'role', principalId: ROLE_ID, permission: 'commenter' })],
        [{
          user: USER_ID,
          role: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: null },
          deletedAt: null,
        }],
      ),
      DOCUMENT_ID,
      makeCtx({ roleIds: [], roles: [], resolvedRoleIds: [ROLE_ID] } as Partial<NonNullable<AuthContext>>),
    )
    expect(result).toBe('commenter')
  })

  it('returns the maximum tier when multiple shares apply', async () => {
    const result = await resolvePermission(
      mockEm(
        makeDocument(),
        [
          makeShare({ permission: 'viewer' }),
          makeShare({ principalType: 'role', principalId: ROLE_ID, permission: 'editor' }),
          makeShare({ permission: 'commenter' }),
        ],
        [{
          user: USER_ID,
          role: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: null },
          deletedAt: null,
        }],
      ),
      DOCUMENT_ID,
      makeCtx({ roleIds: [ROLE_ID], resolvedRoleIds: [ROLE_ID] } as Partial<NonNullable<AuthContext>>),
    )
    expect(result).toBe('editor')
  })

  it('returns null when no owner or share grants access', async () => {
    const result = await resolvePermission(mockEm(makeDocument()), DOCUMENT_ID, makeCtx())
    expect(result).toBeNull()
  })

  it('returns null for a soft-deleted document', async () => {
    const result = await resolvePermission(
      mockEm(makeDocument({ deletedAt: new Date('2026-07-08T00:00:00.000Z') })),
      DOCUMENT_ID,
      makeCtx(),
    )
    expect(result).toBeNull()
  })

  it('resolves explicit recipient access from UserRole role ids', async () => {
    const result = await resolveUserAccess(
      mockEm(
        makeDocument(),
        [makeShare({ principalType: 'role', principalId: ROLE_ID, permission: 'editor' })],
        [{
          user: USER_ID,
          role: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: null },
          deletedAt: null,
        }],
      ),
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      USER_ID,
      mockServiceContainer({ userRoles: [{
        user: USER_ID,
        role: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: null },
        deletedAt: null,
      }] }),
    )
    expect(result).toBe('editor')
  })

  it('ignores role shares from soft-deleted or cross-tenant current roles', async () => {
    const result = await resolveUserAccess(
      mockEm(
        makeDocument(),
        [makeShare({ principalType: 'role', principalId: ROLE_ID, permission: 'editor' })],
        [
          {
            user: USER_ID,
            role: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: new Date() },
            deletedAt: null,
          },
          {
            user: USER_ID,
            role: { id: ROLE_ID, tenantId: 'tenant-2', deletedAt: null },
            deletedAt: null,
          },
        ],
      ),
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      USER_ID,
      mockServiceContainer({ userRoles: [
        { user: USER_ID, role: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: new Date() }, deletedAt: null },
        { user: USER_ID, role: { id: ROLE_ID, tenantId: 'tenant-2', deletedAt: null }, deletedAt: null },
      ] }),
    )

    expect(result).toBeNull()
  })

  it('resolves API-key roles from the active key and active same-tenant Role rows only', async () => {
    const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
    const activeKey: MockApiKeyRow = {
      id: API_KEY_ID,
      tenantId: TENANT_ID,
      rolesJson: [KEY_ROLE_ID, 'deleted-role', 'cross-tenant-role'],
      expiresAt: new Date(Date.now() + 60_000),
      deletedAt: null,
    }
    const roles: MockRoleRow[] = [
      { id: KEY_ROLE_ID, tenantId: TENANT_ID, deletedAt: null },
      { id: 'deleted-role', tenantId: TENANT_ID, deletedAt: new Date() },
      { id: 'cross-tenant-role', tenantId: 'tenant-2', deletedAt: null },
    ]

    await expect(resolveActiveSubjectRoleIds(
      mockServiceContainer({ apiKeys: [activeKey], roles }),
      scope,
      `api_key:${API_KEY_ID}`,
    )).resolves.toEqual([KEY_ROLE_ID])

    await expect(resolveActiveSubjectRoleIds(
      mockServiceContainer({ apiKeys: [{ ...activeKey, deletedAt: new Date() }], roles }),
      scope,
      `api_key:${API_KEY_ID}`,
    )).resolves.toEqual([])

    await expect(resolveActiveSubjectRoleIds(
      mockServiceContainer({ apiKeys: [{ ...activeKey, expiresAt: new Date(Date.now() - 1) }], roles }),
      scope,
      `api_key:${API_KEY_ID}`,
    )).resolves.toEqual([])
  })

  it('uses key roles rather than the backing user roles for API-key role shares', async () => {
    const activeKey: MockApiKeyRow = {
      id: API_KEY_ID,
      tenantId: TENANT_ID,
      rolesJson: [KEY_ROLE_ID],
      expiresAt: null,
      deletedAt: null,
    }
    const result = await resolvePermission(
      mockEm(
        makeDocument(),
        [
          makeShare({ principalType: 'role', principalId: ROLE_ID, permission: 'editor' }),
          makeShare({ principalType: 'role', principalId: KEY_ROLE_ID, permission: 'viewer' }),
        ],
        [{
          user: USER_ID,
          role: { id: ROLE_ID, tenantId: TENANT_ID, deletedAt: null },
          deletedAt: null,
        }],
        [activeKey],
        [{ id: KEY_ROLE_ID, tenantId: TENANT_ID, deletedAt: null }],
      ),
      DOCUMENT_ID,
      makeCtx({
        sub: `api_key:${API_KEY_ID}`,
        userId: USER_ID,
        isApiKey: true,
        // Even stale claims cannot reintroduce the backing user's role.
        roleIds: [ROLE_ID],
        roles: [ROLE_ID],
        resolvedRoleIds: [KEY_ROLE_ID],
      }),
    )

    expect(result).toBe('viewer')
  })

  it('treats the live documents.manage grant as recipient access', async () => {
    const result = await resolveUserAccess(
      mockEm(makeDocument()),
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      USER_ID,
      mockServiceContainer({ manageUserIds: [USER_ID] }),
    )
    expect(result).toBe('owner')
  })

  it('fails closed for role shares when a principal provider is missing', async () => {
    await expect(resolveActiveSubjectRoleIds(
      mockServiceContainer({ missingAuth: true }),
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      `api_key:${API_KEY_ID}`,
    )).resolves.toEqual([])
  })

  it('ignores a soft-deleted share', async () => {
    const result = await resolvePermission(
      mockEm(makeDocument(), [
        makeShare({ permission: 'editor', deletedAt: new Date('2026-07-08T00:00:00.000Z') }),
      ]),
      DOCUMENT_ID,
      makeCtx(),
    )
    expect(result).toBeNull()
  })

  it('orders tiers as owner > editor > commenter > viewer', () => {
    expect(TIER_RANK.owner).toBeGreaterThan(TIER_RANK.editor)
    expect(TIER_RANK.editor).toBeGreaterThan(TIER_RANK.commenter)
    expect(TIER_RANK.commenter).toBeGreaterThan(TIER_RANK.viewer)

    const tiers: DocumentTier[] = ['viewer', 'commenter', 'editor', 'owner']
    expect(tiers.map((tier) => hasTier(tier, 'viewer'))).toEqual([true, true, true, true])
    expect(tiers.map((tier) => hasTier(tier, 'commenter'))).toEqual([false, true, true, true])
    expect(tiers.map((tier) => hasTier(tier, 'editor'))).toEqual([false, false, true, true])
    expect(tiers.map((tier) => hasTier(tier, 'owner'))).toEqual([false, false, false, true])
    expect(hasTier(null, 'viewer')).toBe(false)
  })
})
