import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveUserLabels } from '../lib/userLabels'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000002'
const USER_ID_1 = '00000000-0000-4000-8000-000000000003'
const USER_ID_2 = '00000000-0000-4000-8000-000000000004'
const UNKNOWN_USER_ID = '00000000-0000-4000-8000-000000000005'

type FindUsersWithDecryption = (
  em: EntityManager,
  entityName: typeof User,
  where: FilterQuery<User>,
  options: Record<string, never>,
  scope: { tenantId: string; organizationId: string },
) => Promise<User[]>

const findWithDecryptionMock = findWithDecryption as unknown as jest.MockedFunction<FindUsersWithDecryption>
const mockEm = {} as EntityManager

function makeUser(input: {
  id: string
  email: string
  name?: string | null
  organizationId?: string | null
}): User {
  const user = new User()
  user.id = input.id
  user.email = input.email
  user.name = input.name ?? null
  user.organizationId = input.organizationId ?? ORGANIZATION_ID
  user.tenantId = TENANT_ID
  user.deletedAt = null
  return user
}

describe('resolveUserLabels', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('resolves name-first labels, falls back to email, omits unknown ids, and dedupes input', async () => {
    findWithDecryptionMock.mockResolvedValue([
      makeUser({ id: USER_ID_1, name: 'Ada Lovelace', email: 'ada@example.test' }),
      makeUser({ id: USER_ID_2, name: null, email: 'grace@example.test' }),
    ])

    const labels = await resolveUserLabels(
      mockEm,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [USER_ID_1, USER_ID_1, USER_ID_2, UNKNOWN_USER_ID],
    )

    expect(labels.get(USER_ID_1)).toEqual({ label: 'Ada Lovelace', secondary: 'ada@example.test' })
    expect(labels.get(USER_ID_2)).toEqual({ label: 'grace@example.test', secondary: null })
    expect(labels.has(UNKNOWN_USER_ID)).toBe(false)
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock).toHaveBeenCalledWith(mockEm, User, {
      id: { $in: [USER_ID_1, USER_ID_2, UNKNOWN_USER_ID] },
      tenantId: TENANT_ID,
      deletedAt: null,
      $or: [{ organizationId: null }, { organizationId: ORGANIZATION_ID }],
    }, {}, { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
  })

  it('returns an empty map without querying for empty input', async () => {
    const labels = await resolveUserLabels(
      mockEm,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [],
    )

    expect(labels.size).toBe(0)
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('never promotes UUID-bearing names or emails into user-visible labels', async () => {
    findWithDecryptionMock.mockResolvedValue([
      makeUser({
        id: USER_ID_1,
        name: `Agent ${USER_ID_1}`,
        email: `${USER_ID_2}@example.test`,
      }),
      makeUser({
        id: USER_ID_2,
        name: `Agent ${USER_ID_1}`,
        email: 'safe@example.test',
      }),
    ])

    const labels = await resolveUserLabels(
      mockEm,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      [USER_ID_1, USER_ID_2],
    )

    expect(labels.has(USER_ID_1)).toBe(false)
    expect(labels.get(USER_ID_2)).toEqual({ label: 'safe@example.test', secondary: null })
  })
})
