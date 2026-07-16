/** @jest-environment node */

import { resolveAggregateOrganizationIds } from '../route'
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

describe('deals aggregate organization scope', () => {
  it('honors an explicit organization selection without querying the tenant org tree', async () => {
    const { em, execute } = createEntityManager([])

    const ids = await resolveAggregateOrganizationIds({
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

    const ids = await resolveAggregateOrganizationIds({
      em,
      scope: { filterIds: null },
      auth: { orgId: null },
      tenantId,
    })

    expect(ids).toEqual([accountOrgId, siblingOrgId])
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][1]).toEqual([tenantId])
  })

  it('scopes the widened lookup to the caller tenant', async () => {
    const { em, execute } = createEntityManager([{ id: accountOrgId }])

    await resolveAggregateOrganizationIds({
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

    const ids = await resolveAggregateOrganizationIds({
      em,
      scope: { filterIds: null },
      auth: { orgId: accountOrgId },
      tenantId,
    })

    expect(ids).toEqual([accountOrgId])
  })

  it('returns an empty list when nothing is in scope', async () => {
    const { em } = createEntityManager([])

    const ids = await resolveAggregateOrganizationIds({
      em,
      scope: { filterIds: [] },
      auth: { orgId: null },
      tenantId,
    })

    expect(ids).toEqual([])
  })
})
