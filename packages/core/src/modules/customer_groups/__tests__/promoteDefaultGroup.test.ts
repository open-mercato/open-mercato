import type { EntityManager } from '@mikro-orm/postgresql'
import { promoteDefaultGroup } from '../api/customer-groups/crud'

jest.mock('#generated/entities.ids.generated', () => ({
  E: { customer_groups: { customer_group: 'customer_groups:customer_group' } },
}))

function defaultUniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'customer_groups_tenant_default_unique',
  })
}

function makeEm(failures: unknown[]) {
  const nativeUpdate = jest.fn().mockResolvedValue(1)
  const transactional = jest.fn(async (work: (tem: EntityManager) => Promise<void>) => {
    const failure = failures.shift()
    if (failure) throw failure
    await work({ nativeUpdate } as unknown as EntityManager)
  })
  return { em: { transactional } as unknown as EntityManager, transactional, nativeUpdate }
}

describe('promoteDefaultGroup', () => {
  it('retries when a concurrent promotion wins the default unique index', async () => {
    const { em, transactional, nativeUpdate } = makeEm([defaultUniqueViolation()])
    await promoteDefaultGroup(em, 'tenant-1', 'group-1', new Date())
    expect(transactional).toHaveBeenCalledTimes(2)
    expect(nativeUpdate).toHaveBeenCalledTimes(2)
  })

  it('gives up with the unique violation after repeated conflicts', async () => {
    const { em, transactional } = makeEm([defaultUniqueViolation(), defaultUniqueViolation(), defaultUniqueViolation()])
    await expect(promoteDefaultGroup(em, 'tenant-1', 'group-1', new Date())).rejects.toMatchObject({ code: '23505' })
    expect(transactional).toHaveBeenCalledTimes(3)
  })

  it('does not retry unrelated failures', async () => {
    const { em, transactional } = makeEm([new Error('connection lost')])
    await expect(promoteDefaultGroup(em, 'tenant-1', 'group-1', new Date())).rejects.toThrow('connection lost')
    expect(transactional).toHaveBeenCalledTimes(1)
  })
})
