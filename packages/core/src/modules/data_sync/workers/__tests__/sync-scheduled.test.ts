/** @jest-environment node */

const mockFindOneWithDecryption = jest.fn()
const mockGetSyncQueue = jest.fn()

const mockEnqueue = jest.fn()

const mockSyncRunService = {
  findRunningOverlap: jest.fn(),
  resolveCursor: jest.fn(),
  createRun: jest.fn(),
}

const mockProgressService = {
  createJob: jest.fn(),
}

const mockIntegrationStateService = {
  isEnabled: jest.fn(),
}

const mockEm = {
  flush: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../../lib/queue', () => ({
  getSyncQueue: (...args: unknown[]) => mockGetSyncQueue(...args),
}))

jest.mock('../../data/entities', () => ({
  SyncSchedule: class SyncSchedule {},
}))

type WorkerModule = typeof import('../sync-scheduled')
let handle: WorkerModule['default']

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

function buildContext() {
  return {
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      if (token === 'dataSyncRunService') return mockSyncRunService
      if (token === 'progressService') return mockProgressService
      if (token === 'integrationStateService') return mockIntegrationStateService
      throw new Error(`Unexpected token: ${token}`)
    },
  } as never
}

function buildJob() {
  return {
    payload: {
      scheduleId: 'schedule-1',
      scope,
    },
  } as never
}

beforeAll(async () => {
  const workerModule = await import('../sync-scheduled')
  handle = workerModule.default
})

describe('data-sync scheduled worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSyncQueue.mockReturnValue({ enqueue: mockEnqueue })
    mockIntegrationStateService.isEnabled.mockResolvedValue(true)
    mockSyncRunService.findRunningOverlap.mockResolvedValue(null)
    mockSyncRunService.resolveCursor.mockResolvedValue('cursor-1')
    mockSyncRunService.createRun.mockImplementation(async (input: { progressJobId?: string | null }) => ({
      id: 'run-1',
      progressJobId: input.progressJobId ?? null,
    }))
    mockProgressService.createJob.mockResolvedValue({ id: 'progress-1' })
    mockEm.flush.mockResolvedValue(undefined)
  })

  it('creates a ProgressJob and links it to the scheduled run', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'schedule-1',
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      isEnabled: true,
      fullSync: false,
    })

    await handle(buildJob(), buildContext())

    expect(mockProgressService.createJob).toHaveBeenCalledTimes(1)
    expect(mockSyncRunService.createRun).toHaveBeenCalledTimes(1)
    const createRunInput = mockSyncRunService.createRun.mock.calls[0][0]
    expect(createRunInput.progressJobId).toBe('progress-1')
    expect(createRunInput.triggeredBy).toBe('scheduler')
    expect(createRunInput.cursor).toBe('cursor-1')
  })

  it('enqueues the import job with a tenant/organization-scoped payload', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'schedule-1',
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      isEnabled: true,
      fullSync: false,
    })

    await handle(buildJob(), buildContext())

    expect(mockGetSyncQueue).toHaveBeenCalledWith('data-sync-import')
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    const enqueuePayload = mockEnqueue.mock.calls[0][0]
    expect(enqueuePayload.runId).toBe('run-1')
    expect(enqueuePayload.scope.organizationId).toBe('org-1')
    expect(enqueuePayload.scope.tenantId).toBe('tenant-1')
  })

  it('updates lastRunAt before enqueuing', async () => {
    const schedule = {
      id: 'schedule-1',
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      isEnabled: true,
      fullSync: false,
      lastRunAt: null as Date | null,
    }
    mockFindOneWithDecryption.mockResolvedValue(schedule)

    await handle(buildJob(), buildContext())

    expect(schedule.lastRunAt).toBeInstanceOf(Date)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('resolves a null cursor for full-sync schedules', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'schedule-1',
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'export',
      isEnabled: true,
      fullSync: true,
    })

    await handle(buildJob(), buildContext())

    expect(mockSyncRunService.resolveCursor).not.toHaveBeenCalled()
    expect(mockGetSyncQueue).toHaveBeenCalledWith('data-sync-export')
    const createRunInput = mockSyncRunService.createRun.mock.calls[0][0]
    expect(createRunInput.cursor).toBeNull()
  })

  it('skips disabled schedules without creating a run', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'schedule-1',
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      isEnabled: false,
      fullSync: false,
    })

    await handle(buildJob(), buildContext())

    expect(mockProgressService.createJob).not.toHaveBeenCalled()
    expect(mockSyncRunService.createRun).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('skips when an overlapping run is already in progress', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'schedule-1',
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      isEnabled: true,
      fullSync: false,
    })
    mockSyncRunService.findRunningOverlap.mockResolvedValue({ id: 'running-1' })

    await handle(buildJob(), buildContext())

    expect(mockProgressService.createJob).not.toHaveBeenCalled()
    expect(mockSyncRunService.createRun).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('skips when the integration is disabled', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'schedule-1',
      integrationId: 'sync_excel',
      entityType: 'customers.person',
      direction: 'import',
      isEnabled: true,
      fullSync: false,
    })
    mockIntegrationStateService.isEnabled.mockResolvedValue(false)

    await handle(buildJob(), buildContext())

    expect(mockProgressService.createJob).not.toHaveBeenCalled()
    expect(mockSyncRunService.createRun).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
