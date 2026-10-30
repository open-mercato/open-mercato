import type { EntityManager } from '@mikro-orm/postgresql'

const findPeopleByAddresses = jest.fn()
jest.mock('@open-mercato/core/modules/customers/lib/findPeopleByAddresses', () => ({
  findPeopleByAddresses: (...a: unknown[]) => findPeopleByAddresses(...a),
}))

import { resolveSubject } from '../inbound/route'

const scope = { tenantId: 't1', organizationId: 'o1' }

/**
 * `resolveSubject` is the inbound hook's actual write-enrolling decision: who the post is about. The
 * `customerId` branch is exercised by the integration suite (TC-MA-020); the email branch — the one
 * AGENTS.md itself calls out as the fragile, bounded-scan path — had no test of any kind.
 */
describe('resolveSubject', () => {
  beforeEach(() => {
    findPeopleByAddresses.mockReset()
  })

  const customerUuid = '11111111-1111-1111-1111-111111111111'

  test('a valid customerId in scope is trusted directly, without touching the email lookup', async () => {
    const em = { findOne: jest.fn().mockResolvedValue({ id: customerUuid }) } as unknown as EntityManager
    const result = await resolveSubject(em, scope, customerUuid, undefined)
    expect(result).toBe(customerUuid)
    expect(findPeopleByAddresses).not.toHaveBeenCalled()
  })

  test('a customerId from another tenant is not trusted, and falls through to the address', async () => {
    const em = { findOne: jest.fn().mockResolvedValue(null) } as unknown as EntityManager
    findPeopleByAddresses.mockResolvedValue([{ id: 'cust-2' }])
    const result = await resolveSubject(em, scope, customerUuid, 'person@example.com')
    expect(result).toBe('cust-2')
    expect(findPeopleByAddresses).toHaveBeenCalledWith(em, ['person@example.com'], scope.tenantId, scope.organizationId)
  })

  test('a malformed customerId never reaches the uuid column — it falls straight to the address', async () => {
    const em = { findOne: jest.fn() } as unknown as EntityManager
    findPeopleByAddresses.mockResolvedValue([{ id: 'cust-3' }])
    const result = await resolveSubject(em, scope, 'not-a-uuid', 'person@example.com')
    expect(em.findOne).not.toHaveBeenCalled()
    expect(result).toBe('cust-3')
  })

  test('an address that matches nobody, with no customerId, is the honest no-match answer', async () => {
    const em = { findOne: jest.fn() } as unknown as EntityManager
    findPeopleByAddresses.mockResolvedValue([])
    const result = await resolveSubject(em, scope, undefined, 'nobody@example.com')
    expect(result).toBeNull()
  })

  test('neither a customerId nor an email resolves to nobody, without any lookup at all', async () => {
    const em = { findOne: jest.fn() } as unknown as EntityManager
    const result = await resolveSubject(em, scope, undefined, undefined)
    expect(result).toBeNull()
    expect(em.findOne).not.toHaveBeenCalled()
    expect(findPeopleByAddresses).not.toHaveBeenCalled()
  })
})
