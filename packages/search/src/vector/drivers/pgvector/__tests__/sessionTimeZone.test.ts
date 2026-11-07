const poolConfigs: Array<Record<string, unknown>> = []

jest.mock('pg', () => ({
  Pool: jest.fn((config: Record<string, unknown>) => {
    poolConfigs.push(config)
    return { query: jest.fn(), connect: jest.fn(), end: jest.fn() }
  }),
}))

import { createPgVectorDriver } from '../index'

const CONNECTION = 'postgres://postgres:postgres@localhost:5432/mercato'

describe('pgvector driver Postgres session time zone', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    poolConfigs.length = 0
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('opens its own pool with OM_DB_DEFAULT_TIMEZONE', () => {
    process.env.OM_DB_DEFAULT_TIMEZONE = 'Europe/Warsaw'
    createPgVectorDriver({ connectionString: CONNECTION })
    expect(poolConfigs).toEqual([{ connectionString: CONNECTION, options: '-c TimeZone=Europe/Warsaw' }])
  })

  it('adds no session options when the variable is unset', () => {
    delete process.env.OM_DB_DEFAULT_TIMEZONE
    createPgVectorDriver({ connectionString: CONNECTION })
    expect(poolConfigs).toEqual([{ connectionString: CONNECTION }])
  })
})
