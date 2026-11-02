/** @jest-environment node */
import { hash as bcryptHash } from 'bcryptjs'
import { MikroORM, PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { User, Session } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import {
  CustomerUser,
  CustomerUserSession,
} from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { createPasswordHasher, setPasswordHasher } from '@open-mercato/shared/lib/auth/passwordHasher'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip
const ARGON2_TEST_PARAMETERS = { memoryCost: 1024, timeCost: 1, parallelism: 1 }

describeWithPostgres('password rehash compare-and-swap against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: Awaited<ReturnType<typeof MikroORM.init>> | undefined

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: 'password_rehash_test',
        POSTGRES_USER: 'password_rehash_test',
        POSTGRES_PASSWORD: 'password_rehash_test',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'password_rehash_test',
      user: 'password_rehash_test',
      password: 'password_rehash_test',
      entities: [User, Session, CustomerUser, CustomerUserSession],
    })
    await orm.schema.create()
  }, 120_000)

  beforeEach(() => {
    setPasswordHasher(createPasswordHasher({
      algorithm: 'argon2id',
      bcryptCost: 4,
      argon2id: ARGON2_TEST_PARAMETERS,
    }))
  })

  afterEach(() => setPasswordHasher(null))

  afterAll(async () => {
    setPasswordHasher(null)
    await orm?.close(true)
    await postgres?.stop()
  })

  it('keeps a concurrent staff password reset after the login session flushes', async () => {
    const setupEm = orm!.em.fork() as EntityManager
    const originalHash = await bcryptHash('Original#1', 4)
    const user = setupEm.create(User, {
      email: 'staff@example.test',
      passwordHash: originalHash,
      tenantId: null,
      organizationId: null,
    })
    await setupEm.persist(user).flush()

    const loginEm = orm!.em.fork() as EntityManager
    const managedUser = await loginEm.findOneOrFail(User, { id: user.id })
    const service = new AuthService(loginEm)
    await expect(service.rehashPasswordIfNeeded(managedUser, 'Original#1')).resolves.toBe(true)

    const resetHash = await bcryptHash('Reset#2', 4)
    const resetEm = orm!.em.fork() as EntityManager
    await resetEm.nativeUpdate(User, { id: user.id }, { passwordHash: resetHash })

    const session = loginEm.create(Session, {
      user: managedUser,
      token: 'staff-session-token',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await loginEm.persist(session).flush()

    const assertEm = orm!.em.fork() as EntityManager
    const persisted = await assertEm.findOneOrFail(User, { id: user.id })
    expect(persisted.passwordHash).toBe(resetHash)
  })

  it('keeps a concurrent portal password reset after the login session flushes', async () => {
    const setupEm = orm!.em.fork() as EntityManager
    const originalHash = await bcryptHash('Original#1', 4)
    const user = setupEm.create(CustomerUser, {
      tenantId: '0fe109f9-bc18-470d-ad67-2a34cdb61287',
      organizationId: 'bf69d004-5d69-40fc-8e08-651bc35b2b82',
      email: 'portal@example.test',
      emailHash: 'portal-email-hash',
      passwordHash: originalHash,
      displayName: 'Portal User',
    })
    await setupEm.persist(user).flush()

    const loginEm = orm!.em.fork() as EntityManager
    const managedUser = await loginEm.findOneOrFail(CustomerUser, { id: user.id })
    const service = new CustomerUserService(loginEm)
    await expect(service.rehashPasswordIfNeeded(managedUser, 'Original#1')).resolves.toBe(true)

    const resetHash = await bcryptHash('Reset#2', 4)
    const resetEm = orm!.em.fork() as EntityManager
    await resetEm.nativeUpdate(CustomerUser, { id: user.id }, { passwordHash: resetHash })

    const session = loginEm.create(CustomerUserSession, {
      user: managedUser,
      tokenHash: 'portal-session-token-hash',
      expiresAt: new Date(Date.now() + 60_000),
    })
    await loginEm.persist(session).flush()

    const assertEm = orm!.em.fork() as EntityManager
    const persisted = await assertEm.findOneOrFail(CustomerUser, { id: user.id })
    expect(persisted.passwordHash).toBe(resetHash)
  })
})
