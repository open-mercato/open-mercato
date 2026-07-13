/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import {
  queryUserList,
  type ResolvedUserListScope,
} from '@open-mercato/core/modules/auth/api/users/userListQuery'

const mockFindWithDecryption = jest.fn()
const mockLoadCustomFieldValues = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn((args: unknown) => mockLoadCustomFieldValues(args)),
}))

const mockEm = {
  find: jest.fn(),
  findAndCount: jest.fn(),
  getKysely: jest.fn(),
}

const tenantId = '123e4567-e89b-12d3-a456-426614174001'
const organizationId = '223e4567-e89b-12d3-a456-426614174001'
const roleId = '323e4567-e89b-12d3-a456-426614174001'

function baseScope(overrides: Partial<ResolvedUserListScope> = {}): ResolvedUserListScope {
  return {
    baseFilters: [{ deletedAt: null }, { tenantId }],
    effectiveTenantId: tenantId,
    effectiveSelectedOrganizationId: null,
    scopeOrganizationId: organizationId,
    ...overrides,
  }
}

describe('queryUserList', () => {
  beforeEach(() => {
    mockEm.find.mockReset().mockResolvedValue([])
    mockEm.findAndCount.mockReset().mockResolvedValue([[], 0])
    mockEm.getKysely.mockReset()
    mockFindWithDecryption.mockReset().mockResolvedValue([])
    mockLoadCustomFieldValues.mockReset().mockResolvedValue({})
  })

  test('short-circuits to roleFilterEmpty when a role filter matches no users', async () => {
    mockEm.find.mockResolvedValueOnce([]) // UserRole lookup yields no links

    const result = await queryUserList(mockEm as unknown as EntityManager, {
      query: { page: 1, pageSize: 50, roleIds: [roleId] },
      isSuperAdmin: false,
      scope: baseScope(),
      authTenantId: tenantId,
    })

    expect(result).toEqual({ kind: 'roleFilterEmpty' })
    expect(mockEm.findAndCount).not.toHaveBeenCalled()
  })

  test('narrows the query to matched user ids for a role filter', async () => {
    const matchedUserId = '523e4567-e89b-12d3-a456-426614174001'
    mockEm.find.mockResolvedValueOnce([{ user: { id: matchedUserId }, role: { id: roleId } }])
    mockEm.findAndCount.mockResolvedValueOnce([
      [{ id: matchedUserId, email: 'role@example.com', tenantId, organizationId }],
      1,
    ])

    const result = await queryUserList(mockEm as unknown as EntityManager, {
      query: { page: 1, pageSize: 50, roleIds: [roleId] },
      isSuperAdmin: false,
      scope: baseScope(),
      authTenantId: tenantId,
    })

    const where = mockEm.findAndCount.mock.calls[0][1] as { $and: Array<Record<string, unknown>> }
    expect(where.$and).toEqual(expect.arrayContaining([{ id: { $in: [matchedUserId] } }]))
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.total).toBe(1)
      expect(result.items[0]).toMatchObject({ id: matchedUserId, email: 'role@example.com' })
    }
  })

  test('maps rows into list items with role names and org/tenant names', async () => {
    const userId = '523e4567-e89b-12d3-a456-426614174050'
    mockEm.findAndCount.mockResolvedValueOnce([
      [{ id: userId, email: 'user@example.com', name: 'User', tenantId, organizationId }],
      1,
    ])
    mockFindWithDecryption.mockResolvedValueOnce([{ user: { id: userId }, role: { id: roleId, name: 'admin' } }])
    mockEm.find
      .mockResolvedValueOnce([{ id: organizationId, name: 'Acme' }]) // organization name map
      .mockResolvedValueOnce([{ id: tenantId, name: 'Tenant A' }]) // tenant name map

    const result = await queryUserList(mockEm as unknown as EntityManager, {
      query: { page: 1, pageSize: 50 },
      isSuperAdmin: false,
      scope: baseScope(),
      authTenantId: tenantId,
    })

    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.items[0]).toMatchObject({
        id: userId,
        roles: ['admin'],
        roleIds: [roleId],
        organizationName: 'Acme',
        tenantName: 'Tenant A',
      })
      expect(result.items[0]).not.toHaveProperty('hasPassword')
    }
  })

  test('exposes hasPassword only on id-scoped lookups', async () => {
    const userId = '523e4567-e89b-12d3-a456-426614174051'
    mockEm.findAndCount.mockResolvedValueOnce([
      [{ id: userId, email: 'user@example.com', tenantId, organizationId, passwordHash: '$2a$10$hash' }],
      1,
    ])

    const result = await queryUserList(mockEm as unknown as EntityManager, {
      query: { id: userId, page: 1, pageSize: 1 },
      isSuperAdmin: false,
      scope: baseScope(),
      authTenantId: tenantId,
    })

    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.items[0]).toMatchObject({ id: userId, hasPassword: true })
    }
  })
})
