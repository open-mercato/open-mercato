/** @jest-environment node */
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { ensureDefaultSchedules, listXeroSchedules } from '../lib/schedules'
import { createFakeContainer } from './support/fakeContainer'
import { createFakeScheduleService, type FakeScheduleService } from './support/fakeScheduleService'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const req = new Request('http://localhost:3000/api/sync_xero/organisation', { method: 'PUT' })

let schedules: FakeScheduleService
const logWrites: Array<Record<string, unknown>> = []

function container() {
  return createFakeContainer({
    dataSyncScheduleService: schedules,
    integrationLogService: { write: async (entry: Record<string, unknown>) => { logWrites.push(entry) } },
    rbacService: { getGrantedFeatures: async () => ['data_sync.*'] },
  })
}

beforeEach(() => {
  schedules = createFakeScheduleService()
  logWrites.length = 0
  registerMutationGuards([])
})

afterAll(() => {
  registerMutationGuards([])
})

describe('ensureDefaultSchedules', () => {
  it('creates one hourly incremental schedule per xero.* entity type, once, however often it runs', async () => {
    const first = await ensureDefaultSchedules({ container: container(), scope, guard: { req, userId: 'user-1' } })
    await ensureDefaultSchedules({ container: container(), scope, guard: { req, userId: 'user-1' } })
    expect(schedules.saves).toBe(1)
    expect([...schedules.schedules.values()]).toEqual([
      expect.objectContaining({
        integrationId: 'sync_xero',
        entityType: 'xero.contacts',
        direction: 'import',
        scheduleType: 'interval',
        scheduleValue: '1h',
        timezone: 'UTC',
        fullSync: false,
        isEnabled: true,
      }),
    ])
    expect(first).toEqual({ schedules: [{ entityType: 'xero.contacts', exists: true, isEnabled: true, fullSync: false, scheduleValue: '1h' }], failed: [] })
  })

  it('never changes an existing schedule, even a disabled one with full sync', async () => {
    await schedules.saveSchedule({
      integrationId: 'sync_xero',
      entityType: 'xero.contacts',
      direction: 'import',
      scheduleType: 'cron',
      scheduleValue: '0 3 * * *',
      timezone: 'Europe/Warsaw',
      fullSync: true,
      isEnabled: false,
    }, scope)
    const result = await ensureDefaultSchedules({ container: container(), scope, guard: { req, userId: 'user-1' } })
    expect(schedules.saves).toBe(1)
    expect(result.schedules).toEqual([{ entityType: 'xero.contacts', exists: true, isEnabled: false, fullSync: true, scheduleValue: '0 3 * * *' }])
  })

  it('reports a scheduler failure as xero.schedule_create_failed without throwing', async () => {
    schedules.failSaves = true
    const result = await ensureDefaultSchedules({ container: container(), scope, guard: { req, userId: 'user-1' } })
    expect(result).toEqual({ schedules: [{ entityType: 'xero.contacts', exists: false, isEnabled: false, fullSync: false, scheduleValue: null }], failed: ['xero.contacts'] })
    expect(logWrites).toEqual([expect.objectContaining({ level: 'warn', code: 'xero.schedule_create_failed', payload: { entityType: 'xero.contacts' } })])
  })

  it('runs the data_sync.schedule create guard and reports a block the same way', async () => {
    const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'Locked' } }))
    registerMutationGuards([{ moduleId: 'test', guards: [{ id: 'test.block-schedules', targetEntity: 'data_sync.schedule', operations: ['create'], validate }] }])
    const result = await ensureDefaultSchedules({ container: container(), scope, guard: { req, userId: 'user-1' } })
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ resourceKind: 'data_sync.schedule', operation: 'create', resourceId: scope.organizationId }))
    expect(result.failed).toEqual(['xero.contacts'])
    expect(schedules.saves).toBe(0)
  })

  it('lists a missing schedule as missing', async () => {
    await expect(listXeroSchedules(schedules, scope)).resolves.toEqual([
      { entityType: 'xero.contacts', exists: false, isEnabled: false, fullSync: false, scheduleValue: null },
    ])
  })
})
