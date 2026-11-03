import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { CustomerInteraction } from '../../data/entities'
import { hydrateCanonicalInteractions } from '../interactionReadModel'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: EntityManager, entity: typeof User, where: Record<string, unknown>) => em.find(entity, where),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

const tenantId = 'tenant-a'
const organizationId = 'organization-a'
const otherOrganizationId = 'organization-b'
const foreignTenantId = 'tenant-b'

const users = [
  { id: 'local-user', tenantId, organizationId, deletedAt: null, name: 'Local author', email: 'local@example.com' },
  { id: 'other-org-user', tenantId, organizationId: otherOrganizationId, deletedAt: null, name: 'Other org author', email: 'other-org@example.com' },
  { id: 'foreign-user', tenantId: foreignTenantId, organizationId: 'foreign-org', deletedAt: null, name: 'Foreign author', email: 'foreign@example.com' },
  { id: 'deleted-user', tenantId, organizationId, deletedAt: new Date(), name: 'Deleted author', email: 'deleted@example.com' },
]

function makeInteraction(id: string, authorUserId: string, rowOrganizationId: string | null = organizationId): CustomerInteraction {
  return {
    id,
    tenantId,
    organizationId: rowOrganizationId,
    authorUserId,
    entity: 'person-1',
    interactionType: 'call',
    status: 'done',
    createdAt: new Date('2026-10-28T12:00:00Z'),
    updatedAt: new Date('2026-10-28T12:00:00Z'),
  } as unknown as CustomerInteraction
}

describe('canonical interaction author scope', () => {
  it('preserves same-tenant cross-organization and offboarded authors while hiding foreign or unavailable profiles', async () => {
    const em = {
      find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity !== User) return []
        const ids = where.id as { $in: string[] }
        return users.filter((user) => ids.$in.includes(user.id)
          && (where.tenantId === undefined || user.tenantId === where.tenantId)
          && (where.organizationId === undefined || user.organizationId === where.organizationId)
          && (where.deletedAt === undefined || user.deletedAt === where.deletedAt))
      }),
    }

    const interactions = [
      makeInteraction('local', 'local-user'),
      makeInteraction('poisoned-other-org', 'other-org-user'),
      makeInteraction('valid-other-org', 'other-org-user', otherOrganizationId),
      makeInteraction('poisoned-foreign-tenant', 'foreign-user'),
      makeInteraction('deleted', 'deleted-user'),
      makeInteraction('missing', 'missing-user'),
      makeInteraction('missing-scope', 'local-user', null),
    ]

    const result = await hydrateCanonicalInteractions({
      em: em as unknown as EntityManager,
      container: { resolve: jest.fn() },
      auth: { tenantId, orgId: organizationId },
      selectedOrganizationId: organizationId,
      interactions,
    })

    expect(result.find((item) => item.id === 'local')).toMatchObject({
      authorName: 'Local author', authorEmail: 'local@example.com',
    })
    expect(result.find((item) => item.id === 'valid-other-org')).toMatchObject({
      authorName: 'Other org author', authorEmail: 'other-org@example.com',
    })
    expect(result.find((item) => item.id === 'poisoned-other-org')).toMatchObject({ authorName: 'Other org author', authorEmail: 'other-org@example.com' })
    expect(result.find((item) => item.id === 'deleted')).toMatchObject({ authorName: 'Deleted author', authorEmail: 'deleted@example.com' })
    for (const id of ['poisoned-foreign-tenant', 'missing', 'missing-scope']) {
      expect(result.find((item) => item.id === id)).toMatchObject({ authorName: null, authorEmail: null })
    }
    expect(em.find).toHaveBeenCalledWith(User, expect.objectContaining({
      tenantId,
    }))
  })
})
