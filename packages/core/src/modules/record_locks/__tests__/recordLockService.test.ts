import { RecordLockService } from '../lib/recordLockService'
import type { RecordLockSettings } from '../lib/config'

const DEFAULT_SETTINGS: RecordLockSettings = {
  enabled: true,
  strategy: 'optimistic',
  timeoutSeconds: 300,
  heartbeatSeconds: 30,
  enabledResources: ['sales.quote'],
  allowForceUnlock: true,
  notifyOnConflict: true,
}

function createService(
  settings: RecordLockSettings = DEFAULT_SETTINGS,
  actionLogService?: { findById: (id: string) => Promise<unknown> } | null,
) {
  const em = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(),
  } as any

  const moduleConfigService = {
    getValue: jest.fn().mockResolvedValue(settings),
    setValue: jest.fn(),
  } as any

  return {
    service: new RecordLockService({
      em,
      moduleConfigService,
      actionLogService: (actionLogService as any) ?? null,
    }),
    em,
    moduleConfigService,
    actionLogService,
  }
}

function buildLock(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date('2026-02-17T10:00:00.000Z')
  return {
    id: '10000000-0000-4000-8000-000000000001',
    resourceKind: 'sales.quote',
    resourceId: '20000000-0000-4000-8000-000000000001',
    token: '30000000-0000-4000-8000-000000000001',
    strategy: 'optimistic',
    status: 'active',
    lockedByUserId: '40000000-0000-4000-8000-000000000001',
    baseActionLogId: '50000000-0000-4000-8000-000000000001',
    lockedAt: now,
    lastHeartbeatAt: now,
    expiresAt: new Date(now.getTime() + 300000),
    tenantId: '60000000-0000-4000-8000-000000000001',
    organizationId: '70000000-0000-4000-8000-000000000001',
    ...overrides,
  }
}

describe('RecordLockService.validateMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns resourceEnabled=false when locking is disabled for resource', async () => {
    const { service } = createService({
      ...DEFAULT_SETTINGS,
      enabled: false,
      enabledResources: [],
    })

    const result = await service.validateMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
      headers: {},
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected successful validation')
    expect(result.resourceEnabled).toBe(false)
    expect(result.lock).toBeNull()
  })

  test('returns 409 conflict when optimistic base log is stale', async () => {
    const actionLogService = {
      findById: jest.fn(async (id: string) => {
        if (id === '50000000-0000-4000-8000-000000000001') {
          return {
            id,
            tenantId: '60000000-0000-4000-8000-000000000001',
            organizationId: '70000000-0000-4000-8000-000000000001',
            resourceKind: 'sales.quote',
            resourceId: '20000000-0000-4000-8000-000000000001',
            snapshotAfter: { entity: { displayName: 'Acme Before' } },
            snapshotBefore: null,
            changesJson: null,
            deletedAt: null,
          }
        }

        if (id === '80000000-0000-4000-8000-000000000001') {
          return {
            id,
            tenantId: '60000000-0000-4000-8000-000000000001',
            organizationId: '70000000-0000-4000-8000-000000000001',
            resourceKind: 'sales.quote',
            resourceId: '20000000-0000-4000-8000-000000000001',
            snapshotAfter: { entity: { displayName: 'Acme Incoming' } },
            snapshotBefore: { entity: { displayName: 'Acme Before' } },
            changesJson: {
              'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
            },
            deletedAt: null,
          }
        }

        return null
      }),
    }

    const { service } = createService(DEFAULT_SETTINGS, actionLogService)
    const serviceAny = service as any

    serviceAny.findActiveLock = jest.fn().mockResolvedValue(
      buildLock({ lockedByUserId: '40000000-0000-4000-8000-000000000001' }),
    )
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000001',
      actorUserId: '90000000-0000-4000-8000-000000000001',
    })
    serviceAny.createConflict = jest.fn().mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      baseActionLogId: '50000000-0000-4000-8000-000000000001',
      incomingActionLogId: '80000000-0000-4000-8000-000000000001',
      conflictActorUserId: '40000000-0000-4000-8000-000000000001',
      incomingActorUserId: '90000000-0000-4000-8000-000000000001',
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
    })

    const result = await service.validateMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
      headers: {
        token: '30000000-0000-4000-8000-000000000001',
        baseLogId: '50000000-0000-4000-8000-000000000001',
        resolution: 'normal',
      },
      mutationPayload: {
        id: '20000000-0000-4000-8000-000000000001',
        displayName: 'Acme Mine',
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected conflict result')
    expect(result.status).toBe(409)
    expect(result.code).toBe('record_lock_conflict')
    expect(result.conflict?.resolutionOptions).toEqual(['accept_incoming', 'accept_mine'])
    expect(result.conflict?.changes).toEqual([
      {
        field: 'entity.displayName',
        displayValue: 'Acme Before',
        baseValue: 'Acme Before',
        incomingValue: 'Acme Incoming',
        mineValue: 'Acme Mine',
      },
    ])
    expect(serviceAny.createConflict).toHaveBeenCalledTimes(1)
  })

  test('resolves existing conflict when resolution header is accept_mine', async () => {
    const { service } = createService()
    const serviceAny = service as any

    serviceAny.findActiveLock = jest.fn().mockResolvedValue(null)
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000001',
      actorUserId: '90000000-0000-4000-8000-000000000001',
    })
    serviceAny.findConflictById = jest.fn().mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      status: 'pending',
      resolution: null,
      baseActionLogId: '50000000-0000-4000-8000-000000000001',
      incomingActionLogId: '80000000-0000-4000-8000-000000000001',
      conflictActorUserId: '40000000-0000-4000-8000-000000000001',
      incomingActorUserId: '90000000-0000-4000-8000-000000000001',
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
    })
    serviceAny.resolveConflict = jest.fn().mockResolvedValue(undefined)

    const result = await service.validateMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
      headers: {
        conflictId: 'a0000000-0000-4000-8000-000000000001',
        resolution: 'accept_mine',
      },
    })

    expect(result.ok).toBe(true)
    expect(serviceAny.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a0000000-0000-4000-8000-000000000001' }),
      'accept_mine',
      '40000000-0000-4000-8000-000000000001',
    )
  })
})

describe('RecordLockService.acquire', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns competing lock when create races on active-scope unique index', async () => {
    const { service, em } = createService({
      ...DEFAULT_SETTINGS,
      strategy: 'pessimistic',
    })
    const serviceAny = service as any

    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue(null)
    serviceAny.findActiveLock = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(buildLock({
        strategy: 'pessimistic',
        lockedByUserId: '40000000-0000-4000-8000-000000000099',
        token: '30000000-0000-4000-8000-000000000099',
      }))

    em.create.mockReturnValue(buildLock({
      strategy: 'pessimistic',
      lockedByUserId: '40000000-0000-4000-8000-000000000001',
    }))
    em.flush.mockRejectedValueOnce(Object.assign(
      new Error('duplicate key value violates unique constraint "record_locks_active_scope_org_unique"'),
      {
        code: '23505',
        constraint: 'record_locks_active_scope_org_unique',
      },
    ))

    const result = await service.acquire({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected lock collision result')
    expect(result.status).toBe(423)
    expect(result.code).toBe('record_locked')
    expect(result.lock?.lockedByUserId).toBe('40000000-0000-4000-8000-000000000099')
    expect(serviceAny.findActiveLock).toHaveBeenCalledTimes(2)
  })
})
