import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { MigrationRunner } from '@mikro-orm/migrations'
import { Migration20261115235522_security } from '../../migrations/Migration20261115235522_security'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import { TOTP, Secret } from 'otpauth'
import type { StartedTestContainer } from 'testcontainers'
import { MfaChallenge, MfaVerificationState, UserMfaMethod } from '../../data/entities'
import { MfaProviderRegistry } from '../../lib/mfa-provider-registry'
import { TotpProvider } from '../../lib/providers/TotpProvider'
import { defaultSecurityModuleConfig } from '../../lib/security-config'
import { emitSecurityEvent } from '../../events'
import { MfaVerificationService } from '../MfaVerificationService'
import type { MfaService } from '../MfaService'
import type { MfaEnforcementService } from '../MfaEnforcementService'

jest.mock('../../events', () => ({ emitSecurityEvent: jest.fn(async () => undefined) }))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip
const SECRET = 'JBSWY3DPEHPK3PXP'
const config = {
  ...defaultSecurityModuleConfig,
  mfa: { ...defaultSecurityModuleConfig.mfa, maxAttempts: 3 },
}

describeWithPostgres('MFA verification PostgreSQL persistence and concurrency', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver> | undefined

  const manager = () => {
    if (!orm) throw new Error('[internal] Test database not initialized')
    return orm.em.fork()
  }
  const createService = (em: EntityManager = manager(), provider = new TotpProvider(config, 'test-setup-secret')) => {
    const registry = new MfaProviderRegistry()
    registry.register(provider)
    return new MfaVerificationService(em, registry, {} as MfaService, {
      getEffectivePolicyForUser: async () => null,
    } as unknown as MfaEnforcementService, config)
  }
  const fixture = async () => {
    const em = manager()
    const userId = randomUUID()
    const tenantId = randomUUID()
    const method = em.create(UserMfaMethod, {
      userId, tenantId, type: 'totp', secret: SECRET, providerMetadata: {}, isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    })
    em.persist(method)
    await em.flush()
    return { userId, tenantId, methodId: method.id }
  }
  const verify = (service: MfaVerificationService, challengeId: string, userId: string, code: string) =>
    service.verifyChallenge(challengeId, 'totp', { code }, undefined, { userId })
  const currentCode = () => new TOTP({ secret: Secret.fromBase32(SECRET), period: 30, digits: 6 }).generate()
  const invalidCode = () => {
    const totp = new TOTP({ secret: Secret.fromBase32(SECRET), period: 30, digits: 6 })
    return ['000000', '000001', '000002', '000003'].find((code) => totp.validate({ token: code, window: 1 }) === null) ?? '999999'
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'mfa_9153', POSTGRES_USER: 'mfa_test', POSTGRES_PASSWORD: 'mfa_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(), port: postgres.getMappedPort(5432),
      dbName: 'mfa_9153', user: 'mfa_test', password: 'mfa_test',
      entities: [MfaChallenge, MfaVerificationState, UserMfaMethod],
      pool: { min: 0, max: 3 },
    })
    await orm.schema.create()
  }, 120_000)

  afterEach(async () => {
    jest.clearAllMocks()
    await manager().execute('truncate mfa_challenges, mfa_verification_states, user_mfa_methods')
  })

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  test('migration up enforces tenant/user uniqueness and down preserves existing MFA data', async () => {
    if (!orm) throw new Error('[internal] Test database not initialized')
    const database = orm
    const em = manager()
    const { userId, tenantId, methodId } = await fixture()
    const runner = new MigrationRunner(em.getDriver(), { transactional: true }, database.config)
    const run = (direction: 'up' | 'down') => runner.run(
      new Migration20261115235522_security(em.getDriver(), database.config), direction,
    )
    const tableExists = async () => {
      const [result] = await em.execute<Array<{ table_name: string | null }>>(
        "select to_regclass('public.mfa_verification_states') as table_name",
      )
      return result.table_name !== null
    }
    await run('down')
    expect(await tableExists()).toBe(false)
    try {
      await run('up')
      const insert = (targetTenantId: string) => em.execute(
        'insert into mfa_verification_states (user_id, tenant_id, reset_at, updated_at) values (?, ?, now(), now())',
        [userId, targetTenantId],
      )
      await insert(tenantId)
      expect((await manager().findOneOrFail(MfaVerificationState, { userId, tenantId })).attempts).toBe(0)
      await expect(insert(tenantId)).rejects.toMatchObject({ code: '23505' })
      await insert(randomUUID())
      expect(await manager().count(MfaVerificationState, { userId })).toBe(2)
      await run('down')
      expect(await tableExists()).toBe(false)
      expect(await manager().count(UserMfaMethod, { id: methodId })).toBe(1)
    } finally {
      if (!await tableExists()) await run('up')
    }
  })

  test('fresh challenges and service instances share the budget; lock expires without extending on blocked calls', async () => {
    const { userId, tenantId } = await fixture()
    for (let attempt = 0; attempt < config.mfa.maxAttempts; attempt += 1) {
      const service = createService()
      const { challengeId } = await service.createChallenge(userId)
      expect(await verify(service, challengeId, userId, invalidCode())).toBe(false)
    }
    const em = manager()
    const state = await em.findOneOrFail(MfaVerificationState, { userId, tenantId })
    expect(state.attempts).toBe(3)
    expect(state.lockedUntil?.getTime()).toBeGreaterThan(Date.now())
    const service = createService()
    const { challengeId } = await service.createChallenge(userId)
    expect(await verify(service, challengeId, userId, currentCode())).toBe(false)
    expect(await manager().findOneOrFail(MfaVerificationState, { userId, tenantId })).toMatchObject({ lockedUntil: state.lockedUntil })
    expect(emitSecurityEvent).toHaveBeenCalledTimes(1)
    state.lockedUntil = new Date(Date.now() - 1)
    state.resetAt = state.lockedUntil
    await em.flush()
    expect(await verify(createService(), challengeId, userId, currentCode())).toBe(true)
    expect((await manager().findOneOrFail(MfaVerificationState, { userId, tenantId })).attempts).toBe(0)
  })

  test('a consumed TOTP code is rejected on another challenge and another provider instance', async () => {
    const { userId, methodId } = await fixture()
    const code = currentCode()
    const first = createService()
    const second = createService()
    const challengeA = await first.createChallenge(userId)
    const challengeB = await second.createChallenge(userId)
    expect(await verify(first, challengeA.challengeId, userId, code)).toBe(true)
    expect(await verify(second, challengeB.challengeId, userId, code)).toBe(false)
    await expect(verify(createService(), challengeA.challengeId, userId, code)).rejects.toMatchObject({ statusCode: 400 })
    const method = await manager().findOneOrFail(UserMfaMethod, { id: methodId })
    expect(method.providerMetadata?.lastAcceptedTimeStep).toEqual(expect.any(Number))
  })

  test('concurrent valid submissions evaluate one proof and cannot starve an unrelated account', async () => {
    const owner = await fixture()
    const unrelated = await fixture()
    let entered: () => void = () => undefined
    let release: () => void = () => undefined
    const reached = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const provider = new TotpProvider(config, 'test-setup-secret')
    const originalVerify = provider.verify.bind(provider)
    const verifySpy = jest.spyOn(provider, 'verify').mockImplementation(async (...args) => {
      entered()
      await gate
      return originalVerify(...args)
    })
    const holder = createService(manager(), provider)
    const challengeA = await holder.createChallenge(owner.userId)
    const challengeB = await createService().createChallenge(owner.userId)
    const challengeOther = await createService().createChallenge(unrelated.userId)
    const code = currentCode()
    const first = verify(holder, challengeA.challengeId, owner.userId, code)
    try {
      await reached
      const contenders = await Promise.all(Array.from({ length: 8 }, () =>
        verify(createService(), challengeB.challengeId, owner.userId, code)))
      expect(contenders).toEqual(Array(8).fill(false))
      expect(await verify(createService(), challengeOther.challengeId, unrelated.userId, currentCode())).toBe(true)
      expect(verifySpy).toHaveBeenCalledTimes(1)
    } finally {
      release()
      await first
    }
    expect(await verify(createService(), challengeB.challengeId, owner.userId, code)).toBe(false)
  })

  test('parallel failures cannot exceed the account budget even with fresh challenges', async () => {
    const { userId, tenantId } = await fixture()
    const challenges = await Promise.all(Array.from({ length: 9 }, () => createService().createChallenge(userId)))
    await Promise.all(challenges.map(({ challengeId }) => verify(createService(), challengeId, userId, invalidCode())))
    for (const { challengeId } of challenges) {
      await verify(createService(), challengeId, userId, invalidCode())
    }
    expect((await manager().findOneOrFail(MfaVerificationState, { userId, tenantId })).attempts).toBe(config.mfa.maxAttempts)
    expect(emitSecurityEvent).toHaveBeenCalledTimes(1)
  })

  test('wrong-owner challenges cannot spend another account budget and another tenant remains independent', async () => {
    const owner = await fixture()
    const other = await fixture()
    const challenge = await createService().createChallenge(owner.userId)
    await expect(verify(createService(), challenge.challengeId, other.userId, invalidCode())).rejects.toMatchObject({ statusCode: 404 })
    expect(await manager().count(MfaVerificationState, {})).toBe(0)
    for (let attempt = 0; attempt < config.mfa.maxAttempts; attempt += 1) {
      const { challengeId } = await createService().createChallenge(owner.userId)
      await verify(createService(), challengeId, owner.userId, invalidCode())
    }
    const { challengeId } = await createService().createChallenge(other.userId)
    expect(await verify(createService(), challengeId, other.userId, currentCode())).toBe(true)
  })

  test('a failed transaction does not consume a TOTP step or accept the challenge', async () => {
    const { userId, methodId } = await fixture()
    const em = manager()
    const provider = new TotpProvider(config, 'test-setup-secret')
    const verifySpy = jest.spyOn(provider, 'verify')
    const service = createService(em, provider)
    const { challengeId } = await service.createChallenge(userId)
    let failNextFlush = true
    em.getEventManager().registerSubscriber({
      beforeFlush: () => {
        if (!failNextFlush) return
        failNextFlush = false
        throw new Error('[internal] Simulated persistence failure')
      },
    })
    await expect(verify(service, challengeId, userId, currentCode())).rejects.toThrow('Simulated persistence failure')
    expect(verifySpy).toHaveBeenCalledTimes(1)
    expect((await manager().findOneOrFail(UserMfaMethod, { id: methodId })).providerMetadata).toEqual({})
    expect((await manager().findOneOrFail(MfaChallenge, { id: challengeId })).verifiedAt).toBeNull()
    expect(emitSecurityEvent).not.toHaveBeenCalled()
    expect(await verify(createService(), challengeId, userId, currentCode())).toBe(true)
  })
})
