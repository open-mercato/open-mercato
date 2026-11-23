import { RecordLockService } from '../lib/recordLockService'
import type { RecordLockSettings } from '../lib/config'

jest.mock('../events', () => ({
  emitRecordLocksEvent: jest.fn().mockResolvedValue(undefined),
}))

const TENANT_ID = '60000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '70000000-0000-4000-8000-000000000001'
const REQUESTER_ID = '40000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '90000000-0000-4000-8000-000000000001'
const RESOURCE_ID = '20000000-0000-4000-8000-000000000001'
const CONFLICT_ID = 'a0000000-0000-4000-8000-000000000001'
const INCOMING_LOG_ID = '80000000-0000-4000-8000-000000000001'
const LATER_LOG_ID = '81000000-0000-4000-8000-000000000001'

const SETTINGS: RecordLockSettings = {
  enabled: true,
  strategy: 'optimistic',
  timeoutSeconds: 300,
  heartbeatSeconds: 30,
  maxActiveLocksPerUser: 50,
  enabledResources: ['customers.deal'],
  allowForceUnlock: true,
  allowIncomingOverride: true,
  notifyOnConflict: true,
}

type ConflictRow = {
  id: string
  status: string
  resolution: string | null
  resolvedByUserId: string | null
  conflictActorUserId: string
  incomingActionLogId: string | null
}

function pendingConflict(overrides: Partial<ConflictRow> = {}): ConflictRow {
  return {
    id: CONFLICT_ID,
    status: 'pending',
    resolution: null,
    resolvedByUserId: null,
    conflictActorUserId: REQUESTER_ID,
    incomingActionLogId: INCOMING_LOG_ID,
    ...overrides,
  }
}

function createService(options: {
  settings?: RecordLockSettings
  conflict?: ConflictRow | null
  latestLogId?: string | null
  canOverrideIncoming?: boolean
} = {}) {
  const service = new RecordLockService({
    em: {} as never,
    moduleConfigService: {
      getValue: jest.fn().mockResolvedValue(options.settings ?? SETTINGS),
      setValue: jest.fn(),
    } as never,
    actionLogService: null,
    rbacService: {
      userHasAllFeatures: jest.fn().mockResolvedValue(options.canOverrideIncoming ?? true),
    } as never,
  })
  const internals = service as unknown as {
    findConflictById: jest.Mock
    findLatestActionLog: jest.Mock
  }
  internals.findConflictById = jest.fn().mockResolvedValue(
    options.conflict === undefined ? pendingConflict() : options.conflict,
  )
  const latestLogId = options.latestLogId === undefined ? INCOMING_LOG_ID : options.latestLogId
  internals.findLatestActionLog = jest.fn().mockResolvedValue(latestLogId ? { id: latestLogId } : null)
  return { service, internals }
}

function keepMineInput(headers: Record<string, string> = { conflictId: CONFLICT_ID, resolution: 'accept_mine' }) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    userId: REQUESTER_ID,
    resourceKind: 'customers.deal',
    resourceId: RESOURCE_ID,
    method: 'PUT' as const,
    headers,
  }
}

describe('RecordLockService.canKeepMineOverrideStaleVersion', () => {
  it('allows the requester to keep their changes when nobody wrote since the conflict', async () => {
    const { service, internals } = createService()
    await expect(service.canKeepMineOverrideStaleVersion(keepMineInput())).resolves.toBe(true)
    expect(internals.findConflictById).toHaveBeenCalledWith(
      CONFLICT_ID,
      expect.objectContaining({ tenantId: TENANT_ID, resourceKind: 'customers.deal', resourceId: RESOURCE_ID }),
    )
  })

  it('allows a merged resolution the same way', async () => {
    const { service } = createService()
    await expect(
      service.canKeepMineOverrideStaleVersion(keepMineInput({ conflictId: CONFLICT_ID, resolution: 'merged' })),
    ).resolves.toBe(true)
  })

  it('allows a retry after the requester already resolved the conflict with the same choice', async () => {
    const { service } = createService({
      conflict: pendingConflict({ status: 'resolved_accept_mine', resolution: 'accept_mine', resolvedByUserId: REQUESTER_ID }),
    })
    await expect(service.canKeepMineOverrideStaleVersion(keepMineInput())).resolves.toBe(true)
  })

  it('refuses when someone wrote the record after the conflict was shown', async () => {
    const { service } = createService({ latestLogId: LATER_LOG_ID })
    await expect(service.canKeepMineOverrideStaleVersion(keepMineInput())).resolves.toBe(false)
  })

  it('refuses without a keep-mine resolution or a conflict id', async () => {
    const { service, internals } = createService()
    await expect(service.canKeepMineOverrideStaleVersion(keepMineInput({}))).resolves.toBe(false)
    await expect(
      service.canKeepMineOverrideStaleVersion(keepMineInput({ conflictId: CONFLICT_ID, resolution: 'accept_incoming' })),
    ).resolves.toBe(false)
    await expect(service.canKeepMineOverrideStaleVersion(keepMineInput({ resolution: 'accept_mine' }))).resolves.toBe(false)
    expect(internals.findConflictById).not.toHaveBeenCalled()
  })

  it('refuses an unknown conflict or one raised for another user', async () => {
    await expect(createService({ conflict: null }).service.canKeepMineOverrideStaleVersion(keepMineInput())).resolves.toBe(false)
    await expect(
      createService({ conflict: pendingConflict({ conflictActorUserId: OTHER_USER_ID }) })
        .service.canKeepMineOverrideStaleVersion(keepMineInput()),
    ).resolves.toBe(false)
  })

  it('refuses a conflict resolved differently or by someone else', async () => {
    await expect(
      createService({ conflict: pendingConflict({ status: 'resolved_accept_incoming', resolution: 'accept_incoming', resolvedByUserId: REQUESTER_ID }) })
        .service.canKeepMineOverrideStaleVersion(keepMineInput()),
    ).resolves.toBe(false)
    await expect(
      createService({ conflict: pendingConflict({ status: 'resolved_accept_mine', resolution: 'accept_mine', resolvedByUserId: OTHER_USER_ID }) })
        .service.canKeepMineOverrideStaleVersion(keepMineInput()),
    ).resolves.toBe(false)
  })

  it('refuses a conflict without a recorded incoming change', async () => {
    const { service } = createService({ conflict: pendingConflict({ incomingActionLogId: null }), latestLogId: null })
    await expect(service.canKeepMineOverrideStaleVersion(keepMineInput())).resolves.toBe(false)
  })

  it('refuses when the user may not override incoming changes', async () => {
    await expect(
      createService({ canOverrideIncoming: false }).service.canKeepMineOverrideStaleVersion(keepMineInput()),
    ).resolves.toBe(false)
    await expect(
      createService({ settings: { ...SETTINGS, allowIncomingOverride: false } })
        .service.canKeepMineOverrideStaleVersion(keepMineInput()),
    ).resolves.toBe(false)
  })

  it('refuses when record locking is off for the resource', async () => {
    const { service, internals } = createService({ settings: { ...SETTINGS, enabledResources: ['sales.quote'] } })
    await expect(service.canKeepMineOverrideStaleVersion(keepMineInput())).resolves.toBe(false)
    expect(internals.findConflictById).not.toHaveBeenCalled()
  })
})
