/** @jest-environment node */
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { Session, Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { POST } from '../logout'

let mockOrm: Awaited<ReturnType<typeof MikroORM.init>> | undefined
const mockEmitAuthEvent = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => new AuthService(mockOrm!.em.fork()),
  }),
}))
jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: (...args: unknown[]) => mockEmitAuthEvent(...args),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('refresh-only logout against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'logout_test', POSTGRES_USER: 'logout_test', POSTGRES_PASSWORD: 'logout_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    mockOrm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'logout_test',
      user: 'logout_test',
      password: 'logout_test',
      entities: [User, Session, Role, UserRole, Tenant, Organization],
    })
    await mockOrm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      await mockOrm?.close(true)
    } finally {
      await postgres?.stop()
    }
  }, 30_000)

  it('emits once when both requests resolve the same session before deleting it', async () => {
    const em = mockOrm!.em.fork()
    const tenant = em.create(Tenant, { name: 'Logout test' })
    await em.persist(tenant).flush()
    const organization = em.create(Organization, { tenant, name: 'Logout test' })
    await em.persist(organization).flush()
    const user = em.create(User, { tenantId: tenant.id, organizationId: organization.id, email: 'logout@example.test' })
    await em.persist(user).flush()
    const { session, token } = await new AuthService(em).createSession(user, new Date(Date.now() + 60_000))

    let finishLookups!: () => void
    const bothLookupsFinished = new Promise<void>((resolve) => { finishLookups = resolve })
    let lookups = 0
    const refreshFromSessionToken = AuthService.prototype.refreshFromSessionToken
    const observation = jest.spyOn(AuthService.prototype, 'refreshFromSessionToken')
      .mockImplementation(async function (this: AuthService, refreshToken) {
        let result: Awaited<ReturnType<AuthService['refreshFromSessionToken']>>
        try {
          result = await refreshFromSessionToken.call(this, refreshToken)
        } finally {
          lookups += 1
          if (lookups === 2) finishLookups()
          await bothLookupsFinished
        }
        return result
      })
    const logout = () => POST(new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `session_token=${encodeURIComponent(token)}` },
    }))

    try {
      const responses = await Promise.all([logout(), logout()])

      expect(responses.map((response) => response.status)).toEqual([303, 303])
      expect(await em.count(Session, { id: session.id })).toBe(0)
      expect(mockEmitAuthEvent).toHaveBeenCalledTimes(1)
      expect(mockEmitAuthEvent).toHaveBeenCalledWith('auth.logout', {
        id: user.id, tenantId: tenant.id, organizationId: organization.id, sessionId: session.id,
        sessionRevoked: true, at: expect.any(String),
      }, { persistent: true })
    } finally {
      observation.mockRestore()
    }
  })
})
