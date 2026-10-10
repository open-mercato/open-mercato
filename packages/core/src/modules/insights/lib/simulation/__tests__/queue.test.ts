import {
  SIMULATION_MAINTENANCE_SCHEDULE_ID,
  ensureSimulationMaintenanceSchedule,
  isSimulationMaintenancePayload,
  readSimulationSlicePayload,
  resetSimulationScheduleCacheForTests,
} from '../queue'

const IDS = {
  runId: 'AAAAAAAA-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
}

describe('simulation queue payloads and schedule', () => {
  beforeEach(() => resetSimulationScheduleCacheForTests())

  it('reads ids-only slice payloads and drops anything else', () => {
    expect(readSimulationSlicePayload({ ...IDS, proposal: { secret: true } })).toEqual({ ...IDS, runId: IDS.runId.toLowerCase() })
    expect(readSimulationSlicePayload({ ...IDS, runId: 'nope' })).toBeNull()
    expect(readSimulationSlicePayload(null)).toBeNull()
    expect(isSimulationMaintenancePayload({ kind: 'simulation_maintenance' })).toBe(true)
    expect(isSimulationMaintenancePayload(IDS)).toBe(false)
  })

  it('registers the daily system tick once and never overrides an existing schedule', async () => {
    const register = jest.fn(async () => undefined)
    const exists = jest.fn(async () => false)
    const container = { resolve: () => ({ register, exists }) }
    await expect(ensureSimulationMaintenanceSchedule(container)).resolves.toBe(true)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: SIMULATION_MAINTENANCE_SCHEDULE_ID,
      scopeType: 'system',
      scheduleType: 'interval',
      scheduleValue: '1d',
      targetQueue: 'insights-simulation',
      targetPayload: { kind: 'simulation_maintenance' },
      sourceModule: 'insights',
    }))
    await ensureSimulationMaintenanceSchedule(container)
    expect(exists).toHaveBeenCalledTimes(1)
    resetSimulationScheduleCacheForTests()
    exists.mockResolvedValue(true)
    await ensureSimulationMaintenanceSchedule(container)
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('is best-effort without a scheduler or when registration fails', async () => {
    await expect(ensureSimulationMaintenanceSchedule({ resolve: () => { throw new Error('none') } })).resolves.toBe(false)
    await expect(ensureSimulationMaintenanceSchedule({ resolve: () => ({ register: async () => { throw new Error('db') } }) })).resolves.toBe(false)
  })
})
