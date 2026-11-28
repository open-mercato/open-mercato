/** @jest-environment node */
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import {
  DIRECTORY_ORGANIZATION_ENTITY_TYPE,
  loadQueryIndexRowScope,
  QueryIndexScopeError,
  resolveQueryIndexRecordScope,
  resolveQueryIndexSourceMetadata,
} from '../lib/subscriber-scope'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('organization index scope against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: Awaited<ReturnType<typeof MikroORM.init>>

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'scope_test', POSTGRES_USER: 'scope_test', POSTGRES_PASSWORD: 'scope_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'scope_test',
      user: 'scope_test',
      password: 'scope_test',
      entities: [Organization, Tenant],
    })
    await orm.schema.create()
    registerEntityIds({ directory: { organization: DIRECTORY_ORGANIZATION_ENTITY_TYPE } })
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
      registerEntityIds({})
    }
  })

  it('derives scope from the real organization mapping and rejects a different tenant', async () => {
    const em = orm.em.fork()
    const tenant = em.create(Tenant, { name: 'Index scope tenant' })
    const otherTenant = em.create(Tenant, { name: 'Other tenant' })
    const organization = em.create(Organization, { name: 'Index scope organization', tenant })
    await em.flush()

    const source = resolveQueryIndexSourceMetadata(em, DIRECTORY_ORGANIZATION_ENTITY_TYPE)
    const sourceScope = await loadQueryIndexRowScope(em, source, organization.id)
    const scopeInput = {
      sourceScope,
      payloadOrganizationId: organization.id,
      hasPayloadOrganizationId: true,
      hasPayloadTenantId: true,
    }
    expect(resolveQueryIndexRecordScope({ ...scopeInput, payloadTenantId: tenant.id })).toEqual({
      tenantId: tenant.id,
      organizationId: organization.id,
    })
    expect(() => resolveQueryIndexRecordScope({ ...scopeInput, payloadTenantId: otherTenant.id }))
      .toThrow(QueryIndexScopeError)
  })
})
