import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { TenantDataEncryptionService } from '../tenantDataEncryptionService'
import { runInOwnedRequestScope } from '../../di/request-scope'

const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describePostgres('encryption policy request memo with PostgreSQL transactions (#10675)', () => {
  const originalEncryptionToggle = process.env.TENANT_DATA_ENCRYPTION
  const originalPolicyMemoMaxAge = process.env.OM_ENCRYPTION_POLICY_REQUEST_MEMO_MS
  const entityId = `test:transaction_${randomUUID().replaceAll('-', '')}`
  const tenantId = randomUUID()
  const organizationId = randomUUID()
  let postgres: StartedTestContainer | undefined
  let orm: Awaited<ReturnType<typeof MikroORM.init>> | undefined

  function service(em: NonNullable<typeof orm>['em']) {
    return new TenantDataEncryptionService(em as never, {
      kms: {
        getTenantDek: async () => null,
        createTenantDek: async () => null,
        isHealthy: () => true,
      },
    })
  }

  async function readFields(em: NonNullable<typeof orm>['em']): Promise<string[]> {
    return service(em.fork({ clear: true, disableContextResolution: true }))
      .getEncryptedFieldNames(entityId, tenantId, organizationId)
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'encryption_policy_test', POSTGRES_PASSWORD: 'test' })
      .withLabels({ 'open-mercato.test': 'encryption-policy-transaction' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'encryption_policy_test',
      user: 'postgres',
      password: 'test',
      entities: [],
    })
    await orm.em.getConnection().execute(`
      create table encryption_maps (
        id uuid primary key,
        entity_id text not null,
        tenant_id uuid,
        organization_id uuid,
        fields_json jsonb not null,
        is_active boolean not null default true,
        deleted_at timestamptz,
        created_at timestamptz not null default now()
      )
    `)
    await orm.em.getConnection().execute(
      `insert into encryption_maps (id, entity_id, tenant_id, organization_id, fields_json)
       values (?, ?, ?, ?, ?::jsonb)`,
      [randomUUID(), entityId, tenantId, organizationId, JSON.stringify([{ field: 'committed' }])],
    )
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.OM_ENCRYPTION_POLICY_REQUEST_MEMO_MS = '5000'
  }, 120_000)

  afterAll(async () => {
    if (originalEncryptionToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalEncryptionToggle
    if (originalPolicyMemoMaxAge === undefined) delete process.env.OM_ENCRYPTION_POLICY_REQUEST_MEMO_MS
    else process.env.OM_ENCRYPTION_POLICY_REQUEST_MEMO_MS = originalPolicyMemoMaxAge
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  it('keeps an uncommitted policy inside its transaction and exposes it after commit', async () => {
    if (!orm) throw new Error('[internal] PostgreSQL ORM was not initialized')
    const rootEm = orm.em.fork({ clear: true, disableContextResolution: true })
    const pendingFields = JSON.stringify([{ field: 'uncommitted' }])

    await runInOwnedRequestScope(async () => {
      await expect(readFields(rootEm)).resolves.toEqual(['committed'])
      let rollbackObserved: string[] = []
      await expect(rootEm.transactional(async (transactionEm) => {
        await transactionEm.execute('update encryption_maps set fields_json = ?::jsonb where entity_id = ?', [pendingFields, entityId])
        rollbackObserved = await service(transactionEm).getEncryptedFieldNames(entityId, tenantId, organizationId)
        await expect(readFields(rootEm)).resolves.toEqual(['committed'])
        throw new Error('rollback test transaction')
      })).rejects.toThrow('rollback test transaction')
      expect(rollbackObserved).toEqual(['uncommitted'])
      await expect(readFields(rootEm)).resolves.toEqual(['committed'])
    })

    await runInOwnedRequestScope(async () => {
      await expect(readFields(rootEm)).resolves.toEqual(['committed'])
      await rootEm.transactional(async (transactionEm) => {
        await transactionEm.execute('update encryption_maps set fields_json = ?::jsonb where entity_id = ?', [pendingFields, entityId])
        await expect(service(transactionEm).getEncryptedFieldNames(entityId, tenantId, organizationId))
          .resolves.toEqual(['uncommitted'])
        await expect(readFields(rootEm)).resolves.toEqual(['committed'])
      })
    })

    await runInOwnedRequestScope(async () => {
      await expect(readFields(rootEm)).resolves.toEqual(['uncommitted'])
    })
  }, 30_000)
})
