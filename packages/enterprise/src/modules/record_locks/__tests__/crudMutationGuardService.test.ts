import {
  createRecordLockCrudMutationGuardService,
  scopeRecordLockHeadersToResource,
} from '../lib/crudMutationGuardService'
import type { OssCrudMutationGuardServiceLike } from '../lib/crudMutationGuardService'
import type { RecordLockService } from '../lib/recordLockService'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../lib/config'

function makeFloorPass(): OssCrudMutationGuardServiceLike {
  return {
    validateMutation: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: false }),
    afterMutationSuccess: jest.fn().mockResolvedValue(undefined),
  }
}

const ENABLED_SETTINGS = { ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['*'] }

describe('createRecordLockCrudMutationGuardService', () => {
  test('runs after-success hook when locking is enabled even if owner lock should not be released', async () => {
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
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

    const service = createRecordLockCrudMutationGuardService(recordLockService, makeFloorPass())
    const validation = await service.validateMutation({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-2',
      resourceKind: 'catalog.product',
      resourceId: 'product-1',
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: new Headers(),
      mutationPayload: { id: 'product-1', title: 'Updated title' },
    })

    expect(validation.ok).toBe(true)
    if (!validation.ok) throw new Error('Expected successful validation')
    expect(validation.shouldRunAfterSuccess).toBe(true)
  })

  test('skips enrichment when locking is disabled for resource (settings off)', async () => {
    const validateMutation = jest.fn()
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue({ ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['sales.order'] }),
      validateMutation,
      emitIncomingChangesNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      releaseAfterMutation: jest.fn().mockResolvedValue(undefined),
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService, makeFloorPass())
    const validation = await service.validateMutation({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-2',
      resourceKind: 'catalog.product',
      resourceId: 'product-1',
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: new Headers(),
      mutationPayload: { id: 'product-1', title: 'Updated title' },
    })

    expect(validation.ok).toBe(true)
    if (!validation.ok) throw new Error('Expected successful validation')
    expect(validation.shouldRunAfterSuccess).toBe(false)
    expect(validateMutation).not.toHaveBeenCalled()
  })

  test('emits record-deleted notification hook after delete mutation success', async () => {
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation: jest.fn().mockResolvedValue({
        ok: true,
        enabled: true,
        resourceEnabled: true,
        strategy: 'optimistic',
        shouldReleaseOnSuccess: true,
        lock: null,
        latestActionLogId: null,
      }),
      emitIncomingChangesNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      emitRecordDeletedNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      releaseAfterMutation: jest.fn().mockResolvedValue(undefined),
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService, makeFloorPass())
    await service.afterMutationSuccess({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-2',
      resourceKind: 'catalog.product',
      resourceId: 'product-1',
      operation: 'delete',
      requestMethod: 'DELETE',
      requestHeaders: new Headers(),
    })

    expect(recordLockService.emitIncomingChangesNotificationAfterMutation).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(recordLockService.emitRecordDeletedNotificationAfterMutation).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
  test('ignores parent record-lock headers leaked onto a child-entity write (#5985)', async () => {
    const validateMutation = jest.fn().mockResolvedValue({
      ok: true,
      enabled: true,
      resourceEnabled: true,
      strategy: 'optimistic',
      shouldReleaseOnSuccess: false,
      lock: null,
      latestActionLogId: null,
    })
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation,
      emitIncomingChangesNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      releaseAfterMutation: jest.fn().mockResolvedValue(undefined),
    } as unknown as RecordLockService

    // The variant CrudForm keeps its own record-lock headers on the scoped header
    // stack while `onSubmit` writes the variant's `catalog.price` rows.
    const service = createRecordLockCrudMutationGuardService(recordLockService, makeFloorPass())
    await service.validateMutation({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-2',
      resourceKind: 'catalog.price',
      resourceId: 'price-1',
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: new Headers({
        'x-om-record-lock-kind': 'catalog.variant',
        'x-om-record-lock-resource-id': 'variant-1',
        'x-om-record-lock-base-log-id': '9b7f3b3e-0000-4000-8000-000000000001',
      }),
      mutationPayload: { id: 'price-1', unitPriceGross: 980 },
    })

    expect(validateMutation).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }))
  })

  test('keeps record-lock headers that describe the record being written', async () => {
    const validateMutation = jest.fn().mockResolvedValue({
      ok: true,
      enabled: true,
      resourceEnabled: true,
      strategy: 'optimistic',
      shouldReleaseOnSuccess: false,
      lock: null,
      latestActionLogId: null,
    })
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation,
      emitIncomingChangesNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      releaseAfterMutation: jest.fn().mockResolvedValue(undefined),
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService, makeFloorPass())
    await service.validateMutation({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-2',
      resourceKind: 'catalog.variant',
      resourceId: 'variant-1',
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: new Headers({
        'x-om-record-lock-kind': 'catalog.variant',
        'x-om-record-lock-resource-id': 'variant-1',
        'x-om-record-lock-base-log-id': '9b7f3b3e-0000-4000-8000-000000000001',
      }),
      mutationPayload: { id: 'variant-1', name: 'Renamed' },
    })

    expect(validateMutation).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ baseLogId: '9b7f3b3e-0000-4000-8000-000000000001' }),
    }))
  })

  test('drops a leaked lock token before releasing a child-entity lock', async () => {
    const releaseAfterMutation = jest.fn().mockResolvedValue(undefined)
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation: jest.fn(),
      emitIncomingChangesNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      emitRecordDeletedNotificationAfterMutation: jest.fn().mockResolvedValue(undefined),
      releaseAfterMutation,
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService, makeFloorPass())
    await service.afterMutationSuccess({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-2',
      resourceKind: 'catalog.price',
      resourceId: 'price-1',
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: new Headers({
        'x-om-record-lock-kind': 'catalog.variant',
        'x-om-record-lock-resource-id': 'variant-1',
        'x-om-record-lock-token': 'variant-lock-token',
      }),
    })

    expect(releaseAfterMutation).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'catalog.price',
      token: undefined,
    }))
  })
})

describe('scopeRecordLockHeadersToResource', () => {
  test('keeps headers that declare no scope', () => {
    expect(scopeRecordLockHeadersToResource(
      { baseLogId: 'log-1' },
      { resourceKind: 'catalog.price', resourceId: 'price-1' },
    )).toEqual({ baseLogId: 'log-1' })
  })

  test('treats a page-declared kind and its canonical route form as the same record', () => {
    expect(scopeRecordLockHeadersToResource(
      { resourceKind: 'resources.resourceType', resourceId: 'type-1', baseLogId: 'log-1' },
      { resourceKind: 'resources.resource.type', resourceId: 'type-1' },
    )).toEqual({ resourceKind: 'resources.resourceType', resourceId: 'type-1', baseLogId: 'log-1' })
  })

  test('drops headers pointing at another record of the same kind', () => {
    expect(scopeRecordLockHeadersToResource(
      { resourceKind: 'catalog.variant', resourceId: 'variant-1', baseLogId: 'log-1' },
      { resourceKind: 'catalog.variant', resourceId: 'variant-2' },
    )).toEqual({})
  })
})
