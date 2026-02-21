import { createRecordLockCrudMutationGuardService } from '../lib/crudMutationGuardService'
import type { RecordLockService } from '../lib/recordLockService'

describe('createRecordLockCrudMutationGuardService', () => {
  test('runs after-success hook when locking is enabled even if owner lock should not be released', async () => {
    const recordLockService = {
      validateMutation: jest.fn().mockResolvedValue({
        ok: true,
        enabled: true,
        resourceEnabled: true,
        strategy: 'optimistic',
        shouldReleaseOnSuccess: false,
        lock: null,
        latestActionLogId: null,
      }),
      emitIncomingChangesNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      releaseAfterMutation: jest.fn().mockResolvedValue(undefined),
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService)
    const validation = await service.validateMutation({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-2',
      resourceKind: 'catalog.product',
      resourceId: 'product-1',
      method: 'PUT',
      requestHeaders: new Headers(),
      mutationPayload: { id: 'product-1', title: 'Updated title' },
    })

    expect(validation.ok).toBe(true)
    if (!validation.ok) throw new Error('Expected successful validation')
    expect(validation.shouldRunAfterSuccess).toBe(true)
  })

  test('skips after-success hook when locking is disabled for resource', async () => {
    const recordLockService = {
      validateMutation: jest.fn().mockResolvedValue({
        ok: true,
        enabled: true,
        resourceEnabled: false,
        strategy: 'optimistic',
        shouldReleaseOnSuccess: false,
        lock: null,
        latestActionLogId: null,
      }),
      emitIncomingChangesNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      releaseAfterMutation: jest.fn().mockResolvedValue(undefined),
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService)
    const validation = await service.validateMutation({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-2',
      resourceKind: 'catalog.product',
      resourceId: 'product-1',
      method: 'PUT',
      requestHeaders: new Headers(),
      mutationPayload: { id: 'product-1', title: 'Updated title' },
    })

    expect(validation.ok).toBe(true)
    if (!validation.ok) throw new Error('Expected successful validation')
    expect(validation.shouldRunAfterSuccess).toBe(false)
  })
})
