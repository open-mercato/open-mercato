/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { DomainMapping } from '../../data/entities'
import { domainOwnershipRecord } from '../../lib/domainMappingLifecycle'
import { Migration20260430120000_customer_accounts } from '../../migrations/Migration20260430120000_customer_accounts'
import { Migration20261119031934_customer_accounts } from '../../migrations/Migration20261119031934_customer_accounts'
import { DomainMappingRegistrationConflict, DomainMappingService, DomainMappingUnavailableError } from '../domainMappingService'

jest.mock('../../events', () => ({ emitCustomerAccountsEvent: jest.fn(async () => undefined) }))

const databaseUrl = process.env.OM_DOMAIN_MAPPING_TEST_DATABASE_URL
const describeWithPostgres = databaseUrl || process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('custom domain lifecycle on PostgreSQL', () => {
  const schema = `om_domains_${randomUUID().replaceAll('-', '')}`
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const otherScope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const previousTarget = process.env.CUSTOM_DOMAIN_CNAME_TARGET
  const routingTarget = 'edge.example.test'
  let container: StartedTestContainer | undefined
  let orm: Awaited<ReturnType<typeof MikroORM.init>> | undefined

  function database() {
    if (!orm) throw new Error('[internal] Domain mapping test database is unavailable')
    return orm.em.fork()
  }

  beforeAll(async () => {
    let clientUrl = databaseUrl
    if (!clientUrl) {
      const { GenericContainer, Wait } = await import('testcontainers')
      container = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .start()
      clientUrl = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/test`
    }
    process.env.CUSTOM_DOMAIN_CNAME_TARGET = routingTarget
    orm = await MikroORM.init({
      clientUrl,
      entities: [DomainMapping],
      schema,
      driverOptions: { options: `-c search_path=${schema}` },
    })
    const em = database()
    await em.execute(`create schema "${schema}"`)
    await em.execute('create table organizations (id uuid not null, tenant_id uuid not null, slug text, deleted_at timestamptz)')
    for (const org of [scope, otherScope]) {
      await em.execute('insert into organizations (id, tenant_id) values (?, ?)', [org.organizationId, org.tenantId])
    }
    const initial = new Migration20260430120000_customer_accounts(orm.em.getDriver(), orm.config)
    await initial.up()
    for (const query of initial.getQueries()) await em.execute(query)
    for (const [status, hostname] of [['verified', 'verified.example.test'], ['tls_failed', 'tls.example.test'], ['active', 'active.example.test']]) {
      await em.execute(`insert into domain_mappings (hostname, tenant_id, organization_id, status, verified_at)
        values (?, ?, ?, ?, now())`, [hostname, scope.tenantId, scope.organizationId, status])
    }
    await em.execute(`insert into domain_mappings (hostname, tenant_id, organization_id, status, verified_at, created_at)
      values (?, ?, ?, 'active', now(), now() - interval '3 days')`,
      ['expired-active.example.test', scope.tenantId, scope.organizationId])
    const upgrade = new Migration20261119031934_customer_accounts(orm.em.getDriver(), orm.config)
    await upgrade.up()
    for (const query of upgrade.getQueries()) await em.execute(query)
  }, 120_000)

  afterAll(async () => {
    if (previousTarget === undefined) delete process.env.CUSTOM_DOMAIN_CNAME_TARGET
    else process.env.CUSTOM_DOMAIN_CNAME_TARGET = previousTarget
    try {
      if (orm) await database().execute(`drop schema if exists "${schema}" cascade`)
    } finally {
      await orm?.close(true)
      await container?.stop()
    }
  })

  afterEach(async () => {
    await database().nativeDelete(DomainMapping, {})
  })

  it('gates all legacy TLS and active mappings on fresh ownership proof', async () => {
    const service = new DomainMappingService(database())
    expect(await service.findPendingTls()).toEqual([])
    expect(await service.isAllowedForTls('verified.example.test')).toBeNull()
    expect(await service.isAllowedForTls('tls.example.test')).toBeNull()
    expect(await service.isAllowedForTls('active.example.test')).toBeNull()
    expect(await service.resolveByHostname('active.example.test')).toBeNull()
    expect(await service.resolveByHostname('expired-active.example.test')).toBeNull()
    expect(await service.resolveActiveByOrg(scope.organizationId)).toBeNull()
    expect(await service.resolveAll()).toEqual([])
    const expired = await database().findOneOrFail(DomainMapping, { hostname: 'expired-active.example.test' })
    expect(expired).toMatchObject({ status: 'pending', verifiedAt: null })
    await expect(service.verify(expired.id)).rejects.toBeInstanceOf(DomainMappingUnavailableError)
    const legacy = await database().findOneOrFail(DomainMapping, { hostname: 'active.example.test' })
    let ownershipTxt: string[][] = []
    const verifying = new DomainMappingService(database(), {
      dnsResolver: {
        resolveTxt: async () => ownershipTxt,
        resolveCname: async () => [routingTarget],
        resolve4: async () => [],
      },
    })
    expect((await verifying.verify(legacy.id)).domainMapping.status).toBe('dns_failed')
    expect(await verifying.isAllowedForTls(legacy.hostname)).toBeNull()
    ownershipTxt = [[domainOwnershipRecord(legacy).value]]
    expect((await verifying.verify(legacy.id)).domainMapping.status).toBe('verified')
    await verifying.activate(legacy.id)
    expect(await verifying.isAllowedForTls(legacy.hostname)).toMatchObject({ status: 'active' })
    expect(await verifying.resolveActiveByOrg(scope.organizationId)).toMatchObject({ hostname: legacy.hostname })
  })

  it('preserves the complete newer DNS record when a second manager submits stale removal', async () => {
    const mapping = await new DomainMappingService(database()).register({ ...scope, hostname: 'stale-remove.example.test' })
    const previousUpdatedAt = new Date('2026-11-20T00:00:00.000Z')
    await database().nativeUpdate(DomainMapping, { id: mapping.id }, { updatedAt: previousUpdatedAt })
    const expectedUpdatedAt = previousUpdatedAt.toISOString()
    const currentUpdatedAt = new Date(previousUpdatedAt.getTime() + 1000)
    await database().nativeUpdate(DomainMapping, { id: mapping.id }, {
      status: 'dns_failed', dnsFailureReason: 'newer-state', lastDnsCheckAt: currentUpdatedAt, updatedAt: currentUpdatedAt,
    })
    const before = await database().execute('select * from domain_mappings where id = ?', [mapping.id])

    await expect(new DomainMappingService(database()).remove(mapping.id, {
      tenantId: scope.tenantId, expectedUpdatedAt,
    })).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })

    expect(await database().execute('select * from domain_mappings where id = ?', [mapping.id])).toEqual(before)
    await new DomainMappingService(database()).remove(mapping.id, {
      tenantId: scope.tenantId, expectedUpdatedAt: currentUpdatedAt.toISOString(),
    })
    expect(await database().findOne(DomainMapping, { id: mapping.id, deletedAt: null })).toBeNull()
  })

  it('enforces the organization limit across concurrent registrations on separate managers', async () => {
    const attempts = await Promise.allSettled(['first', 'second', 'third'].map((label) =>
      new DomainMappingService(database()).register({ ...scope, hostname: `${label}.example.test` }),
    ))
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(2)
    expect(attempts).toContainEqual({ status: 'rejected', reason: expect.any(DomainMappingRegistrationConflict) })
  })

  it('excludes expired mappings from work and quota and releases their hostname for a fresh registration', async () => {
    const service = new DomainMappingService(database())
    const expired = await service.register({ ...scope, hostname: 'expired.example.test' })
    await database().nativeUpdate(DomainMapping, { id: expired.id }, { createdAt: new Date(0) })

    const freshService = new DomainMappingService(database())
    expect(await freshService.findById(expired.id, scope)).toBeNull()
    expect(await freshService.findPendingVerification()).toEqual([])
    const replacement = await freshService.register({ ...otherScope, hostname: expired.hostname })
    expect(replacement.id).not.toEqual(expired.id)
    expect(await database().findOne(DomainMapping, { id: expired.id })).toBeNull()
  })

  it('preserves a reservation for a replaced hostname and excludes it from TLS and routing', async () => {
    const service = new DomainMappingService(database())
    const previous = await service.register({ ...scope, hostname: 'previous.example.test' })
    const replacement = await service.register({
      ...scope, hostname: 'replacement.example.test', replacesDomainId: previous.id,
    })
    await database().nativeUpdate(DomainMapping, { id: previous.id }, { status: 'active', verifiedAt: new Date() })
    const verifying = new DomainMappingService(database(), {
      dnsResolver: {
        resolveTxt: async () => [[domainOwnershipRecord(replacement).value]],
        resolveCname: async () => [routingTarget],
        resolve4: async () => [],
      },
    })
    expect((await verifying.verify(replacement.id)).domainMapping.status).toBe('verified')
    await verifying.activate(replacement.id)

    expect(await verifying.resolveByHostname(previous.hostname)).toBeNull()
    expect(await verifying.resolveActiveByOrg(scope.organizationId)).toMatchObject({ hostname: replacement.hostname })
    expect(await verifying.isAllowedForTls(previous.hostname)).toBeNull()
    const released = await database().findOneOrFail(DomainMapping, { id: previous.id })
    expect(released).toMatchObject({ deletedAt: expect.any(Date), reservedUntil: expect.any(Date) })
    await expect(new DomainMappingService(database()).register({ ...otherScope, hostname: previous.hostname }))
      .rejects.toBeInstanceOf(DomainMappingRegistrationConflict)
    await database().nativeUpdate(DomainMapping, { id: previous.id }, { reservedUntil: new Date(0) })
    await verifying.pruneExpiredMappings()
    expect(await database().findOne(DomainMapping, { id: previous.id })).toBeNull()
  })
  it('rolls back lifecycle columns without restoring unproven active routes', async () => {
    const service = new DomainMappingService(database())
    const mapping = await service.register({ ...scope, hostname: 'rollback.example.test' })
    const downgrade = new Migration20261119031934_customer_accounts(orm!.em.getDriver(), orm!.config)
    await downgrade.down()
    for (const query of downgrade.getQueries()) await database().execute(query)
    const rows = await database().execute<Array<{ status: string; verified_at: Date | null }>>(
      'select status, verified_at from domain_mappings where id = ?', [mapping.id],
    )
    expect(rows).toEqual([{ status: 'pending', verified_at: null }])
    const columns = await database().execute<Array<{ column_name: string }>>(
      'select column_name from information_schema.columns where table_schema = ? and table_name = ?',
      [schema, 'domain_mappings'],
    )
    expect(columns.map(({ column_name: columnName }) => columnName)).not.toContain('deleted_at')
    expect(columns.map(({ column_name: columnName }) => columnName)).not.toContain('reserved_until')
  })

})
