const clientConfigs: Array<Record<string, unknown>> = []

jest.mock('pg', () => ({
  Client: jest.fn((config: Record<string, unknown>) => {
    clientConfigs.push(config)
    return {
      connect: jest.fn(async () => undefined),
      query: jest.fn(async () => ({ rows: [{ enabled_schedules: 1, due_schedules: 0 }] })),
      end: jest.fn(async () => undefined),
    }
  }),
}))

jest.mock('@open-mercato/shared/lib/db/ssl', () => ({
  getSslConfig: jest.fn(() => undefined),
}))

import { probeEnabledSchedules } from '../scheduler-supervisor'

const DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/mercato'

describe('probeEnabledSchedules Postgres session time zone', () => {
  beforeEach(() => {
    clientConfigs.length = 0
  })

  it('opens the probe connection with OM_DB_DEFAULT_TIMEZONE from the env it was given', async () => {
    const result = await probeEnabledSchedules({ DATABASE_URL, OM_DB_DEFAULT_TIMEZONE: 'Asia/Tokyo' })
    expect(result).toMatchObject({ enabledSchedules: 1, error: false })
    expect(clientConfigs).toEqual([expect.objectContaining({ connectionString: DATABASE_URL, options: '-c TimeZone=Asia/Tokyo' })])
  })

  it('adds no session options when the variable is unset', async () => {
    await probeEnabledSchedules({ DATABASE_URL })
    expect(clientConfigs[0]).not.toHaveProperty('options')
  })
})
