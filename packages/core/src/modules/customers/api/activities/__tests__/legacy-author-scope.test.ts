import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CustomerActivity } from '../../../data/entities'
import { GET } from '../route'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: EntityManager, entity: typeof User, where: Record<string, unknown>) => em.find(entity, where),
}))

jest.mock('../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn(async () => ({ unified: false, legacyAdapters: true })),
}))

jest.mock('../../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn(async () => ({
    auth: { sub: 'viewer', tenantId: 'tenant-1', orgId: 'org-parent' },
    em: mockEm,
    container: { resolve: jest.fn() },
    organizationIds: mockOrganizationIds,
    selectedOrganizationId: mockSelectedOrganizationId,
    scope: { allowedIds: null },
  })),
}))

jest.mock('../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(async () => []),
}))

const users = [
  { id: 'parent-author', tenantId: 'tenant-1', organizationId: 'org-parent', deletedAt: null, name: 'Parent author', email: 'parent@example.com' },
  { id: 'child-author', tenantId: 'tenant-1', organizationId: 'org-child', deletedAt: null, name: 'Child author', email: 'child@example.com' },
  { id: 'foreign-author', tenantId: 'tenant-2', organizationId: 'foreign-org', deletedAt: null, name: 'Foreign author', email: 'foreign@example.com' },
]

const rows = [
  { id: 'valid-parent', organizationId: 'org-parent', authorUserId: 'parent-author' },
  { id: 'valid-child', organizationId: 'org-child', authorUserId: 'child-author' },
  { id: 'poisoned-child-reference', organizationId: 'org-parent', authorUserId: 'child-author' },
  { id: 'poisoned-tenant-reference', organizationId: 'org-parent', authorUserId: 'foreign-author' },
].map((row) => ({
  ...row,
  tenantId: 'tenant-1',
  entity: 'person-1',
  activityType: 'call',
  createdAt: new Date('2026-10-28T12:00:00Z'),
}))

let mockSelectedOrganizationId: string | null = null
let mockOrganizationIds: string[] | null = null
const mockEm = {
  find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity !== User) return []
    const ids = where.id as { $in: string[] }
    return users.filter((user) => ids.$in.includes(user.id)
      && (where.tenantId === undefined || user.tenantId === where.tenantId)
      && (where.organizationId === undefined || user.organizationId === where.organizationId)
      && (where.deletedAt === undefined || user.deletedAt === where.deletedAt))
  }),
  findAndCount: jest.fn(async (entity: unknown) => entity === CustomerActivity ? [rows, rows.length] : [[], 0]),
  count: jest.fn(async (entity: unknown) => entity === CustomerActivity ? rows.length : 0),
}

const cases: Array<{ name: string; selectedOrganizationId: string | null; organizationIds: string[] | null }> = [
  { name: 'all organizations', selectedOrganizationId: null, organizationIds: null },
  { name: 'a selected parent and its descendants', selectedOrganizationId: 'org-parent', organizationIds: ['org-parent', 'org-child'] },
]

describe('legacy activity author enrichment uses each stored row scope', () => {
  it.each(cases)('supports $name without exposing poisoned author references', async ({ selectedOrganizationId, organizationIds }) => {
    jest.clearAllMocks()
    mockSelectedOrganizationId = selectedOrganizationId
    mockOrganizationIds = organizationIds

    const response = await GET(new Request('http://localhost/api/customers/activities'))
    const body = await response.json() as { items: Array<{ id: string; authorName: string | null; authorEmail: string | null }> }

    expect(response.status).toBe(200)
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'valid-parent', authorName: 'Parent author', authorEmail: 'parent@example.com' }),
      expect.objectContaining({ id: 'valid-child', authorName: 'Child author', authorEmail: 'child@example.com' }),
      expect.objectContaining({ id: 'poisoned-child-reference', authorName: null, authorEmail: null }),
      expect.objectContaining({ id: 'poisoned-tenant-reference', authorName: null, authorEmail: null }),
    ]))
    for (const item of body.items) {
      expect(item).not.toHaveProperty('tenantId')
      expect(item).not.toHaveProperty('organizationId')
    }
    expect(mockEm.find).toHaveBeenCalledWith(User, expect.objectContaining({
      tenantId: 'tenant-1', organizationId: 'org-child', deletedAt: null,
    }))
  })
})
