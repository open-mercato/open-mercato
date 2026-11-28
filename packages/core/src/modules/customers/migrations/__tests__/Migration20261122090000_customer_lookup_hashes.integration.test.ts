import { randomUUID } from 'node:crypto'
import { MigrationRunner } from '@mikro-orm/migrations'
import { MikroORM, type EntityManager, type PostgreSqlDriver } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { UpgradeActionRun } from '@open-mercato/core/modules/configs/data/entities'
import { EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import { encryptWithAesGcm, generateDek, hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { getEntityIds, registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import * as customerEntities from '../../data/entities'
import { findCompaniesByDomains } from '../../lib/findCompaniesByDomains'
import { findPeopleByAddresses } from '../../lib/findPeopleByAddresses'
import { Migration20261122090000_customer_lookup_hashes } from '../Migration20261122090000_customer_lookup_hashes'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip
const personEntityId = 'customers:customer_entity'
const companyEntityId = 'customers:customer_company_profile'
const lookupAction = 'customers.seed-email-domain-hash-encryption-map'
const mockTenantKeys = new Map<string, string>()

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/kms'),
  createKmsService: () => ({
    isHealthy: () => true,
    getTenantDek: async (tenantId: string) => {
      const key = mockTenantKeys.get(tenantId)
      return key ? { tenantId, key, fetchedAt: Date.now() } : null
    },
  }),
}))

type Scope = { organizationId: string; tenantId: string }
type FieldRule = { field: string; hashField?: string }
type LookupColumn = { table_name: string; column_name: string; is_nullable: string; data_type: string }
type LookupIndex = { name: string; unique: boolean; columns: string[] }

async function seedMap(em: EntityManager, entityId: string, scope: Scope, fields: FieldRule[]): Promise<string> {
  const id = randomUUID()
  await em.execute(
    'insert into encryption_maps (id, entity_id, organization_id, tenant_id, fields_json, created_at, updated_at) values (?, ?, ?, ?, ?::jsonb, now(), now())',
    [id, entityId, scope.organizationId, scope.tenantId, JSON.stringify(fields)],
  )
  return id
}

describeWithPostgres('customer lookup hash migration and scoped reads against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver>
  const originalEntityIds = getEntityIds(false)

  beforeAll(async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env, TENANT_DATA_ENCRYPTION: 'yes', LOOKUP_HASH_PEPPER: randomUUID(),
    })
    registerEntityIds({ customers: { customer_entity: personEntityId, customer_company_profile: companyEntityId } })
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'customer_lookup_test', POSTGRES_USER: 'customer_lookup_test', POSTGRES_PASSWORD: 'customer_lookup_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init({
      entities: [...Object.values(customerEntities), EncryptionMap, UpgradeActionRun],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'customer_lookup_test',
      user: 'customer_lookup_test',
      password: 'customer_lookup_test',
    })
  }, 120_000)

  beforeEach(async () => {
    await orm.schema.refresh()
    const em = orm.em.fork()
    await em.execute('alter table customer_entities drop column primary_email_hash')
    await em.execute('alter table customer_companies drop column domain_hash')
  })

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
      mockTenantKeys.clear()
      registerEntityIds(originalEntityIds)
      jest.restoreAllMocks()
    }
  })

  async function migrate(direction: 'up' | 'down'): Promise<void> {
    const driver = orm.em.getDriver()
    const runner = new MigrationRunner(driver, { transactional: true }, orm.config)
    await runner.run(new Migration20261122090000_customer_lookup_hashes(driver, orm.config), direction)
  }

  async function readColumns(em: EntityManager): Promise<LookupColumn[]> {
    return em.execute<LookupColumn[]>(
      `select table_name, column_name, is_nullable, data_type
         from information_schema.columns
        where table_schema = current_schema()
          and (table_name, column_name) in (('customer_entities', 'primary_email_hash'), ('customer_companies', 'domain_hash'))
        order by table_name`,
    )
  }

  async function readIndexes(em: EntityManager): Promise<LookupIndex[]> {
    return em.execute<LookupIndex[]>(
      `select index_class.relname as name, idx.indisunique as "unique",
              array(select pg_get_indexdef(idx.indexrelid, key_position, true)
                      from generate_series(1, idx.indnkeyatts) as key_position
                      order by key_position) as columns
         from pg_index idx
         join pg_class index_class on index_class.oid = idx.indexrelid
         join pg_namespace index_schema on index_schema.oid = index_class.relnamespace
        where index_schema.nspname = current_schema()
          and index_class.relname in ('customer_entities_primary_email_hash_idx', 'customer_companies_domain_hash_idx')
        order by index_class.relname`,
    )
  }

  it('upgrades existing rows, rolls back only the managed state and reapplies cleanly', async () => {
    const em = orm.em.fork()
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const personId = randomUUID()
    const companyId = randomUUID()
    const profileId = randomUUID()
    const personEmail = 'existing@example.test'
    const companyDomain = 'existing.example.test'

    await em.execute(
      `insert into customer_entities (id, tenant_id, organization_id, kind, display_name, primary_email, created_at, updated_at)
       values (?, ?, ?, 'person', 'Existing person', ?, now(), now()), (?, ?, ?, 'company', 'Existing company', null, now(), now())`,
      [personId, scope.tenantId, scope.organizationId, personEmail, companyId, scope.tenantId, scope.organizationId],
    )
    await em.execute(
      `insert into customer_companies (id, tenant_id, organization_id, entity_id, domain, created_at, updated_at)
       values (?, ?, ?, ?, ?, now(), now())`,
      [profileId, scope.tenantId, scope.organizationId, companyId, companyDomain],
    )
    const readCustomers = async () => ({
      entities: await em.execute('select id, kind, display_name, primary_email from customer_entities order by kind'),
      companies: await em.execute('select id, entity_id, domain from customer_companies'),
    })
    const beforeCustomers = await readCustomers()
    const expectPhysicalSchema = async () => {
      expect(await readColumns(em)).toEqual([
        { table_name: 'customer_companies', column_name: 'domain_hash', is_nullable: 'YES', data_type: 'text' },
        { table_name: 'customer_entities', column_name: 'primary_email_hash', is_nullable: 'YES', data_type: 'text' },
      ])
      expect(await readIndexes(em)).toEqual([
        { name: 'customer_companies_domain_hash_idx', unique: false, columns: ['tenant_id', 'organization_id', 'domain_hash'] },
        { name: 'customer_entities_primary_email_hash_idx', unique: false, columns: ['tenant_id', 'organization_id', 'primary_email_hash'] },
      ])
      expect(await readCustomers()).toEqual(beforeCustomers)
      expect(await em.execute('select distinct primary_email_hash from customer_entities')).toEqual([{ primary_email_hash: null }])
      expect(await em.execute('select domain_hash from customer_companies')).toEqual([{ domain_hash: null }])
    }

    expect(await readColumns(em)).toEqual([])
    expect(await readIndexes(em)).toEqual([])
    await migrate('up')
    await expectPhysicalSchema()

    const unrelatedRule = { field: 'notes', hashField: 'notes_hash' }
    const personMapId = await seedMap(em, personEntityId, scope, [{ field: 'primary_email', hashField: 'primaryEmailHash' }, unrelatedRule])
    const companyMapId = await seedMap(em, companyEntityId, scope, [{ field: 'domain', hashField: 'domain_hash' }, unrelatedRule])
    const unrelatedFields = [{ field: 'email', hashField: 'primary_email_hash' }]
    const unrelatedMapId = await seedMap(em, 'unrelated:entity', scope, unrelatedFields)
    const otherAction = 'customers.unrelated-upgrade'
    await em.execute(
      `insert into upgrade_action_runs (id, version, action_id, tenant_id, organization_id, created_at, completed_at)
       values (?, '1', ?, ?, ?, now(), now()), (?, '1', ?, ?, ?, now(), now()), (?, '1', ?, ?, ?, now(), now())`,
      [randomUUID(), lookupAction, scope.tenantId, scope.organizationId, randomUUID(), lookupAction,
        randomUUID(), randomUUID(), randomUUID(), otherAction, scope.tenantId, scope.organizationId],
    )
    await em.execute('update customer_entities set primary_email_hash = ? where id = ?', [hashForLookup(personEmail), personId])
    await em.execute('update customer_companies set domain_hash = ? where id = ?', [hashForLookup(companyDomain), profileId])

    await migrate('down')
    expect(await readColumns(em)).toEqual([])
    expect(await readIndexes(em)).toEqual([])
    expect(await readCustomers()).toEqual(beforeCustomers)
    const readMaps = async () => new Map(
      (await em.execute<Array<{ id: string; fields_json: FieldRule[] }>>('select id, fields_json from encryption_maps'))
        .map((map) => [map.id, map.fields_json]),
    )
    const expectedMaps = new Map([
      [personMapId, [{ field: 'primary_email' }, unrelatedRule]],
      [companyMapId, [{ field: 'domain' }, unrelatedRule]],
      [unrelatedMapId, unrelatedFields],
    ])
    expect(await readMaps()).toEqual(expectedMaps)
    expect(await em.execute('select action_id from upgrade_action_runs')).toEqual([{ action_id: otherAction }])

    await migrate('up')
    await expectPhysicalSchema()
    expect(await readMaps()).toEqual(expectedMaps)
    expect(await em.execute('select action_id from upgrade_action_runs')).toEqual([{ action_id: otherAction }])
  })

  it.each(['encrypted', 'legacy plaintext'] as const)(
    'matches equal %s lookup values only in the selected tenant and organization',
    async (storage) => {
      await migrate('up')
      const em = orm.em.fork()
      const tenantId = randomUUID()
      const otherTenantId = randomUUID()
      const organizationId = randomUUID()
      const otherOrganizationId = randomUUID()
      const matchingScopes = [
        { tenantId, organizationId },
        { tenantId, organizationId: otherOrganizationId },
        { tenantId: otherTenantId, organizationId },
      ]
      const email = 'match@customer.example.test'
      const domain = 'customer.example.test'
      const deletedDomain = 'deleted.example.test'
      const tenantKey = generateDek()
      const otherTenantKey = generateDek()
      mockTenantKeys.set(tenantId, tenantKey)
      mockTenantKeys.set(otherTenantId, otherTenantKey)

      const storedValue = (value: string, key: string) => storage === 'encrypted' ? encryptWithAesGcm(value, key).value : value

      function addCompany(scope: Scope, key: string, value: string, deletedAt: Date | null = null): string {
        const owner = em.create(customerEntities.CustomerEntity, {
          id: randomUUID(), ...scope, kind: 'company', displayName: 'Company', deletedAt,
        })
        em.create(customerEntities.CustomerCompanyProfile, {
          ...scope, entity: owner, domain: storedValue(value, key), domainHash: hashForLookup(value),
        })
        return owner.id
      }

      const fixtures = []
      for (const scope of matchingScopes) {
        const key = scope.tenantId === tenantId ? tenantKey : otherTenantKey
        await seedMap(em, personEntityId, scope, [{ field: 'primary_email', hashField: 'primary_email_hash' }])
        await seedMap(em, companyEntityId, scope, [{ field: 'domain', hashField: 'domain_hash' }])
        const person = em.create(customerEntities.CustomerEntity, {
          ...scope, kind: 'person', displayName: 'Person', primaryEmail: storedValue(email, key),
          primaryEmailHash: hashForLookup(email),
        })
        const companyId = addCompany(scope, key, domain)
        fixtures.push({ scope, person, companyId })
      }
      addCompany({ tenantId, organizationId }, tenantKey, deletedDomain, new Date())
      await em.flush()

      for (const { scope, person, companyId } of fixtures) {
        expect(await findPeopleByAddresses(orm.em.fork(), [email.toUpperCase()], scope.tenantId, scope.organizationId))
          .toEqual([{ id: person.id, email }])
        expect(await findCompaniesByDomains(orm.em.fork(), [`@www.${domain.toUpperCase()}`], scope.tenantId, scope.organizationId))
          .toEqual([{ id: companyId, domain }])
      }

      expect(await findPeopleByAddresses(orm.em.fork(), [email], otherTenantId, otherOrganizationId)).toEqual([])
      expect(await findCompaniesByDomains(orm.em.fork(), [domain], otherTenantId, otherOrganizationId)).toEqual([])
      expect(await findCompaniesByDomains(orm.em.fork(), [deletedDomain], tenantId, organizationId)).toEqual([])
    },
  )
})
