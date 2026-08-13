/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer, InjectionMode } from 'awilix'
import type { StaffIdentityResolver } from '@open-mercato/core/modules/staff/contracts/identityResolver'
import type { StaffIdentityProjectionResolver } from '@open-mercato/core/modules/staff/contracts/identityProjectionResolver'
import type { StaffCandidateResolver } from '@open-mercato/core/modules/staff/contracts/candidateResolver'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { register } from '../di'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

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

  it('returns undefined (not throws) when consumer uses allowUnregistered on a container without staff', () => {
    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    const resolver = container.resolve('availabilityAccessResolver', {
      allowUnregistered: true,
    })
    expect(resolver).toBeUndefined()
  })

  it('registers a CLASSIC-compatible resolver isolated to each request scope', async () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    register(container)

    const firstScope = container.createScope()
    const secondScope = container.createScope()
    const firstEm = { scope: 'first' } as unknown as EntityManager
    const secondEm = { scope: 'second' } as unknown as EntityManager
    firstScope.register({ em: asValue(firstEm) })
    secondScope.register({ em: asValue(secondEm) })
    const first = firstScope.resolve<StaffIdentityResolver>('staffIdentityResolver')
    const firstAgain = firstScope.resolve<StaffIdentityResolver>('staffIdentityResolver')
    const second = secondScope.resolve<StaffIdentityResolver>('staffIdentityResolver')

    expect(container.hasRegistration('staffIdentityResolver')).toBe(true)
    expect(typeof first.resolveByUserId).toBe('function')
    expect(typeof first.resolveByStaffMemberId).toBe('function')
    expect(firstAgain).toBe(first)
    expect(second).not.toBe(first)

    const lookupScope = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
    }
    const userId = '33333333-3333-4333-8333-333333333333'
    await first.resolveByUserId(lookupScope, userId)
    await second.resolveByUserId(lookupScope, userId)

    expect(findWithDecryption).toHaveBeenNthCalledWith(
      1,
      firstEm,
      expect.any(Function),
      expect.any(Object),
      { limit: 2 },
      lookupScope,
    )
    expect(findWithDecryption).toHaveBeenNthCalledWith(
      2,
      secondEm,
      expect.any(Function),
      expect.any(Object),
      { limit: 2 },
      lookupScope,
    )
  })

  it('returns undefined when staffIdentityResolver is not registered', () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })

    expect(container.resolve('staffIdentityResolver', { allowUnregistered: true })).toBeUndefined()
  })

  it('registers a CLASSIC-compatible projection resolver isolated to each request scope', async () => {
    jest.clearAllMocks()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    register(container)

    const firstScope = container.createScope()
    const secondScope = container.createScope()
    const firstEm = { scope: 'first-projection' } as unknown as EntityManager
    const secondEm = { scope: 'second-projection' } as unknown as EntityManager
    firstScope.register({ em: asValue(firstEm) })
    secondScope.register({ em: asValue(secondEm) })
    const first = firstScope.resolve<StaffIdentityProjectionResolver>(
      'staffIdentityProjectionResolver',
    )
    const firstAgain = firstScope.resolve<StaffIdentityProjectionResolver>(
      'staffIdentityProjectionResolver',
    )
    const second = secondScope.resolve<StaffIdentityProjectionResolver>(
      'staffIdentityProjectionResolver',
    )

    expect(container.hasRegistration('staffIdentityProjectionResolver')).toBe(true)
    expect(typeof first.resolveByIds).toBe('function')
    expect(firstAgain).toBe(first)
    expect(second).not.toBe(first)

    const lookupScope = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
    }
    const staffMemberId = '33333333-3333-4333-8333-333333333333'
    await first.resolveByIds(lookupScope, [staffMemberId])
    await second.resolveByIds(lookupScope, [staffMemberId])

    expect(findWithDecryption).toHaveBeenNthCalledWith(
      1,
      firstEm,
      expect.any(Function),
      expect.objectContaining({ id: { $in: [staffMemberId] } }),
      undefined,
      lookupScope,
    )
    expect(findWithDecryption).toHaveBeenNthCalledWith(
      2,
      secondEm,
      expect.any(Function),
      expect.objectContaining({ id: { $in: [staffMemberId] } }),
      undefined,
      lookupScope,
    )
  })

  it('returns undefined when staffIdentityProjectionResolver is not registered', () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })

    expect(
      container.resolve('staffIdentityProjectionResolver', { allowUnregistered: true }),
    ).toBeUndefined()
  })

  it('registers a CLASSIC-compatible candidate resolver isolated to each request scope', async () => {
    jest.clearAllMocks()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    register(container)

    const firstScope = container.createScope()
    const secondScope = container.createScope()
    const firstCount = jest.fn().mockResolvedValue(1)
    const secondCount = jest.fn().mockResolvedValue(1)
    const firstEm = { count: firstCount } as unknown as EntityManager
    const secondEm = { count: secondCount } as unknown as EntityManager
    firstScope.register({ em: asValue(firstEm) })
    secondScope.register({ em: asValue(secondEm) })
    const first = firstScope.resolve<StaffCandidateResolver>('staffCandidateResolver')
    const firstAgain = firstScope.resolve<StaffCandidateResolver>('staffCandidateResolver')
    const second = secondScope.resolve<StaffCandidateResolver>('staffCandidateResolver')

    expect(container.hasRegistration('staffCandidateResolver')).toBe(true)
    expect(typeof first.listCandidates).toBe('function')
    expect(firstAgain).toBe(first)
    expect(second).not.toBe(first)

    const input = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      linkage: 'any' as const,
      page: 1,
      pageSize: 25,
    }
    await first.listCandidates(input)
    await second.listCandidates(input)

    expect(firstCount).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }))
    expect(secondCount).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }))
    expect(findWithDecryption).toHaveBeenNthCalledWith(
      1,
      firstEm,
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({ limit: 25, offset: 0 }),
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    expect(findWithDecryption).toHaveBeenNthCalledWith(
      2,
      secondEm,
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({ limit: 25, offset: 0 }),
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
  })

  it('returns undefined when staffCandidateResolver is not registered', () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })

    expect(container.resolve('staffCandidateResolver', { allowUnregistered: true })).toBeUndefined()
  })
})
