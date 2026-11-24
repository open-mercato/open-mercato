import { createRecordLockCrudMutationGuardService } from '../lib/crudMutationGuardService'
import type { OssCrudMutationGuardServiceLike } from '../lib/crudMutationGuardService'
import type { RecordLockService } from '../lib/recordLockService'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../lib/config'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const ENABLED_SETTINGS = { ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['*'] }

function floorPass(): OssCrudMutationGuardServiceLike {
  return {
    validateMutation: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: false }),
    afterMutationSuccess: jest.fn().mockResolvedValue(undefined),
  }
}

const FLOOR_CURRENT_VERSION = '2026-11-23T10:00:00.480Z'

function floor409(): OssCrudMutationGuardServiceLike {
  return {
    validateMutation: jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      body: { code: 'optimistic_lock_conflict', currentUpdatedAt: FLOOR_CURRENT_VERSION },
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

describe('record-lock CRUD guard decorator — Keep my changes vs the floor', () => {
  const conflictId = 'a0000000-0000-4000-8000-000000000001'
  const keepMineInput = {
    ...baseInput,
    requestHeaders: new Headers({
      'x-om-record-lock-kind': 'catalog.product',
      'x-om-record-lock-resolution': 'accept_mine',
      'x-om-record-lock-conflict-id': conflictId,
    }),
  }
  const enrichmentPass = {
    ok: true,
    enabled: true,
    resourceEnabled: true,
    strategy: 'optimistic',
    shouldReleaseOnSuccess: false,
    lock: null,
    latestActionLogId: 'log-incoming',
  }

  function keepMineService(options: { verified?: boolean | Error; enrichment?: unknown } = {}) {
    const canKeepMineOverrideStaleVersion = options.verified instanceof Error
      ? jest.fn().mockRejectedValue(options.verified)
      : jest.fn().mockResolvedValue(options.verified ?? true)
    const validateMutation = options.enrichment instanceof Error
      ? jest.fn().mockRejectedValue(options.enrichment)
      : jest.fn().mockResolvedValue(options.enrichment ?? enrichmentPass)
    const recordLockService = {
      getSettings: jest.fn().mockResolvedValue(ENABLED_SETTINGS),
      validateMutation,
      canKeepMineOverrideStaleVersion,
    } as unknown as RecordLockService
    return { recordLockService, validateMutation, canKeepMineOverrideStaleVersion }
  }

  test('a verified keep-mine retry passes the floor and the enrichment resolves the conflict', async () => {
    const { recordLockService, validateMutation, canKeepMineOverrideStaleVersion } = keepMineService()
    const result = await createRecordLockCrudMutationGuardService(recordLockService, floor409()).validateMutation(keepMineInput)

    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: true, metadata: null })
    expect(canKeepMineOverrideStaleVersion).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      resourceKind: 'catalog.product',
      resourceId: 'product-1',
      headers: expect.objectContaining({ resolution: 'accept_mine', conflictId }),
    }), FLOOR_CURRENT_VERSION)
    expect(validateMutation).toHaveBeenCalledTimes(1)
  })

  test('an unverified keep-mine retry keeps the floor 409 and skips the enrichment', async () => {
    const { recordLockService, validateMutation } = keepMineService({ verified: false })
    const result = await createRecordLockCrudMutationGuardService(recordLockService, floor409()).validateMutation(keepMineInput)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected floor 409')
    expect(result.body.code).toBe('optimistic_lock_conflict')
    expect(validateMutation).not.toHaveBeenCalled()
  })

  test('a failing keep-mine check keeps the floor 409 (fail-closed) and reports the error', async () => {
    mockReportError.mockClear()
    const failure = new Error('record_locks down')
    const { recordLockService, validateMutation } = keepMineService({ verified: failure })
    const result = await createRecordLockCrudMutationGuardService(recordLockService, floor409()).validateMutation(keepMineInput)

    expect(result.ok).toBe(false)
    expect(validateMutation).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'record_locks',
      code: 'record_locks.keep_mine_floor_check_failed',
      attributes: { resourceKind: 'catalog.product' },
    })
  })

  test('a floor failure other than a version conflict is never overridden', async () => {
    const { recordLockService, canKeepMineOverrideStaleVersion } = keepMineService()
    const floor: OssCrudMutationGuardServiceLike = {
      validateMutation: jest.fn().mockResolvedValue({ ok: false, status: 400, body: { code: 'invalid_version_token' } }),
      afterMutationSuccess: jest.fn().mockResolvedValue(undefined),
    }
    const result = await createRecordLockCrudMutationGuardService(recordLockService, floor).validateMutation(keepMineInput)

    expect(result.ok).toBe(false)
    expect(canKeepMineOverrideStaleVersion).not.toHaveBeenCalled()
  })

  test('an enrichment that throws after a keep-mine override degrades to the floor 409, not to allow', async () => {
    const { recordLockService } = keepMineService({ enrichment: new Error('record_locks down') })
    const result = await createRecordLockCrudMutationGuardService(recordLockService, floor409()).validateMutation(keepMineInput)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected floor 409')
    expect(result.body.code).toBe('optimistic_lock_conflict')
  })

  test('an enrichment conflict after a keep-mine override still wins', async () => {
    const { recordLockService } = keepMineService({
      enrichment: { ok: false, status: 409, error: 'Record conflict requires resolution before saving', code: 'record_lock_conflict', lock: null, conflict: { id: 'conflict-1' } },
    })
    const result = await createRecordLockCrudMutationGuardService(recordLockService, floor409()).validateMutation(keepMineInput)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected record_lock_conflict')
    expect(result.body.code).toBe('record_lock_conflict')
  })
})
