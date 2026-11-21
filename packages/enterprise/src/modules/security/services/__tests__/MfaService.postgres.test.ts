import { randomUUID } from 'node:crypto'
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql'
import { hash } from 'bcryptjs'
import type { StartedTestContainer } from 'testcontainers'
import { z } from 'zod'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { MfaRecoveryCode, UserMfaMethod } from '../../data/entities'
import { emitSecurityEvent } from '../../events'
import { MfaProviderRegistry } from '../../lib/mfa-provider-registry'
import { Migration20261107120000_mfa_secret_encryption } from '../../migrations/Migration20261107120000_mfa_secret_encryption'
import { MfaService } from '../MfaService'
import { POST as recover } from '../../api/mfa/recovery/route'
import { PUT as confirm } from '../../api/mfa/provider/[providername]/route'
import { issueVerifiedMfaToken, resolveMfaRequestContext } from '../../api/mfa/_shared'

jest.mock('../../events', () => ({ emitSecurityEvent: jest.fn().mockResolvedValue(undefined) }))

jest.mock('../../api/mfa/_shared', () => ({
  ...jest.requireActual('../../api/mfa/_shared'),
  resolveMfaRequestContext: jest.fn(),
  authorizeMfaEnrollmentMutation: jest.fn(async () => null),
  issueVerifiedMfaToken: jest.fn(() => 'test-verified-token'),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string, parameters?: Record<string, string>) =>
      fallback.replace(/\{(\w+)\}/g, (match, key: string) => parameters?.[key] ?? match),
  })),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip
const emitted = jest.mocked(emitSecurityEvent)

describeWithPostgres('MfaService concurrent mutations on PostgreSQL', () => {
  let postgres: StartedTestContainer
  let orm: Awaited<ReturnType<typeof MikroORM.init<PostgreSqlDriver>>>
  let codeHash: string
  let userId: string
  let tenantId: string
  let organizationId: string
  let schemaCreated = false
  const applicationName = `mfa-race-${randomUUID()}`

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:17-alpine')
      .withEnvironment({ POSTGRES_USER: 'mfa_test', POSTGRES_PASSWORD: 'mfa_test', POSTGRES_DB: 'mfa_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .withStartupTimeout(60_000)
      .start()
    orm = await MikroORM.init({
      entities: [User, MfaRecoveryCode, UserMfaMethod],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      user: 'mfa_test',
      password: 'mfa_test',
      dbName: 'mfa_test',
      driverOptions: { application_name: applicationName, statement_timeout: 15_000 },
      pool: { max: 10 },
    })
    await orm.schema.create()
    schemaCreated = true
    codeHash = await hash('ABCDE12345', 10)
  }, 90_000)

  beforeEach(async () => {
    userId = randomUUID()
    tenantId = randomUUID()
    organizationId = randomUUID()
    const em = orm.em.fork()
    em.persist(em.create(User, {
      id: userId,
      tenantId,
      organizationId,
      email: `${userId}@example.test`,
      isConfirmed: true,
      createdAt: new Date(),
    }))
    await em.flush()
    emitted.mockReset().mockResolvedValue(undefined)
    jest.mocked(issueVerifiedMfaToken).mockClear()
  })

  afterEach(async () => {
    if (!schemaCreated) return
    await orm.em.fork().nativeDelete(MfaRecoveryCode, { userId })
    await orm.em.fork().nativeDelete(UserMfaMethod, { userId })
    await orm.em.fork().nativeDelete(User, { id: userId })
  })

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  function service(em = orm.em.fork(), allowMultiple = false, label?: string) {
    const registry = new MfaProviderRegistry()
    registry.register({
      type: 'totp', label: 'Test authenticator', icon: 'Smartphone', allowMultiple,
      setupSchema: z.unknown(), verifySchema: z.unknown(),
      setup: async () => ({ setupId: randomUUID(), clientData: {} }),
      confirmSetup: async () => ({ secret: 'confirmed-secret', metadata: label ? { label } : {} }),
      prepareChallenge: async () => ({}), verify: async () => true,
    })
    return new MfaService(em, registry)
  }

  async function pending(setupId: string, label?: string) {
    const em = orm.em.fork()
    const method = em.create(UserMfaMethod, {
      userId, tenantId, organizationId, type: 'totp', secret: setupId, label, isActive: false,
      createdAt: new Date(), updatedAt: new Date(),
    })
    em.persist(method)
    await em.flush()
    return method
  }

  async function waitForBlockedRequests(count: number) {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const rows = await orm.em.fork().execute<Array<{ count: number }>>(
        "select count(*)::int as count from pg_stat_activity where application_name = ? and wait_event_type = 'Lock'",
        [applicationName],
      )
      if (rows[0].count >= count) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('[internal] concurrent requests did not reach PostgreSQL lock barrier')
  }

  async function race<T>(table: 'mfa_recovery_codes' | 'user_mfa_methods', requests: Array<() => Promise<T>>) {
    const blocker = orm.em.fork()
    await blocker.begin()
    await blocker.execute(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`)
    const results = Promise.allSettled(requests.map((request) => request()))
    try {
      await waitForBlockedRequests(requests.length)
    } catch (error) {
      await blocker.rollback()
      await results
      throw error
    }
    await blocker.rollback()
    return results
  }

  test('MFA migration adds the pending setup lookup hash to an existing active map', async () => {
    await orm.em.fork().transactional(async (em) => {
      await em.execute('create temporary table user_mfa_methods (id uuid primary key) on commit drop')
      await em.execute(`create temporary table encryption_maps (
        id uuid primary key, entity_id text, tenant_id uuid, organization_id uuid, fields_json jsonb,
        is_active boolean, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz
      ) on commit drop`)
      const disabledTenantId = randomUUID()
      const customHashTenantId = randomUUID()
      const customFields = [{ field: 'secret', custom: true }, { field: 'label' }]
      const customHashFields = [{ field: 'secret', hashField: 'custom_hash' }, { field: 'label' }]
      const fixtures = [
        { mapTenantId: tenantId, enabled: true, fields: customFields },
        { mapTenantId: disabledTenantId, enabled: false, fields: customFields },
        { mapTenantId: customHashTenantId, enabled: true, fields: customHashFields },
      ]
      for (const { mapTenantId, enabled, fields } of fixtures) {
        await em.execute(`insert into encryption_maps (id, entity_id, tenant_id, fields_json, is_active)
          values (gen_random_uuid(), 'security:user_mfa_method', ?, ?::jsonb, ?)`,
        [mapTenantId, JSON.stringify(fields), enabled])
      }

      const statements: string[] = []
      const migration = new Migration20261107120000_mfa_secret_encryption({} as never, {} as never)
      jest.spyOn(migration, 'addSql').mockImplementation((sql) => { statements.push(String(sql)) })
      migration.up()
      for (const statement of statements) {
        await em.execute(statement)
      }

      const rows = await em.execute<Array<{ tenant_id: string; fields_json: unknown }>>(
        'select tenant_id, fields_json from encryption_maps',
      )
      expect(rows.find((row) => row.tenant_id === tenantId)?.fields_json).toEqual([
        { field: 'secret', custom: true, hashField: 'secret_hash' },
        { field: 'label' },
        { field: 'provider_metadata' },
      ])
      expect(rows.find((row) => row.tenant_id === disabledTenantId)?.fields_json).toEqual([
        ...customFields,
        { field: 'provider_metadata' },
      ])
      expect(rows.find((row) => row.tenant_id === customHashTenantId)?.fields_json).toEqual([
        ...customHashFields,
        { field: 'provider_metadata' },
      ])
    })
  })

  test('one recovery code succeeds once across four separate connections and emits once after commit', async () => {
    const em = orm.em.fork()
    em.persist(em.create(MfaRecoveryCode, { userId, tenantId, codeHash, isUsed: false, createdAt: new Date() }))
    em.persist(em.create(MfaRecoveryCode, { userId, tenantId, codeHash: await hash('OTHER12345', 10), isUsed: false, createdAt: new Date() }))
    await em.flush()
    emitted.mockImplementationOnce(async () => {
      expect(await orm.em.fork().count(MfaRecoveryCode, { userId, isUsed: true })).toBe(1)
    })
    const results = await race('mfa_recovery_codes', Array.from({ length: 4 }, () => {
      const verifier = service()
      return () => verifier.verifyRecoveryCode(userId, 'abcde-12345')
    }))

    expect(results.filter((result) => result.status === 'fulfilled' && result.value)).toHaveLength(1)
    expect(results.filter((result) => result.status === 'fulfilled' && !result.value)).toHaveLength(3)
    expect(await orm.em.fork().count(MfaRecoveryCode, { userId, isUsed: true })).toBe(1)
    expect(emitted).toHaveBeenCalledTimes(1)
    expect(emitted).toHaveBeenCalledWith('security.recovery.used', { userId, remaining: 1 })
    expect(await service().verifyRecoveryCode(randomUUID(), 'ABCDE12345')).toBe(false)
  })

  test.each([
    { sameSetup: false, allowMultiple: false, label: undefined, statusCode: 409, message: "MFA provider 'totp' is already configured" },
    { sameSetup: true, allowMultiple: false, label: undefined, statusCode: 404, message: 'MFA setup session not found' },
    { sameSetup: false, allowMultiple: true, label: 'Phone', statusCode: 409, message: 'An MFA method with this name already exists' },
  ])('parallel confirmation preserves invariants: $sameSetup / $allowMultiple', async ({ sameSetup, allowMultiple, label, statusCode, message }) => {
    const setupIds = [randomUUID(), randomUUID()]
    await pending(setupIds[0])
    if (!sameSetup) await pending(setupIds[1])
    const requests = await Promise.all(setupIds.map(async (setupId) => {
      const em = orm.em.fork()
      await em.find(UserMfaMethod, { userId })
      const enrollment = service(em, allowMultiple, label)
      return () => enrollment.confirmMethod(userId, sameSetup ? setupIds[0] : setupId, {}, 'totp')
    }))
    emitted.mockImplementationOnce(async () => {
      expect(await orm.em.fork().count(UserMfaMethod, { userId, isActive: true })).toBe(1)
    })

    const results = await race('user_mfa_methods', requests)

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { statusCode, message } })
    expect(await orm.em.fork().count(UserMfaMethod, { userId, isActive: true })).toBe(1)
    expect(emitted).toHaveBeenCalledTimes(1)
    expect(emitted).toHaveBeenCalledWith('security.mfa.enrolled', expect.objectContaining({ userId, tenantId, methodType: 'totp' }))
  })

  test('multi-instance providers can confirm distinct labels concurrently', async () => {
    const setupIds = [randomUUID(), randomUUID()]
    await Promise.all(setupIds.map((setupId) => pending(setupId)))
    const results = await race('user_mfa_methods', setupIds.map((setupId, index) => {
      const enrollment = service(orm.em.fork(), true, `Device ${index}`)
      return () => enrollment.confirmMethod(userId, setupId, {})
    }))

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(await orm.em.fork().count(UserMfaMethod, { userId, isActive: true })).toBe(2)
    expect(emitted).toHaveBeenCalledTimes(2)
  })

  test('a pending method outside the account organization cannot be confirmed', async () => {
    const setupId = randomUUID()
    const method = await pending(setupId)
    const em = orm.em.fork()
    await em.nativeUpdate(UserMfaMethod, { id: method.id }, { organizationId: randomUUID() })

    await expect(service().confirmMethod(userId, setupId, {})).rejects.toMatchObject({ statusCode: 404 })
    expect(await em.count(UserMfaMethod, { id: method.id, isActive: false })).toBe(1)
    expect(emitted).not.toHaveBeenCalled()
  })

  function routeContext() {
    const mfaService = service()
    return {
      auth: { sub: userId, tenantId, orgId: organizationId, mfa_pending: true },
      mfaService,
      mfaVerificationService: { verifyRecoveryCode: mfaService.verifyRecoveryCode.bind(mfaService) },
    } as unknown as Awaited<ReturnType<typeof resolveMfaRequestContext>>
  }

  test('recovery POST returns one 200 and three 401 responses for a concurrent code replay', async () => {
    const em = orm.em.fork()
    em.persist(em.create(MfaRecoveryCode, { userId, tenantId, codeHash, isUsed: false, createdAt: new Date() }))
    await em.flush()
    jest.mocked(resolveMfaRequestContext).mockImplementation(async () => routeContext())

    const results = await race('mfa_recovery_codes', Array.from({ length: 4 }, () => () => recover(
      new Request('https://example.test/api/security/mfa/recovery', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'ABCDE12345' }),
      }),
    )))
    const responses = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401, 401, 401])
    for (const response of responses.filter((response) => response.status === 401)) {
      expect(await response.json()).toEqual({ error: 'Invalid recovery code.' })
    }
    expect(issueVerifiedMfaToken).toHaveBeenCalledTimes(1)
    expect(emitted).toHaveBeenCalledTimes(1)
  })

  test.each([false, true])('provider PUT retains the existing conflict response (same setup: %s)', async (sameSetup) => {
    const setupIds = [randomUUID(), randomUUID()]
    await pending(setupIds[0])
    if (!sameSetup) await pending(setupIds[1])
    jest.mocked(resolveMfaRequestContext).mockImplementation(async () => routeContext())

    const results = await race('user_mfa_methods', setupIds.map((setupId) => () => confirm(
      new Request('https://example.test/api/security/mfa/provider/totp', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ setupId: sameSetup ? setupIds[0] : setupId, payload: {} }),
      }),
      { params: Promise.resolve({ providername: 'totp' }) },
    )))
    const responses = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])

    expect(responses.map((response) => response.status).sort()).toEqual([200, sameSetup ? 404 : 409])
    const rejected = responses.find((response) => response.status !== 200)
    expect(await rejected?.json()).toEqual({
      error: sameSetup ? 'MFA setup session not found.' : 'MFA provider "totp" is already configured.',
    })
    expect(await orm.em.fork().count(UserMfaMethod, { userId, isActive: true })).toBe(1)
    expect(emitted).toHaveBeenCalledTimes(1)
  })

  test('confirmation refreshes the pending method after waiting for the per-user lock', async () => {
    const setupId = randomUUID()
    const method = await pending(setupId, 'Before')
    const waitingEm = orm.em.fork()
    await waitingEm.findOneOrFail(UserMfaMethod, { id: method.id })
    const blocker = orm.em.fork()
    await blocker.begin()
    await blocker.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [`security:mfa:enrollment:${userId}`])
    const result = service(waitingEm).confirmMethod(userId, setupId, {})
    try {
      await waitForBlockedRequests(1)
      await blocker.nativeUpdate(UserMfaMethod, { id: method.id }, { label: 'Committed label' })
      await blocker.commit()
      await result
    } finally {
      if (blocker.isInTransaction()) await blocker.rollback()
      await Promise.allSettled([result])
    }

    expect(await orm.em.fork().findOneOrFail(UserMfaMethod, { id: method.id })).toMatchObject({ isActive: true, label: 'Committed label' })
  })
})
