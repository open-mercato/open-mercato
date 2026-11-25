import { EntityMetadata, MetadataStorage } from '@mikro-orm/core'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { RecordLockService } from '../lib/recordLockService'
import type { RecordLockSettings } from '../lib/config'
import { emitRecordLocksEvent } from '../events'

jest.mock('../events', () => ({
  emitRecordLocksEvent: jest.fn().mockResolvedValue(undefined),
}))

const DEFAULT_SETTINGS: RecordLockSettings = {
  enabled: true,
  strategy: 'optimistic',
  timeoutSeconds: 300,
  heartbeatSeconds: 30,
  maxActiveLocksPerUser: 50,
  enabledResources: ['sales.quote'],
  allowForceUnlock: true,
  allowIncomingOverride: true,
  notifyOnConflict: true,
}

function createService(
  settings: RecordLockSettings = DEFAULT_SETTINGS,
  actionLogService?: { findById: (id: string) => Promise<unknown> } | null,
  options?: { canOverrideIncoming?: boolean; auditTrailAvailable?: boolean },
) {
  const execute = jest.fn().mockResolvedValue([])
  const connection = { execute }
  const em = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    persist: jest.fn(),
    flush: jest.fn(),
    transactional: jest.fn(),
    getConnection: jest.fn(() => connection),
    getMetadata: jest.fn(() => ({ find: () => options?.auditTrailAvailable ?? true })),
  } as any
  em.transactional.mockImplementation(async (cb: (tx: typeof em) => Promise<unknown>) => cb(em))

  const moduleConfigService = {
    getValue: jest.fn().mockResolvedValue(settings),
    setValue: jest.fn(),
  } as any

  const rbacService = {
    userHasAllFeatures: jest.fn().mockResolvedValue(options?.canOverrideIncoming ?? true),
  } as any

  return {
    service: new RecordLockService({
      em,
      moduleConfigService,
      actionLogService: (actionLogService as any) ?? null,
      rbacService,
    }),
    em,
    moduleConfigService,
    actionLogService,
    rbacService,
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
    expect(result.conflict?.resolutionOptions).toEqual(['accept_mine'])
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

  test.each([
    {
      changesJson: null,
      resourceKind: 'customers.company',
      baseSnapshot: { profile: null },
      incomingSnapshot: { profile: { legalName: 'Incoming Ltd' } },
      mutationPayload: { legalName: 'My Company Ltd' },
      changes: [{ field: 'profile.legalName', baseValue: null, incomingValue: 'Incoming Ltd', mineValue: 'My Company Ltd' }],
    },
    {
      changesJson: null,
      resourceKind: 'customers.person',
      baseSnapshot: null,
      incomingSnapshot: {
        profile: { firstName: 'Incoming', alias: 'Public' },
        contacts: { alias: 'Private' },
      },
      mutationPayload: { firstName: 'My Name', alias: 'Ambiguous' },
      changes: [{ field: 'profile.firstName', baseValue: null, incomingValue: 'Incoming', mineValue: 'My Name' }],
    },
    {
      changesJson: null,
      resourceKind: 'customers.deal',
      baseSnapshot: { deal: { expectedCloseAt: new Date('2026-11-05T00:00:00Z') } },
      incomingSnapshot: { deal: { expectedCloseAt: new Date('2026-11-09T00:00:00Z') } },
      mutationPayload: { expectedCloseAt: '2026-11-12' },
      changes: [{
        field: 'deal.expectedCloseAt',
        baseValue: new Date('2026-11-05T00:00:00Z'),
        incomingValue: new Date('2026-11-09T00:00:00Z'),
        mineValue: '2026-11-12',
      }],
    },
    {
      changesJson: null,
      resourceKind: 'customers.company',
      baseSnapshot: null,
      incomingSnapshot: { profile: { legalName: 'Incoming Ltd' } },
      mutationPayload: { profile: null },
      changes: [{ field: 'profile', baseValue: null, incomingValue: { legalName: 'Incoming Ltd' }, mineValue: null }],
    },
    {
      changesJson: null,
      resourceKind: 'customers.company',
      baseSnapshot: { profile: { legalName: 'Original Ltd' } },
      incomingSnapshot: { profile: null },
      mutationPayload: { profile: null },
      changes: [{ field: 'profile.legalName', baseValue: 'Original Ltd', incomingValue: null, mineValue: null }],
    },
    {
      changesJson: null,
      resourceKind: 'customers.person',
      baseSnapshot: { entity: { name: 'Original entity' }, profile: { name: 'Original profile' } },
      incomingSnapshot: { entity: { name: 'Incoming entity' }, profile: { name: 'Incoming profile' } },
      mutationPayload: { name: 'Ambiguous' },
      changes: [
        { field: 'entity.name', baseValue: 'Original entity', incomingValue: 'Incoming entity', mineValue: 'Original entity' },
        { field: 'profile.name', baseValue: 'Original profile', incomingValue: 'Incoming profile', mineValue: 'Original profile' },
      ],
    },
    {
      changesJson: { title: { from: 'Intermediate title', to: 'Incoming title' } },
      resourceKind: 'catalog.product',
      baseSnapshot: { title: 'Original title' },
      incomingSnapshot: { title: 'Incoming title', sku: 'New SKU' },
      mutationPayload: { title: 'My title' },
      changes: [{ field: 'title', baseValue: 'Original title', incomingValue: 'Incoming title', mineValue: 'My title' }],
    },
  ])('builds accurate field-level conflicts for scoped $resourceKind writes', async ({
    resourceKind, baseSnapshot, incomingSnapshot, mutationPayload, changesJson, changes,
  }) => {
    const lock = buildLock({ resourceKind })
    const scope = {
      tenantId: lock.tenantId,
      organizationId: lock.organizationId,
      userId: lock.lockedByUserId,
      resourceKind,
      resourceId: lock.resourceId,
    }
    const incomingId = '80000000-0000-4000-8000-000000000001'
    const actionLogService = {
      findById: jest.fn(async (id: string) => ({
        ...scope,
        id,
        deletedAt: null,
        changesJson: id === incomingId ? changesJson : null,
        snapshotBefore: id === incomingId ? baseSnapshot : null,
        snapshotAfter: id === incomingId ? incomingSnapshot : baseSnapshot,
      })),
    }
    const { service, em } = createService({ ...DEFAULT_SETTINGS, enabledResources: [resourceKind] }, actionLogService)
    em.find.mockResolvedValue([lock])
    em.findOne.mockImplementation(async (entity: unknown) => entity === ActionLog
      ? { id: incomingId, actorUserId: '90000000-0000-4000-8000-000000000001' }
      : null)
    em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({
      ...data, id: 'a0000000-0000-4000-8000-000000000001',
    }))

    const result = await service.validateMutation({
      ...scope,
      method: 'PUT',
      headers: { token: lock.token, baseLogId: lock.baseActionLogId },
      mutationPayload,
    })

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'record_lock_conflict',
      conflict: {
        changes: changes.map((change) => ({ ...change, displayValue: change.baseValue })),
      },
    })
  })

  test('returns 409 conflict when optimistic base log is stale from another session of same user', async () => {
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
      actorUserId: '40000000-0000-4000-8000-000000000001',
    })
    serviceAny.createConflict = jest.fn().mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000111',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      baseActionLogId: '50000000-0000-4000-8000-000000000001',
      incomingActionLogId: '80000000-0000-4000-8000-000000000001',
      conflictActorUserId: '40000000-0000-4000-8000-000000000001',
      incomingActorUserId: '40000000-0000-4000-8000-000000000001',
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
    expect(serviceAny.createConflict).toHaveBeenCalledTimes(1)
  })

  test('returns 409 conflict when base log is missing but newer incoming log exists after lock start', async () => {
    const { service } = createService()
    const serviceAny = service as any

    serviceAny.findActiveLock = jest.fn().mockResolvedValue(
      buildLock({
        baseActionLogId: null,
        lockedAt: new Date('2026-02-17T10:00:00.000Z'),
        lockedByUserId: '40000000-0000-4000-8000-000000000001',
      }),
    )
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '81000000-0000-4000-8000-000000000001',
      actorUserId: '90000000-0000-4000-8000-000000000001',
      createdAt: new Date('2026-02-17T10:05:00.000Z'),
    })
    serviceAny.createConflict = jest.fn().mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000010',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      baseActionLogId: null,
      incomingActionLogId: '81000000-0000-4000-8000-000000000001',
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
        resolution: 'normal',
      },
      mutationPayload: {
        id: '20000000-0000-4000-8000-000000000001',
        dimensions: { width: 10, height: 20 },
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected conflict result')
    expect(result.status).toBe(409)
    expect(result.code).toBe('record_lock_conflict')
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

  test('auto-resolves detected conflict when keep-mine intent is provided without conflict id', async () => {
    const { service } = createService()
    const serviceAny = service as any

    serviceAny.findActiveLock = jest.fn().mockResolvedValue(
      buildLock({ lockedByUserId: '40000000-0000-4000-8000-000000000001' }),
    )
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '81000000-0000-4000-8000-000000000001',
      actorUserId: '90000000-0000-4000-8000-000000000001',
      createdAt: new Date('2026-02-17T10:05:00.000Z'),
    })
    serviceAny.findConflictById = jest.fn().mockResolvedValue(null)
    serviceAny.createConflict = jest.fn().mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000011',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      status: 'pending',
      resolution: null,
      baseActionLogId: '50000000-0000-4000-8000-000000000001',
      incomingActionLogId: '81000000-0000-4000-8000-000000000001',
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
        token: '30000000-0000-4000-8000-000000000001',
        baseLogId: '50000000-0000-4000-8000-000000000001',
        resolution: 'accept_mine',
      },
      mutationPayload: {
        id: '20000000-0000-4000-8000-000000000001',
        displayName: 'Acme Mine',
      },
    })

    expect(result.ok).toBe(true)
    expect(serviceAny.createConflict).toHaveBeenCalledTimes(1)
    expect(serviceAny.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a0000000-0000-4000-8000-000000000011' }),
      'accept_mine',
      '40000000-0000-4000-8000-000000000001',
    )
  })

  test('returns 409 when conflict resolution is attempted by a different user', async () => {
    const { service } = createService()
    const serviceAny = service as any

    serviceAny.findActiveLock = jest.fn().mockResolvedValue(null)
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000001',
      actorUserId: '90000000-0000-4000-8000-000000000001',
    })
    serviceAny.findConflictById = jest.fn().mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000002',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      status: 'pending',
      resolution: null,
      baseActionLogId: '50000000-0000-4000-8000-000000000001',
      incomingActionLogId: '80000000-0000-4000-8000-000000000001',
      conflictActorUserId: '40000000-0000-4000-8000-000000000099',
      incomingActorUserId: '90000000-0000-4000-8000-000000000001',
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
    })
    serviceAny.toConflictPayload = jest.fn().mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000002',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      baseActionLogId: '50000000-0000-4000-8000-000000000001',
      incomingActionLogId: '80000000-0000-4000-8000-000000000001',
      resolutionOptions: ['accept_mine'],
      changes: [],
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
        conflictId: 'a0000000-0000-4000-8000-000000000002',
        resolution: 'accept_mine',
      },
      mutationPayload: {
        id: '20000000-0000-4000-8000-000000000001',
        displayName: 'Acme Mine',
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected conflict failure')
    expect(result.status).toBe(409)
    expect(result.code).toBe('record_lock_conflict')
    expect(serviceAny.resolveConflict).not.toHaveBeenCalled()
    expect(serviceAny.toConflictPayload).toHaveBeenCalledTimes(1)
  })
})

describe('RecordLockService.acquire', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('allows optimistic participant join when another user is already active', async () => {
    const { service, em } = createService({
      ...DEFAULT_SETTINGS,
      strategy: 'optimistic',
    })
    const serviceAny = service as any

    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue(null)
    const competingLock = buildLock({
      strategy: 'optimistic',
      id: '10000000-0000-4000-8000-000000000099',
      lockedByUserId: '40000000-0000-4000-8000-000000000099',
    })
    const joinedLock = buildLock({
      strategy: 'optimistic',
      id: '10000000-0000-4000-8000-000000000088',
      lockedByUserId: '40000000-0000-4000-8000-000000000001',
      token: '30000000-0000-4000-8000-000000000088',
    })
    em.find
      .mockResolvedValueOnce([competingLock])
      .mockResolvedValueOnce([competingLock])
      .mockResolvedValueOnce([competingLock, joinedLock])
    em.create.mockReturnValue(joinedLock)
    em.flush.mockResolvedValue(undefined)

    const result = await service.acquire({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected successful result')
    expect(result.acquired).toBe(true)
    expect(result.lock).toBeTruthy()
    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.participant.joined',
      expect.objectContaining({
        joinedUserId: '40000000-0000-4000-8000-000000000001',
      }),
    )
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
    expect(serviceAny.findActiveLock).toHaveBeenCalledTimes(3)
    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.lock.contended',
      expect.objectContaining({
        lockedByUserId: '40000000-0000-4000-8000-000000000099',
        attemptedByUserId: '40000000-0000-4000-8000-000000000001',
      }),
    )
  })

  test('rejects new lock acquisition when the user active-lock quota is reached', async () => {
    const cappedSettings = {
      ...DEFAULT_SETTINGS,
      strategy: 'pessimistic',
      maxActiveLocksPerUser: 2,
    } as RecordLockSettings & { maxActiveLocksPerUser: number }
    const { service, em } = createService(cappedSettings)
    const serviceAny = service as any

    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue(null)
    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    em.count.mockResolvedValueOnce(2)
    em.create.mockReturnValue(buildLock({
      strategy: 'pessimistic',
      lockedByUserId: '40000000-0000-4000-8000-000000000001',
    }))
    em.flush.mockResolvedValue(undefined)

    const result = await service.acquire({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000099',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected quota failure')
    expect(result.status).toBe(429)
    expect(result.code).toBe('record_lock_quota_exceeded')
    expect(result.error).toBe('Active record lock limit reached')
    expect(result.lock).toBeNull()
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.getConnection().execute).toHaveBeenCalledWith(
      'select pg_advisory_xact_lock(hashtext(?))',
      ['record_locks:quota:60000000-0000-4000-8000-000000000001:70000000-0000-4000-8000-000000000001:40000000-0000-4000-8000-000000000001'],
    )
    expect(em.count).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        tenantId: '60000000-0000-4000-8000-000000000001',
        organizationId: '70000000-0000-4000-8000-000000000001',
        lockedByUserId: '40000000-0000-4000-8000-000000000001',
        status: 'active',
        deletedAt: null,
        expiresAt: { $gt: expect.any(Date) },
      }),
    )
    expect(em.persist).not.toHaveBeenCalled()
  })
})

describe('RecordLockService.release', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('resolves pending conflict as accept_incoming and returns conflictResolved=true', async () => {
    const { service } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any

    const lock = buildLock({
      lockedByUserId: '40000000-0000-4000-8000-000000000001',
      token: '30000000-0000-4000-8000-000000000001',
      status: 'active',
    })

    const conflict = {
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
    }

    serviceAny.findOwnedLockByToken = jest.fn().mockResolvedValue(lock)
    serviceAny.findConflictById = jest.fn().mockResolvedValue(conflict)
    serviceAny.resolveConflict = jest.fn().mockResolvedValue(undefined)

    const result = await service.release({
      token: '30000000-0000-4000-8000-000000000001',
      reason: 'conflict_resolved',
      conflictId: 'a0000000-0000-4000-8000-000000000001',
      resolution: 'accept_incoming',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
    })

    expect(result).toEqual({
      ok: true,
      released: true,
      conflictResolved: true,
    })
    expect(serviceAny.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a0000000-0000-4000-8000-000000000001' }),
      'accept_incoming',
      '40000000-0000-4000-8000-000000000001',
    )
  })

  test('resolves pending conflict as accept_incoming without lock token', async () => {
    const { service } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any

    const conflict = {
      id: 'a0000000-0000-4000-8000-000000000002',
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
    }

    serviceAny.findConflictById = jest.fn().mockResolvedValue(conflict)
    serviceAny.resolveConflict = jest.fn().mockResolvedValue(undefined)
    serviceAny.findOwnedLockByToken = jest.fn()

    const result = await service.release({
      reason: 'conflict_resolved',
      conflictId: 'a0000000-0000-4000-8000-000000000002',
      resolution: 'accept_incoming',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
    })

    expect(result).toEqual({
      ok: true,
      released: false,
      conflictResolved: true,
    })
    expect(serviceAny.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a0000000-0000-4000-8000-000000000002' }),
      'accept_incoming',
      '40000000-0000-4000-8000-000000000001',
    )
    expect(serviceAny.findOwnedLockByToken).not.toHaveBeenCalled()
  })
})

describe('RecordLockService.emitIncomingChangesNotificationAfterMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('emits incoming-changes event using actor fallback log when latest log belongs to another actor', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any
    em.find.mockResolvedValue([
      buildLock({
        lockedByUserId: '40000000-0000-4000-8000-000000000001',
        lockedAt: new Date('2026-02-17T10:00:00.000Z'),
        baseActionLogId: '50000000-0000-4000-8000-000000000001',
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ])
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000099',
      actorUserId: '90000000-0000-4000-8000-000000000099',
      changesJson: null,
      createdAt: new Date('2026-02-17T10:02:00.000Z'),
    })
    serviceAny.findLatestActionLogByActor = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000001',
      actorUserId: '90000000-0000-4000-8000-000000000001',
      changesJson: null,
      snapshotBefore: { entity: { displayName: 'Acme Before' } },
      snapshotAfter: { entity: { displayName: 'Acme Incoming' } },
      createdAt: new Date('2026-02-17T10:01:00.000Z'),
    })

    await service.emitIncomingChangesNotificationAfterMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '90000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
    })

    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.incoming_changes.available',
      expect.objectContaining({
        incomingActorUserId: '90000000-0000-4000-8000-000000000001',
        incomingActionLogId: '80000000-0000-4000-8000-000000000001',
        recipientUserIds: ['40000000-0000-4000-8000-000000000001'],
        changedFields: expect.stringContaining('Display Name'),
      }),
    )
  })

  test('emits incoming-changes event from decrypted stringified action log changes', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any
    em.find.mockResolvedValue([
      buildLock({
        lockedByUserId: '40000000-0000-4000-8000-000000000001',
        lockedAt: new Date('2026-02-17T10:00:00.000Z'),
        baseActionLogId: '50000000-0000-4000-8000-000000000001',
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ])
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000099',
      actorUserId: '90000000-0000-4000-8000-000000000099',
      changesJson: null,
      createdAt: new Date('2026-02-17T10:02:00.000Z'),
    })
    serviceAny.findLatestActionLogByActor = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000001',
      actorUserId: '90000000-0000-4000-8000-000000000001',
      changesJson: JSON.stringify({
        'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
      }),
      createdAt: new Date('2026-02-17T10:01:00.000Z'),
    })

    await service.emitIncomingChangesNotificationAfterMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '90000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
    })

    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.incoming_changes.available',
      expect.objectContaining({
        incomingActorUserId: '90000000-0000-4000-8000-000000000001',
        incomingActionLogId: '80000000-0000-4000-8000-000000000001',
        recipientUserIds: ['40000000-0000-4000-8000-000000000001'],
        changedFields: expect.stringContaining('Display Name'),
        changedRowsJson: expect.stringContaining('Acme Incoming'),
      }),
    )
  })

  test('emits incoming-changes event using latest log when actor lookup is unavailable', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any
    em.find.mockResolvedValue([
      buildLock({
        lockedByUserId: '40000000-0000-4000-8000-000000000001',
        lockedAt: new Date('2026-02-17T10:00:00.000Z'),
        baseActionLogId: '50000000-0000-4000-8000-000000000001',
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ])
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000777',
      actorUserId: '90000000-0000-4000-8000-000000000777',
      changesJson: {
        'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
      },
      createdAt: new Date('2026-02-17T10:03:00.000Z'),
    })
    serviceAny.findLatestActionLogByActor = jest.fn().mockResolvedValue(null)

    await service.emitIncomingChangesNotificationAfterMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '90000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
    })

    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.incoming_changes.available',
      expect.objectContaining({
        incomingActorUserId: '90000000-0000-4000-8000-000000000001',
        incomingActionLogId: '80000000-0000-4000-8000-000000000777',
        recipientUserIds: ['40000000-0000-4000-8000-000000000001'],
      }),
    )
  })

  test('emits incoming-changes event even when action log cannot be resolved', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any

    em.find.mockResolvedValue([
      buildLock({
        lockedByUserId: '40000000-0000-4000-8000-000000000001',
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ])
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue(null)
    serviceAny.findLatestActionLogByActor = jest.fn().mockResolvedValue(null)

    await service.emitIncomingChangesNotificationAfterMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '90000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
    })

    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.incoming_changes.available',
      expect.objectContaining({
        incomingActorUserId: '90000000-0000-4000-8000-000000000001',
        incomingActionLogId: null,
        recipientUserIds: ['40000000-0000-4000-8000-000000000001'],
        changedFields: '-',
      }),
    )
  })

  test('emits incoming-changes event when org-scoped lock is found only via null-scope fallback', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any

    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        buildLock({
          lockedByUserId: '40000000-0000-4000-8000-000000000001',
          organizationId: '70000000-0000-4000-8000-000000000099',
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ])

    serviceAny.findLatestActionLog = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: '80000000-0000-4000-8000-000000000555',
        actorUserId: '90000000-0000-4000-8000-000000000001',
        changesJson: {
          'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
        },
        createdAt: new Date('2026-02-17T10:04:00.000Z'),
      })
    serviceAny.findLatestActionLogByActor = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: '80000000-0000-4000-8000-000000000555',
        actorUserId: '90000000-0000-4000-8000-000000000001',
        changesJson: {
          'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
        },
        createdAt: new Date('2026-02-17T10:04:00.000Z'),
      })

    await service.emitIncomingChangesNotificationAfterMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: null,
      userId: '90000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
    })

    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.incoming_changes.available',
      expect.objectContaining({
        recipientUserIds: ['40000000-0000-4000-8000-000000000001'],
        incomingActionLogId: '80000000-0000-4000-8000-000000000555',
      }),
    )
  })

  test('emits incoming-changes event when scoped query misses lock but tenant-scope fallback finds it', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any

    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        buildLock({
          lockedByUserId: '40000000-0000-4000-8000-000000000001',
          organizationId: '70000000-0000-4000-8000-000000000001',
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ])

    serviceAny.findLatestActionLog = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: '80000000-0000-4000-8000-000000000556',
        actorUserId: '90000000-0000-4000-8000-000000000001',
        changesJson: {
          'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
        },
        createdAt: new Date('2026-02-17T10:04:00.000Z'),
      })
    serviceAny.findLatestActionLogByActor = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: '80000000-0000-4000-8000-000000000556',
        actorUserId: '90000000-0000-4000-8000-000000000001',
        changesJson: {
          'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
        },
        createdAt: new Date('2026-02-17T10:04:00.000Z'),
      })

    await service.emitIncomingChangesNotificationAfterMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000777',
      userId: '90000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
    })

    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.incoming_changes.available',
      expect.objectContaining({
        recipientUserIds: ['40000000-0000-4000-8000-000000000001'],
        incomingActionLogId: '80000000-0000-4000-8000-000000000556',
      }),
    )
  })

  test('emits incoming-changes event for recent lock owner when active lock list is empty', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any

    em.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        buildLock({
          status: 'released',
          lockedByUserId: '40000000-0000-4000-8000-000000000001',
          updatedAt: new Date('2026-02-17T10:04:30.000Z'),
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ])

    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000557',
      actorUserId: '90000000-0000-4000-8000-000000000001',
      changesJson: {
        'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
      },
      createdAt: new Date('2026-02-17T10:05:00.000Z'),
    })
    serviceAny.findLatestActionLogByActor = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000557',
      actorUserId: '90000000-0000-4000-8000-000000000001',
      changesJson: {
        'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
      },
      createdAt: new Date('2026-02-17T10:05:00.000Z'),
    })

    await service.emitIncomingChangesNotificationAfterMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '90000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
    })

    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.incoming_changes.available',
      expect.objectContaining({
        recipientUserIds: ['40000000-0000-4000-8000-000000000001'],
        incomingActionLogId: '80000000-0000-4000-8000-000000000557',
      }),
    )
  })

  test('emits incoming-changes event for previous owner when active lock belongs to mutation actor', async () => {
    const { service, em } = createService({
      ...DEFAULT_SETTINGS,
      strategy: 'pessimistic',
    })
    const serviceAny = service as any

    serviceAny.findActiveLocks = jest.fn().mockResolvedValue([
      buildLock({
        lockedByUserId: '90000000-0000-4000-8000-000000000001',
        status: 'active',
      }),
    ])
    em.find.mockResolvedValue([
      buildLock({
        status: 'force_released',
        lockedByUserId: '40000000-0000-4000-8000-000000000001',
        updatedAt: new Date('2026-02-17T10:04:30.000Z'),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ])
    serviceAny.findLatestActionLog = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000558',
      actorUserId: '90000000-0000-4000-8000-000000000001',
      changesJson: {
        'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
      },
      createdAt: new Date('2026-02-17T10:05:00.000Z'),
    })
    serviceAny.findLatestActionLogByActor = jest.fn().mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000558',
      actorUserId: '90000000-0000-4000-8000-000000000001',
      changesJson: {
        'entity.displayName': { from: 'Acme Before', to: 'Acme Incoming' },
      },
      createdAt: new Date('2026-02-17T10:05:00.000Z'),
    })

    await service.emitIncomingChangesNotificationAfterMutation({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '90000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      method: 'PUT',
    })

    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.incoming_changes.available',
      expect.objectContaining({
        recipientUserIds: ['40000000-0000-4000-8000-000000000001'],
        incomingActorUserId: '90000000-0000-4000-8000-000000000001',
        incomingActionLogId: '80000000-0000-4000-8000-000000000558',
      }),
    )
  })
})

describe('RecordLockService.heartbeat', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('refreshes heartbeat and expiration for active owned lock', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any
    const lock = buildLock({
      expiresAt: new Date(Date.now() + 60_000),
      lastHeartbeatAt: new Date(Date.now() - 60_000),
    })
    serviceAny.findOwnedLockByToken = jest.fn().mockResolvedValue(lock)

    const result = await service.heartbeat({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      token: '30000000-0000-4000-8000-000000000001',
    })

    expect(result.ok).toBe(true)
    expect(result.expiresAt).toEqual(expect.any(String))
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  test('expires and releases stale lock on heartbeat', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any
    const lock = buildLock({
      expiresAt: new Date(Date.now() - 60_000),
      releaseReason: null,
      releasedAt: null,
      releasedByUserId: null,
      status: 'active',
    })
    serviceAny.findOwnedLockByToken = jest.fn().mockResolvedValue(lock)

    const result = await service.heartbeat({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      token: '30000000-0000-4000-8000-000000000001',
    })

    expect(result.ok).toBe(true)
    expect(result.expiresAt).toBeNull()
    expect(lock.status).toBe('expired')
    expect(lock.releaseReason).toBe('expired')
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})

describe('RecordLockService.forceRelease', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('returns unreleased when user does not have force release feature', async () => {
    const { service, rbacService } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any
    rbacService.userHasAllFeatures.mockResolvedValue(false)
    serviceAny.findActiveLocks = jest.fn()

    const result = await service.forceRelease({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      reason: 'manual',
    })

    expect(result).toEqual({ ok: true, released: false, lock: null })
    expect(serviceAny.findActiveLocks).not.toHaveBeenCalled()
  })

  test('force releases oldest active lock when user has permission', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const serviceAny = service as any
    const oldest = buildLock({
      id: '10000000-0000-4000-8000-000000000001',
      lockedByUserId: '50000000-0000-4000-8000-000000000001',
      lockedAt: new Date('2026-02-17T09:50:00.000Z'),
      createdAt: new Date('2026-02-17T09:50:00.000Z'),
      expiresAt: new Date(Date.now() + 300_000),
      status: 'active',
      releaseReason: null,
      releasedAt: null,
      releasedByUserId: null,
    })
    const newer = buildLock({
      id: '10000000-0000-4000-8000-000000000002',
      token: '30000000-0000-4000-8000-000000000002',
      lockedByUserId: '60000000-0000-4000-8000-000000000001',
      lockedAt: new Date('2026-02-17T09:55:00.000Z'),
      createdAt: new Date('2026-02-17T09:55:00.000Z'),
      expiresAt: new Date(Date.now() + 300_000),
      status: 'active',
    })
    serviceAny.findActiveLocks = jest.fn().mockResolvedValue([newer, oldest])

    const result = await service.forceRelease({
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resourceKind: 'sales.quote',
      resourceId: '20000000-0000-4000-8000-000000000001',
      reason: 'manual',
    })

    expect(result.ok).toBe(true)
    expect(result.released).toBe(true)
    expect(oldest.status).toBe('force_released')
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(emitRecordLocksEvent).toHaveBeenCalledWith(
      'record_locks.lock.force_released',
      expect.objectContaining({
        lockId: oldest.id,
        releasedByUserId: '40000000-0000-4000-8000-000000000001',
      }),
    )
  })
})

describe('RecordLockService.resolveConflictById', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('does not resolve keep-mine conflict without override feature', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS, null, { canOverrideIncoming: false })
    const serviceAny = service as any
    em.findOne.mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000001',
      status: 'pending',
      conflictActorUserId: '40000000-0000-4000-8000-000000000001',
    })
    serviceAny.resolveConflict = jest.fn()

    const resolved = await service.resolveConflictById({
      conflictId: 'a0000000-0000-4000-8000-000000000001',
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resolution: 'accept_mine',
    })

    expect(resolved).toBe(false)
    expect(serviceAny.resolveConflict).not.toHaveBeenCalled()
  })

  test('resolves accept_incoming conflict for actor', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS, null, { canOverrideIncoming: false })
    const serviceAny = service as any
    const conflict = {
      id: 'a0000000-0000-4000-8000-000000000002',
      status: 'pending',
      conflictActorUserId: '40000000-0000-4000-8000-000000000001',
    }
    em.findOne.mockResolvedValue(conflict)
    serviceAny.resolveConflict = jest.fn().mockResolvedValue(undefined)

    const resolved = await service.resolveConflictById({
      conflictId: conflict.id,
      tenantId: '60000000-0000-4000-8000-000000000001',
      organizationId: '70000000-0000-4000-8000-000000000001',
      userId: '40000000-0000-4000-8000-000000000001',
      resolution: 'accept_incoming',
    })

    expect(resolved).toBe(true)
    expect(serviceAny.resolveConflict).toHaveBeenCalledWith(
      conflict,
      'accept_incoming',
      '40000000-0000-4000-8000-000000000001',
    )
  })
})

describe('RecordLockService without the audit_logs module (#9205)', () => {
  type AuditTrailProbe = {
    findLatestActionLog: (input: Record<string, unknown>) => Promise<unknown>
    findLatestActionLogByActor: (input: Record<string, unknown>, actorUserId: string) => Promise<unknown>
    findActionLogById: (logId: string | null, scope: Record<string, unknown>) => Promise<unknown>
  }
  const scope = {
    tenantId: '60000000-0000-4000-8000-000000000001',
    organizationId: '70000000-0000-4000-8000-000000000001',
    resourceKind: 'customers.person',
    resourceId: '20000000-0000-4000-8000-000000000001',
  }

  test('makes no ActionLog query when ActionLog has no ORM metadata', async () => {
    const actionLogService = { findById: jest.fn() }
    const { service, em } = createService(DEFAULT_SETTINGS, actionLogService, { auditTrailAvailable: false })
    const probe = service as unknown as AuditTrailProbe

    await expect(probe.findLatestActionLog(scope)).resolves.toBeNull()
    await expect(probe.findLatestActionLogByActor(scope, 'user-1')).resolves.toBeNull()
    await expect(probe.findActionLogById('log-1', scope)).resolves.toBeNull()

    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
    expect(actionLogService.findById).not.toHaveBeenCalled()
  })

  test('queries ActionLog when the ORM registered a distinct constructor of the same name', async () => {
    const { service, em } = createService(DEFAULT_SETTINGS)
    const RegisteredActionLog = class ActionLog {}
    const metadata = new MetadataStorage()
    const registered = metadata.set(RegisteredActionLog, new EntityMetadata({
      class: RegisteredActionLog,
      className: RegisteredActionLog.name,
    }))
    em.getMetadata.mockReturnValue(metadata)
    em.findOne.mockResolvedValue(null)
    const probe = service as unknown as AuditTrailProbe

    expect(metadata.has(ActionLog)).toBe(false)
    expect(metadata.find(ActionLog)).toBe(registered)
    await probe.findLatestActionLog(scope)

    expect(em.findOne).toHaveBeenCalledWith(ActionLog, expect.any(Object), expect.any(Object))
  })
})
