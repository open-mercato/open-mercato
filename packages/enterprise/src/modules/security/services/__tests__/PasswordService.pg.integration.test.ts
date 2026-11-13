import { randomUUID } from 'node:crypto'
import { LockMode, MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import type { StartedTestContainer } from 'testcontainers'
import { PasswordReset, Role, Session, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant, Organization } from '@open-mercato/core/modules/directory/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { emitSecurityEvent } from '../../events'
import { PasswordService } from '../PasswordService'

jest.mock('../../events', () => ({ emitSecurityEvent: jest.fn().mockResolvedValue(undefined) }))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('PasswordService credential revocation against PostgreSQL (#9143)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: Awaited<ReturnType<typeof MikroORM.init>>

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'password_test', POSTGRES_USER: 'password_test', POSTGRES_PASSWORD: 'password_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(), port: postgres.getMappedPort(5432),
      dbName: 'password_test', user: 'password_test', password: 'password_test',
      entities: [User, Session, PasswordReset, Role, UserRole, Tenant, Organization],
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  beforeEach(() => jest.clearAllMocks())

  async function createCredentials() {
    const em = orm.em.fork()
    const tenant = em.create(Tenant, { name: 'Password regression' })
    await em.persist(tenant).flush()
    const user = em.create(User, {
      email: `${randomUUID()}@example.test`, tenantId: tenant.id,
      passwordHash: await hash('CurrentPass1!', 10),
    })
    const expiresAt = new Date(Date.now() + 60_000)
    const callerToken = randomUUID()
    const otherToken = randomUUID()
    const resetToken = randomUUID()
    const caller = em.create(Session, { user, token: hashAuthToken(callerToken), expiresAt })
    const other = em.create(Session, { user, token: hashAuthToken(otherToken), expiresAt })
    const reset = em.create(PasswordReset, { user, token: hashAuthToken(resetToken), expiresAt })
    await em.persist([user, caller, other, reset]).flush()
    return { user, caller, other, reset, callerToken, otherToken, resetToken }
  }

  test('preserves caller refresh and rejects other refresh/reset tokens without affecting another tenant', async () => {
    const target = await createCredentials()
    const control = await createCredentials()
    await new PasswordService(orm.em.fork()).changePassword(target.user.id, 'CurrentPass1!', 'StrongPass2!', target.caller.id)

    const auth = new AuthService(orm.em.fork())
    expect(await auth.refreshFromSessionToken(target.otherToken)).toBeNull()
    expect((await auth.refreshFromSessionToken(target.callerToken))?.session.id).toBe(target.caller.id)
    expect(await auth.isPasswordResetTokenValid(target.resetToken)).toBe(false)
    expect(await auth.confirmPasswordReset(target.resetToken, 'ResetAttempt3!')).toBeNull()
    expect((await auth.refreshFromSessionToken(control.otherToken))?.user.id).toBe(control.user.id)
    expect(await auth.isPasswordResetTokenValid(control.resetToken)).toBe(true)
    const stored = await orm.em.fork().findOneOrFail(User, { id: target.user.id })
    expect(await compare('StrongPass2!', stored.passwordHash!)).toBe(true)
    expect(await compare('CurrentPass1!', stored.passwordHash!)).toBe(false)
    expect(emitSecurityEvent).toHaveBeenCalledTimes(2)
  })

  test('rolls back password and deleted sessions if consuming reset tokens fails', async () => {
    const target = await createCredentials()
    await orm.em.getConnection().execute(`
      create function reject_password_reset_update() returns trigger language plpgsql as $$
      begin raise exception 'fixture reset update failure'; end $$;
      create trigger reject_password_reset_update before update on password_resets
      for each row execute function reject_password_reset_update();
    `)
    try {
      await expect(new PasswordService(orm.em.fork()).changePassword(
        target.user.id, 'CurrentPass1!', 'StrongPass2!', target.caller.id,
      )).rejects.toThrow('fixture reset update failure')

      const auth = new AuthService(orm.em.fork())
      expect((await auth.refreshFromSessionToken(target.callerToken))?.session.id).toBe(target.caller.id)
      expect((await auth.refreshFromSessionToken(target.otherToken))?.session.id).toBe(target.other.id)
      expect(await auth.isPasswordResetTokenValid(target.resetToken)).toBe(true)
      const stored = await orm.em.fork().findOneOrFail(User, { id: target.user.id })
      expect(await compare('CurrentPass1!', stored.passwordHash!)).toBe(true)
      expect(emitSecurityEvent).not.toHaveBeenCalled()
    } finally {
      await orm.em.getConnection().execute('drop trigger reject_password_reset_update on password_resets; drop function reject_password_reset_update()')
    }
  })

  test('serializes concurrent changes so only one can verify the old password', async () => {
    const target = await createCredentials()
    const blocker = orm.em.fork()
    await blocker.begin()
    const pending: Promise<void>[] = []
    try {
      await blocker.findOneOrFail(User, { id: target.user.id }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      pending.push(...['StrongPass2!', 'DifferentPass3!'].map((password) =>
        new PasswordService(orm.em.fork()).changePassword(target.user.id, 'CurrentPass1!', password, target.caller.id),
      ))
      const deadline = Date.now() + 5_000
      let blocked = 0
      while (Date.now() < deadline && blocked < 2) {
        const rows = await orm.em.getConnection().execute<{ count: number }[]>(
          "select count(*)::int from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
        )
        blocked = rows[0].count
        if (blocked < 2) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(blocked).toBe(2)
    } finally {
      await blocker.rollback()
    }
    const outcomes = await Promise.allSettled(pending)

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ statusCode: 401 }) }),
    ])
    expect(emitSecurityEvent).toHaveBeenCalledTimes(2)
  })
})
