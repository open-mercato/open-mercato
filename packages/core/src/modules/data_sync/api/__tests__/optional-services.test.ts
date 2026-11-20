/** @jest-environment node */

import { asValue, createContainer } from 'awilix'
import type { createSyncScheduleService } from '../../lib/sync-schedule-service'
import { registerDataSyncAdapter } from '../../lib/adapter-registry'
import { register } from '../../di'
import { POST as start } from '../run'
import { GET as detail } from '../runs/[id]/route'
import { POST as cancel } from '../runs/[id]/cancel'
import { POST as retry } from '../runs/[id]/retry'

const mockContainer = createContainer()
const mockEnqueue = jest.fn()
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const runId = '11111111-1111-4111-8111-111111111111'
const params = { params: { id: runId } }
const integrationId = 'sync_test'
const entityType = 'customers.person'
const run = { id: runId, integrationId, entityType, direction: 'import', status: 'failed', createdAt: new Date(), updatedAt: new Date(), progressJobId: 'previous-job' }
const runService = {
  getRun: jest.fn(async () => run),
  markStatus: jest.fn(async () => ({ ...run, status: 'cancelled' })),
  findRunningOverlap: jest.fn(async () => null),
  resolveCursor: jest.fn(async () => null),
  createRun: jest.fn(async () => ({ id: runId })),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: () => mockContainer }))
jest.mock('@open-mercato/shared/modules/integrations/types', () => ({ getIntegration: () => ({ providerKey: 'test' }) }))
jest.mock('../../lib/queue', () => ({ getSyncQueue: () => ({ enqueue: mockEnqueue }) }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findAndCountWithDecryption: async () => [[], 0],
  findOneWithDecryption: async () => ({ id: 'schedule-1' }),
}))

beforeAll(() => {
  registerDataSyncAdapter({
    providerKey: 'test', direction: 'import', supportedEntities: [entityType],
    getMapping: async () => ({ entityType, matchStrategy: 'externalId', fields: [] }),
  })
  mockContainer.register({
    dataSyncRunService: asValue(runService),
    integrationStateService: asValue({ isEnabled: async () => true, upsert: jest.fn() }),
    integrationLogService: asValue({ write: jest.fn() }),
  })
})

it('resolves the scoped engine and schedule service without either optional registration', async () => {
  const root = createContainer()
  register(root)
  const scoped = root.createScope()
  scoped.register({ em: asValue({}), integrationStateService: asValue({}), integrationLogService: asValue({}), integrationCredentialsService: asValue({}) })
  expect(scoped.resolve('dataSyncEngine')).toHaveProperty('runImport')
  const schedules = scoped.resolve<ReturnType<typeof createSyncScheduleService>>('dataSyncScheduleService')
  await expect(schedules.listSchedules({ page: 1, pageSize: 10 }, scope)).resolves.toEqual({ items: [], total: 0 })
  const schedule = {
    integrationId, entityType, direction: 'import' as const, scheduleType: 'cron' as const,
    scheduleValue: '0 * * * *', timezone: 'UTC', fullSync: false, isEnabled: true,
  }
  await expect(schedules.saveSchedule(schedule, scope)).rejects.toThrow('Scheduler module is not available')
  await expect(schedules.saveSchedule({ ...schedule, id: 'schedule-1' }, scope)).rejects.toThrow('Scheduler module is not available')
  await expect(schedules.deleteSchedule('schedule-1', scope)).rejects.toThrow('Scheduler module is not available')
})

it('starts a run without a progress job', async () => {
  const response = await start(new Request('http://localhost/api/data_sync/run', {
    method: 'POST', body: JSON.stringify({ integrationId, entityType, direction: 'import' }),
  }))
  expect(response.status).toBe(201)
  expect(await response.json()).toEqual({ id: runId, progressJobId: null })
})

it('returns detail even for a previously linked progress job', async () => {
  const response = await detail(new Request('http://localhost/'), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ id: runId, progressJob: null, progressJobId: 'previous-job' })
})

it('cancels the scoped run even for a previously linked progress job', async () => {
  runService.getRun.mockResolvedValueOnce({ ...run, status: 'running' })
  const response = await cancel(new Request('http://localhost/', { method: 'POST' }), params)
  expect(response.status).toBe(200)
  expect(runService.markStatus).toHaveBeenCalledWith(runId, 'cancelled', scope)
})

it('retries without a progress job', async () => {
  const response = await retry(new Request('http://localhost/', { method: 'POST', body: '{}' }), params)
  expect(response.status).toBe(201)
  expect(await response.json()).toEqual({ id: runId, progressJobId: null })
})
