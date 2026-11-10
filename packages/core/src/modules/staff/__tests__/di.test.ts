/** @jest-environment node */

import { createContainer, InjectionMode } from 'awilix'
import { register } from '../di'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { StaffLeaveRequest } from '../data/entities'

describe('staff/di — availabilityAccessResolver registration', () => {
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
})


describe('staff/di — native leave-decision version guard', () => {
  it.each(['accept', 'reject'])('refuses stale %s before any CRUD route has registered a reader', async (decision) => {
    const findOne = jest.fn().mockResolvedValue({ updatedAt: new Date('2026-11-10T10:00:00Z') })
    const em = { findOne } as unknown as EntityManager
    const service = createOptimisticLockGuardService({ getEm: () => em, envValue: 'all' })
    const input = {
      tenantId: 'tenant-1', organizationId: 'organization-1', userId: 'user-1',
      resourceKind: 'staff.leave_request', resourceId: 'request-1',
      operation: 'update' as const, requestMethod: 'POST',
      mutationPayload: { id: 'request-1', decision },
      requestHeaders: new Headers({ [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-11-10T09:00:00Z' }),
    }
    await expect(service.validateMutation(input)).resolves.toMatchObject({
      ok: false, status: 409,
      body: { code: 'optimistic_lock_conflict', expectedUpdatedAt: '2026-11-10T09:00:00.000Z', currentUpdatedAt: '2026-11-10T10:00:00.000Z' },
    })
    expect(findOne).toHaveBeenCalledWith(StaffLeaveRequest, {
      id: 'request-1', tenantId: 'tenant-1', organizationId: 'organization-1', deletedAt: null,
    }, { fields: ['updatedAt'] })
    await expect(service.validateMutation({ ...input, requestHeaders: new Headers({ [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-11-10T10:00:00Z' }) }))
      .resolves.toMatchObject({ ok: true })
  })
})
