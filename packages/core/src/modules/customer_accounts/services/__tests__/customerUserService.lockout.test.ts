/** @jest-environment node */
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import type { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'

type Row = Record<string, unknown>

function buildRecordingKysely(rows: Row[]) {
  const queries: CompiledQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(compiledQuery)
      return { rows: rows as R[] }
    },
    async *streamQuery() {
      throw new Error('[internal] streaming is not supported in this test driver')
    },
  }
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  }
  const db = new Kysely<Record<string, Row>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return { db, queries }
}

function buildService(rows: Row[]) {
  const { db, queries } = buildRecordingKysely(rows)
  const nativeUpdate = jest.fn()
  const em = { getKysely: () => db, nativeUpdate } as unknown as EntityManager
  return { service: new CustomerUserService(em), queries, nativeUpdate }
}

function buildUser(overrides: Partial<CustomerUser> = {}): CustomerUser {
  return { id: 'user-1', failedLoginAttempts: 2, lockedUntil: null, ...overrides } as CustomerUser
}

describe('CustomerUserService failed-login counter (#7232)', () => {
  it('increments the counter and engages the lock in one UPDATE instead of writing a count computed from the loaded row', async () => {
    const { service, queries, nativeUpdate } = buildService([])

    await service.incrementFailedAttempts(buildUser({ failedLoginAttempts: 0 }))

    expect(nativeUpdate).not.toHaveBeenCalled()
    expect(queries).toHaveLength(1)
    expect(queries[0].sql).toBe(
      'update "customer_users" set "failed_login_attempts" = "failed_login_attempts" + $1, '
        + '"locked_until" = case when "failed_login_attempts" >= $2 then greatest("locked_until", $3) else "locked_until" end '
        + 'where "id" = $4',
    )
    expect(queries[0].parameters[0]).toBe(1)
    expect(queries[0].parameters[1]).toBe(4)
    expect(queries[0].parameters[2]).toBeInstanceOf(Date)
    expect(queries[0].parameters[3]).toBe('user-1')
  })

  it('locks for the full lockout window from the moment of the failure', async () => {
    const { service, queries } = buildService([])
    const before = Date.now()

    await service.incrementFailedAttempts(buildUser())

    const lockUntil = (queries[0].parameters[2] as Date).getTime()
    expect(lockUntil).toBeGreaterThanOrEqual(before + 15 * 60 * 1000)
    expect(lockUntil).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000)
  })

  it('locks with GREATEST of the stored lock and the new window so a longer stored lock is not shortened', async () => {
    const { service, queries } = buildService([])

    await service.incrementFailedAttempts(buildUser({ failedLoginAttempts: 4 }))

    expect(queries[0].sql).toContain('then greatest("locked_until", $3) else "locked_until" end')
    const lockUntil = (queries[0].parameters[2] as Date).getTime()
    expect(lockUntil).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000)
  })

  it('leaves the loaded entity untouched so a later flush of the request cannot overwrite a concurrent count', async () => {
    const { service } = buildService([])
    const user = buildUser({ failedLoginAttempts: 2 })

    await service.incrementFailedAttempts(user)
    await service.resetFailedAttemptsUnlessLocked(user)

    expect(user.failedLoginAttempts).toBe(2)
    expect(user.lockedUntil).toBeNull()
  })

  it('clears the counter only while no lock is active', async () => {
    const { service, queries } = buildService([{ id: 'user-1' }])
    const user = buildUser({ failedLoginAttempts: 3 })

    await expect(service.resetFailedAttemptsUnlessLocked(user)).resolves.toBe(true)

    expect(queries).toHaveLength(1)
    expect(queries[0].sql).toBe(
      'update "customer_users" set "failed_login_attempts" = $1, "locked_until" = $2 '
        + 'where "id" = $3 and ("locked_until" is null or "locked_until" <= $4) returning "id"',
    )
    expect(queries[0].parameters.slice(0, 3)).toEqual([0, null, 'user-1'])
    expect(queries[0].parameters[3]).toBeInstanceOf(Date)
    expect(user.failedLoginAttempts).toBe(3)
  })

  it('reports a lock that engaged before the reset', async () => {
    const { service } = buildService([])

    await expect(service.resetFailedAttemptsUnlessLocked(buildUser({ failedLoginAttempts: 4 }))).resolves.toBe(false)
  })

  it('resets unconditionally for the magic-link path without touching the loaded entity', async () => {
    const { service, nativeUpdate } = buildService([])
    const lockedUntil = new Date(Date.now() + 60_000)
    const user = buildUser({ failedLoginAttempts: 5, lockedUntil })

    await service.resetFailedAttempts(user)

    expect(nativeUpdate).toHaveBeenCalledWith(expect.anything(), { id: 'user-1' }, { failedLoginAttempts: 0, lockedUntil: null })
    expect(user.failedLoginAttempts).toBe(5)
    expect(user.lockedUntil).toBe(lockedUntil)
  })
})
