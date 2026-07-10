/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { register } from '../di'
import type { StaffMemberDirectory } from '../services/staffMemberDirectory'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))

const findMock = jest.mocked(findWithDecryption)

describe('staff/di registrations', () => {
  it('registers the availabilityAccessResolver token with a resolveAvailabilityWriteAccess method', () => {
    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    register(container)
    expect(container.hasRegistration('availabilityAccessResolver')).toBe(true)
    const resolver = container.resolve<{
      resolveAvailabilityWriteAccess: unknown
    }>('availabilityAccessResolver')
    expect(typeof resolver.resolveAvailabilityWriteAccess).toBe('function')
  })

  it('injects the registered entity manager into staffMemberDirectory in CLASSIC mode', async () => {
    const em = {} as EntityManager
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue(em) })
    register(container)
    findMock.mockResolvedValueOnce([])

    expect(container.hasRegistration('staffMemberDirectory')).toBe(true)
    const directory = container.resolve<StaffMemberDirectory>('staffMemberDirectory')
    await directory.listActiveSchedulingRefs({
      userIds: ['11111111-1111-4111-8111-111111111111'],
      tenantId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
    })

    expect(findMock.mock.calls[0]?.[0]).toBe(em)
  })

  it('scopes staffMemberDirectory instances to the current container scope', () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue({} as EntityManager) })
    register(container)
    const firstScope = container.createScope()
    const secondScope = container.createScope()

    const firstDirectory = firstScope.resolve<StaffMemberDirectory>('staffMemberDirectory')
    const sameScopeDirectory = firstScope.resolve<StaffMemberDirectory>('staffMemberDirectory')
    const secondDirectory = secondScope.resolve<StaffMemberDirectory>('staffMemberDirectory')

    expect(sameScopeDirectory).toBe(firstDirectory)
    expect(secondDirectory).not.toBe(firstDirectory)
  })

  it('returns undefined (not throws) when consumer uses allowUnregistered on a container without staff', () => {
    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    const availabilityAccessResolver = container.resolve('availabilityAccessResolver', {
      allowUnregistered: true,
    })
    const staffMemberDirectory = container.resolve('staffMemberDirectory', {
      allowUnregistered: true,
    })
    expect(availabilityAccessResolver).toBeUndefined()
    expect(staffMemberDirectory).toBeUndefined()
  })
})
