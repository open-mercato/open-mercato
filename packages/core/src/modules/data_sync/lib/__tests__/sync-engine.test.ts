import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import { createSyncEngine } from '../sync-engine'
import type { SyncRunService } from '../sync-run-service'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  debug: jest.Mock
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
}


describe('data sync engine stale jobs', () => {
  it('skips stale import jobs when run record is missing', async () => {
    const syncRunService = {
      getRun: jest.fn(async () => null),
    } as unknown as SyncRunService

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: {} as CredentialsService,
      integrationLogService: {} as IntegrationLogService,
      integrationStateService: { upsert: jest.fn(async () => undefined) } as any,
      progressService: {} as ProgressService,
    })

    mockLogger.warn.mockClear()
    const warnSpy = mockLogger.warn

    await expect(
      engine.runImport('11111111-1111-1111-1111-111111111111', 100, {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping stale import job for missing run',
      { runId: '11111111-1111-1111-1111-111111111111' },
    )

    warnSpy.mockRestore()
  })

  it('skips stale export jobs when run record is missing', async () => {
    const syncRunService = {
      getRun: jest.fn(async () => null),
    } as unknown as SyncRunService

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: {} as CredentialsService,
      integrationLogService: {} as IntegrationLogService,
      integrationStateService: { upsert: jest.fn(async () => undefined) } as any,
      progressService: {} as ProgressService,
    })

    mockLogger.warn.mockClear()
    const warnSpy = mockLogger.warn

    await expect(
      engine.runExport('22222222-2222-2222-2222-222222222222', 100, {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping stale export job for missing run',
      { runId: '22222222-2222-2222-2222-222222222222' },
    )

    warnSpy.mockRestore()
  })

  it('skips cancelled import jobs and closes their progress job', async () => {
    const syncRunService = {
      getRun: jest.fn(async () => ({
        id: 'run-1',
        status: 'cancelled',
        progressJobId: 'job-1',
      })),
    } as unknown as SyncRunService
    const progressService = {
      markCancelled: jest.fn(async () => undefined),
    } as unknown as ProgressService

    const engine = createSyncEngine({
      em: {} as EntityManager,
      syncRunService,
      integrationCredentialsService: {} as CredentialsService,
      integrationLogService: {} as IntegrationLogService,
      integrationStateService: { upsert: jest.fn(async () => undefined) } as any,
      progressService,
    })

    await expect(
      engine.runImport('run-1', 100, {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined()

    expect(progressService.markCancelled).toHaveBeenCalledWith('job-1', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
    })
  })
})
