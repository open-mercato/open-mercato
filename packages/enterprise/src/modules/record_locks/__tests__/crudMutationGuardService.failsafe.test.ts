import { createRecordLockCrudMutationGuardService } from '../lib/crudMutationGuardService'
import type { OssCrudMutationGuardServiceLike } from '../lib/crudMutationGuardService'
import type { RecordLockService } from '../lib/recordLockService'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../lib/config'

const ENABLED_SETTINGS = { ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['*'] }

function floorPass(): OssCrudMutationGuardServiceLike {
  return {
    validateMutation: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: false }),
    afterMutationSuccess: jest.fn().mockResolvedValue(undefined),
  }
}

function floor409(): OssCrudMutationGuardServiceLike {
  return {
    validateMutation: jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      body: { code: 'optimistic_lock_conflict' },
    }),
    afterMutationSuccess: jest.fn().mockResolvedValue(undefined),
  }
}

const baseInput = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-2',
  resourceKind: 'catalog.product',
  resourceId: 'product-1',
  operation: 'update' as const,
  requestMethod: 'PUT',
  requestHeaders: new Headers(),
  mutationPayload: { id: 'product-1', title: 'Updated' },
}

describe('record-lock CRUD guard decorator — fail-safe (H1–H3)', () => {
  test('H1/H2: floor 409s a stale write even with NO record-lock token (validateMutation never reached)', async () => {
    const validateMutation = jest.fn()
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation,
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService, floor409())
    const result = await service.validateMutation(baseInput)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected floor 409')
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('optimistic_lock_conflict')
    // Enrichment must not even run once the floor blocked the write.
    expect(validateMutation).not.toHaveBeenCalled()
  })

  test('H3: enrichment throwing degrades to the (passed) floor result, never a pass-through skip', async () => {
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation: jest.fn().mockRejectedValue(new Error('record_locks down')),
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService, floorPass())
    const result = await service.validateMutation(baseInput)

    // Floor passed → allow; the broken enterprise guard did not open a hole and
    // did not turn a floor-pass into a 500.
    expect(result.ok).toBe(true)
  })

  test('OM_OPTIMISTIC_LOCK=off short-circuits: neither floor nor enrichment runs', async () => {
    const floor = floorPass()
    const validateMutation = jest.fn()
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation,
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService, floor, { envValue: 'off' })
    const result = await service.validateMutation(baseInput)

    expect(result.ok).toBe(true)
    expect(floor.validateMutation).not.toHaveBeenCalled()
    expect(validateMutation).not.toHaveBeenCalled()
  })

  test('enrichment runs only when env-on AND settings-enabled; settings-off keeps floor only', async () => {
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
      getSettings: jest.fn().mockResolvedValue({ ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['sales.order'] }),
      validateMutation,
    } as unknown as RecordLockService

    const floor = floorPass()
    const service = createRecordLockCrudMutationGuardService(recordLockService, floor)
    const result = await service.validateMutation(baseInput)

    expect(result.ok).toBe(true)
    expect(floor.validateMutation).toHaveBeenCalledTimes(1) // floor still ran
    expect(validateMutation).not.toHaveBeenCalled() // enrichment skipped (resource not enabled)
  })

  test('enrichment conflict propagates as record_lock_conflict 409 when enabled', async () => {
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation: jest.fn().mockResolvedValue({
        ok: false,
        status: 409,
        error: 'Record conflict detected',
        code: 'record_lock_conflict',
        lock: null,
        conflict: { id: 'c1' },
      }),
    } as unknown as RecordLockService

    const service = createRecordLockCrudMutationGuardService(recordLockService, floorPass())
    const result = await service.validateMutation(baseInput)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected enrichment 409')
    expect(result.status).toBe(409)
    expect(result.body.code).toBe('record_lock_conflict')
  })
})
