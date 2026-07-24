/** @jest-environment node */

import { NO_ORGANIZATION_SENTINEL, resolveDealsOrganizationIds } from '../dealsOrganizationScope'
import type { EntityManager as CoreEntityManager } from '@mikro-orm/core'

const tenantId = '11111111-1111-4111-8111-111111111111'
const accountOrgId = '22222222-2222-4222-8222-222222222222'
const siblingOrgId = '33333333-3333-4333-8333-333333333333'

function createEntityManager(rows: Array<{ id: string }>): {
  em: CoreEntityManager
  execute: jest.Mock
} {
  const execute = jest.fn(async () => rows)
  const em = { getConnection: () => ({ execute }) } as unknown as CoreEntityManager
  return { em, execute }
}

describe('deals organization scope', () => {
  it('honors an explicit organization selection without querying the tenant org tree', async () => {
    const { em, execute } = createEntityManager([])

    const ids = await resolveDealsOrganizationIds({
      em,
      scope: { filterIds: [accountOrgId] },
      auth: { orgId: accountOrgId },
      tenantId,
    })

    expect(ids).toEqual([accountOrgId])
    expect(execute).not.toHaveBeenCalled()
  })

  it('widens to every organization in the tenant when the scope is unrestricted', async () => {
    const { em, execute } = createEntityManager([{ id: accountOrgId }, { id: siblingOrgId }])

    const ids = await resolveDealsOrganizationIds({
      em,
      scope: { filterIds: null },
      auth: { orgId: null },
      tenantId,
    })

    expect(ids).toEqual([accountOrgId, siblingOrgId])
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('scopes the widened lookup to the caller tenant', async () => {
    const { em, execute } = createEntityManager([{ id: accountOrgId }])

    await resolveDealsOrganizationIds({
      em,
      scope: { filterIds: null },
      auth: { orgId: null },
      tenantId,
    })

    expect(execute.mock.calls[0][0]).toContain('tenant_id = ?')
    expect(execute.mock.calls[0][1]).toEqual([tenantId])
  })

  it('falls back to the account organization when the tenant has no organizations', async () => {
    const { em } = createEntityManager([])

    const ids = await resolveDealsOrganizationIds({
      em,
      scope: { filterIds: null },
      auth: { orgId: accountOrgId },
      tenantId,
    })

    expect(ids).toEqual([accountOrgId])
  })

  // A 401 here would send `apiFetch` into a session-refresh loop, so a caller with nothing
  // in scope must read an empty result set rather than an auth error.
  it('narrows to a sentinel that matches no rows when nothing is in scope', async () => {
    const { em } = createEntityManager([])

    const ids = await resolveDealsOrganizationIds({
      em,
      scope: { filterIds: [] },
      auth: { orgId: null },
      tenantId,
    })

    expect(ids).toEqual([NO_ORGANIZATION_SENTINEL])
  })

  it('never returns an empty list, so callers can rely on the first id', async () => {
    const { em } = createEntityManager([])

    for (const scope of [{ filterIds: [] }, { filterIds: null }]) {
      const ids = await resolveDealsOrganizationIds({ em, scope, auth: { orgId: null }, tenantId })
      expect(ids.length).toBeGreaterThan(0)
      expect(ids[0]).toBeTruthy()
    }
  })
})
