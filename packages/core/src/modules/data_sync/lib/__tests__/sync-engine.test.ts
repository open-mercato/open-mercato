import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import { createSyncEngine } from '../sync-engine'
import type { SyncRunService } from '../sync-run-service'

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
      progressService: {} as ProgressService,
    })

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      engine.runImport('11111111-1111-1111-1111-111111111111', 100, {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      '[data-sync] Skipping stale import job for missing run 11111111-1111-1111-1111-111111111111',
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
      progressService: {} as ProgressService,
    })

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      engine.runExport('22222222-2222-2222-2222-222222222222', 100, {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      '[data-sync] Skipping stale export job for missing run 22222222-2222-2222-2222-222222222222',
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
