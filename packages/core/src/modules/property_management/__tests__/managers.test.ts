/** @jest-environment node */
import type { SearchTokenLookupResult } from '@open-mercato/shared/lib/search/tokenLookup'

type FakeUser = { id: string; name: string | null; email: string | null }

const calls: Array<{ where: Record<string, unknown>; options: unknown }> = []
const state: { users: FakeUser[]; lookup: SearchTokenLookupResult } = {
  users: [],
  lookup: { matched: false, reason: 'search-disabled' },
}
const lookupMock = jest.fn(async () => state.lookup)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (_em: unknown, _entity: unknown, where: Record<string, unknown>, options: unknown) => {
    calls.push({ where, options })
    const ids = (where.id as { $in?: string[] } | undefined)?.$in
    return ids ? state.users.filter((user) => ids.includes(user.id)) : state.users
  }),
}))
jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokens: (...args: unknown[]) => lookupMock(...(args as [])),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

import { assertManagerUsers, filterOrganizationUsers, listManagerCandidates, MANAGER_CANDIDATE_SCAN_CAP } from '../lib/managers'

const scope = { tenantId: 'tenant-1', organizationId: 'org-a' }
const em = { getKysely: () => ({}) } as never

beforeEach(() => {
  calls.length = 0
  lookupMock.mockClear()
  state.users = []
  state.lookup = { matched: false, reason: 'search-disabled' }
})

describe('assertManagerUsers', () => {
  it('only accepts users of the building organization', async () => {
    state.users = [{ id: 'u-1', name: 'Ada', email: 'ada@example.com' }]
    await expect(assertManagerUsers(em, scope, ['u-1', 'u-1'])).resolves.toEqual(['u-1'])
    expect(calls[0].where).toEqual({ tenantId: 'tenant-1', organizationId: 'org-a', deletedAt: null, id: { $in: ['u-1'] } })
  })

  it('rejects a user the organization-scoped lookup does not return', async () => {
    state.users = [{ id: 'u-1', name: 'Ada', email: 'ada@example.com' }]
    await expect(assertManagerUsers(em, scope, ['u-1', 'u-other-org'])).rejects.toMatchObject({
      status: 422,
      body: { fieldErrors: { managerUserIds: expect.any(String) } },
    })
  })
})

describe('filterOrganizationUsers', () => {
  it('keeps only the users the organization-scoped lookup still returns', async () => {
    state.users = [{ id: 'u-1', name: 'Ada', email: 'ada@example.com' }]
    await expect(filterOrganizationUsers(em, scope, ['u-1', 'u-gone', 'u-1'])).resolves.toEqual(['u-1'])
    expect(calls[0].where).toEqual({ tenantId: 'tenant-1', organizationId: 'org-a', deletedAt: null, id: { $in: ['u-1', 'u-gone'] } })
  })

  it('skips the lookup for an empty list', async () => {
    await expect(filterOrganizationUsers(em, scope, [])).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('listManagerCandidates', () => {
  it('lists users of the organization only, sorted by decrypted name', async () => {
    state.users = [
      { id: 'u-3', name: 'zoe', email: 'zoe@example.com' },
      { id: 'u-1', name: 'Bob', email: 'bob@example.com' },
      { id: 'u-2', name: null, email: 'adam@example.com' },
    ]
    const result = await listManagerCandidates(em, scope, null, 50)
    expect(result.map((entry) => entry.userId)).toEqual(['u-2', 'u-1', 'u-3'])
    expect(calls[0].where).toEqual({ tenantId: 'tenant-1', organizationId: 'org-a', deletedAt: null })
    expect(calls[0].options).toEqual({ limit: MANAGER_CANDIDATE_SCAN_CAP, orderBy: { id: 'asc' } })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('matches decrypted names and e-mails in memory, never ciphertext in SQL', async () => {
    state.users = [
      { id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: 'u-2', name: 'Grace Hopper', email: 'grace@navy.example' },
    ]
    await expect(listManagerCandidates(em, scope, 'NAVY', 50)).resolves.toEqual([
      { userId: 'u-2', name: 'Grace Hopper', email: 'grace@navy.example' },
    ])
    expect(calls[0].where).toEqual({ tenantId: 'tenant-1', organizationId: 'org-a', deletedAt: null })
    expect(lookupMock).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'auth:user', query: 'NAVY', scope: { tenantId: 'tenant-1' } }))
  })

  it('adds token matches the in-memory match misses', async () => {
    state.users = [
      { id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: 'u-2', name: 'Grace Hopper', email: 'grace@example.com' },
    ]
    state.lookup = { matched: true, ids: ['u-1'] }
    const result = await listManagerCandidates(em, scope, 'lovelace ada', 50)
    expect(result.map((entry) => entry.userId)).toEqual(['u-1'])
  })

  it('loads token matches beyond the scanned page, still within the organization', async () => {
    const scanned = { id: 'u-1', name: 'Ada', email: 'ada@example.com' }
    const beyond = { id: 'u-9', name: 'Zed Token', email: 'zed@example.com' }
    state.users = [scanned, beyond]
    state.lookup = { matched: true, ids: ['u-9'] }
    const { findWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as { findWithDecryption: jest.Mock }
    findWithDecryption.mockImplementationOnce(async (_em: unknown, _entity: unknown, where: Record<string, unknown>, options: unknown) => {
      calls.push({ where, options })
      return [scanned]
    })
    const result = await listManagerCandidates(em, scope, 'zed', 50)
    expect(result.map((entry) => entry.userId)).toEqual(['u-9'])
    expect(calls[1].where).toEqual({ tenantId: 'tenant-1', organizationId: 'org-a', deletedAt: null, id: { $in: ['u-9'] } })
  })

  it('caps the result at the requested limit after sorting', async () => {
    state.users = [
      { id: 'u-1', name: 'C', email: null },
      { id: 'u-2', name: 'A', email: null },
      { id: 'u-3', name: 'B', email: null },
    ]
    const result = await listManagerCandidates(em, scope, null, 2)
    expect(result.map((entry) => entry.name)).toEqual(['A', 'B'])
  })
})
