import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { CustomerInteraction } from '../../data/entities'
import { hydrateCanonicalInteractions } from '../interactionReadModel'
import { mapInteractionRecordToTodoRow } from '../todoCompatibility'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: EntityManager, entity: typeof User, where: Record<string, unknown>) => em.find(entity, where),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

const tenantId = 'tenant-a'
const organizationId = 'organization-a'

const users = [
  { id: 'author-user', tenantId, name: 'Author', email: 'author@example.com' },
  { id: 'assignee-user', tenantId, name: 'Assignee', email: 'assignee@example.com' },
  { id: 'nameless-user', tenantId, name: null, email: 'nameless@example.com' },
]

function makeTask(id: string, ownerUserId: string | null): CustomerInteraction {
  return {
    id,
    tenantId,
    organizationId,
    authorUserId: 'author-user',
    ownerUserId,
    entity: 'person-1',
    interactionType: 'task',
    status: 'planned',
    createdAt: new Date('2026-11-28T09:00:00Z'),
    updatedAt: new Date('2026-11-28T09:00:00Z'),
  } as unknown as CustomerInteraction
}

describe('task assignee in the customer tasks list', () => {
  const em = {
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== User) return []
      const ids = where.id as { $in: string[] }
      return users.filter((user) => ids.$in.includes(user.id) && user.tenantId === where.tenantId)
    }),
  }

  async function hydrate(interactions: CustomerInteraction[]) {
    return hydrateCanonicalInteractions({
      em: em as unknown as EntityManager,
      container: { resolve: jest.fn() },
      auth: { tenantId, orgId: organizationId },
      selectedOrganizationId: organizationId,
      interactions,
    })
  }

  it('loads author and assignee profiles in one lookup', async () => {
    em.find.mockClear()
    const [record] = await hydrate([makeTask('task-1', 'assignee-user')])

    expect(record).toMatchObject({
      authorName: 'Author',
      ownerUserId: 'assignee-user',
      ownerName: 'Assignee',
      ownerEmail: 'assignee@example.com',
    })
    const userLookups = em.find.mock.calls.filter(([entity]) => entity === User)
    expect(userLookups).toHaveLength(1)
    expect((userLookups[0][1] as { id: { $in: string[] } }).id.$in.sort()).toEqual(['assignee-user', 'author-user'])
  })

  it('exposes the assignee on the todo row, falling back to the e-mail when the user has no name', async () => {
    const records = await hydrate([
      makeTask('named', 'assignee-user'),
      makeTask('nameless', 'nameless-user'),
      makeTask('unassigned', null),
      makeTask('unknown', 'missing-user'),
    ])
    const rows = Object.fromEntries(records.map((record) => [record.id, mapInteractionRecordToTodoRow(record, null)]))

    expect(rows.named).toMatchObject({ todoOwnerUserId: 'assignee-user', todoOwnerName: 'Assignee' })
    expect(rows.nameless).toMatchObject({ todoOwnerUserId: 'nameless-user', todoOwnerName: 'nameless@example.com' })
    expect(rows.unassigned).toMatchObject({ todoOwnerUserId: null, todoOwnerName: null })
    expect(rows.unknown).toMatchObject({ todoOwnerUserId: 'missing-user', todoOwnerName: null })
  })
})
