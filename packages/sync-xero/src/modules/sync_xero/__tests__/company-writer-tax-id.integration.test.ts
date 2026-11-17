/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { MikroORM, PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as customersEntities from '@open-mercato/core/modules/customers/data/entities'
import { CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { defaultEncryptionMaps } from '@open-mercato/core/modules/customers/encryption'
import '@open-mercato/core/modules/customers/commands/companies'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import * as customFieldEntities from '@open-mercato/core/modules/entities/data/entities'
import { upsertCanonicalEncryptionMap } from '@open-mercato/core/modules/entities/lib/encryption-maps'
import { IntegrationLog, SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import { createInMemoryKms } from './support/inMemoryKms'
import { createIntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { registerTenantEncryptionSubscriber } from '@open-mercato/shared/lib/encryption/subscriber'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { ImportItem } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { XERO_INTEGRATION_ID } from '../lib/constants'
import { buildXeroCommandContext, createXeroContactWriter } from '../lib/contacts/company-writer'
import { createLazyXeroCompanyIndexes, loadXeroCompanyIndexSources } from '../lib/contacts/indexes'
import { loadXeroRunIndex } from '../lib/contacts/preload'
import { formatContactExternalId } from '../lib/external-ids'
import { ensureXeroFieldDefinitions } from '../lib/field-definitions'
import type { XeroContactRecord } from '../lib/keyset'
import type { XeroScope } from '../lib/owner'
import { createFakeContainer } from './support/fakeContainer'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'sync_xero_company_writer_test'
const DATABASE_USER = 'sync_xero_company_writer'
const DATABASE_PASSWORD = 'sync_xero_company_writer'
const CASE_TIMEOUT_MS = 30_000
const XERO_ORGANISATION_ID = 'a3b1c2d3-0000-4000-8000-000000000001'

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type StoredCompany = { entityId: string; displayName: string | null; taxId: string | null }

function entityClasses(module: Record<string, unknown>): Array<new () => object> {
  return Object.values(module).filter((value): value is new () => object => typeof value === 'function')
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function contact(contactId: string, fields: Record<string, unknown> = {}): XeroContactRecord {
  return {
    ContactID: contactId,
    UpdatedDateUTC: '/Date(1760000000000+0000)/',
    Name: 'Acme Ltd',
    EmailAddress: 'billing@acme.example',
    ContactStatus: 'ACTIVE',
    ...fields,
  }
}

describeWithPostgres('Xero Contacts written as Companies through the customers commands on real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  let encryption: TenantDataEncryptionService | null = null
  const previousToggle = process.env.TENANT_DATA_ENCRYPTION
  const previousFallbackKey = process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY

  function fork(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork()
  }

  function requestContainer(em: EntityManager) {
    const registrations: Record<string, unknown> = { em, tenantEncryptionService: encryption, eventBus: { emitEvent: async () => undefined } }
    const container = createFakeContainer(registrations)
    registrations.dataEngine = new DefaultDataEngine(em, container)
    return container
  }

  async function createScope(): Promise<XeroScope> {
    const em = fork()
    const tenant = em.create(Tenant, { name: 'Xero writer tenant' })
    const organization = em.create(Organization, { tenant, name: 'Xero writer organization' })
    await em.flush()
    return { tenantId: tenant.id, organizationId: organization.id }
  }

  async function createCompany(scope: XeroScope, displayName: string, taxId: string): Promise<string> {
    const container = requestContainer(fork())
    const ctx: CommandRuntimeContext = { ...buildXeroCommandContext(container, scope), syncOrigin: null }
    const { result } = await new CommandBus().execute<Record<string, unknown>, { entityId: string }>('customers.companies.create', {
      input: { organizationId: scope.organizationId, tenantId: scope.tenantId, displayName, taxId },
      ctx,
    })
    return result.entityId
  }

  async function runPage(scope: XeroScope, records: XeroContactRecord[]): Promise<ImportItem[]> {
    const em = fork()
    const container = requestContainer(em)
    await ensureXeroFieldDefinitions({ em: em.fork(), cache: undefined, scope })
    const runIndex = await loadXeroRunIndex(em.fork(), scope)
    const writer = createXeroContactWriter({
      em,
      scope,
      xeroOrganisationId: XERO_ORGANISATION_ID,
      runId: randomUUID(),
      commandBus: new CommandBus(),
      commandContext: buildXeroCommandContext(container, scope),
      logService: createIntegrationLogService(em.fork()),
      runIndex,
      indexes: createLazyXeroCompanyIndexes(() => loadXeroCompanyIndexSources(em.fork(), scope), runIndex.isMapped),
    })
    await writer.preparePage(records)
    const items: ImportItem[] = []
    for (const record of records) items.push(await writer.write(record))
    return items
  }

  async function readCompanies(scope: XeroScope): Promise<StoredCompany[]> {
    const em = fork()
    const companies = await findWithDecryption(
      em,
      CustomerEntity,
      { organizationId: scope.organizationId, tenantId: scope.tenantId, kind: 'company', deletedAt: null },
      { orderBy: { createdAt: 'asc' } },
      scope,
    )
    const stored: StoredCompany[] = []
    for (const company of companies) {
      const profile = await findOneWithDecryption(em, CustomerCompanyProfile, { entity: company.id }, {}, scope)
      stored.push({ entityId: company.id, displayName: company.displayName ?? null, taxId: profile?.taxId ?? null })
    }
    return stored
  }

  async function readStoredTaxId(entityId: string): Promise<unknown> {
    const rows = await fork().execute<Array<{ tax_id: unknown }>>('select "tax_id" from "customer_companies" where "entity_id" = ?', [entityId])
    return rows[0]?.tax_id ?? null
  }

  async function readLogCodes(scope: XeroScope): Promise<string[]> {
    const rows = await fork().execute<Array<{ code: string | null }>>(
      'select "code" from "integration_logs" where "integration_id" = ? and "tenant_id" = ? and "organization_id" = ? order by "created_at" asc',
      [XERO_INTEGRATION_ID, scope.tenantId, scope.organizationId],
    )
    return rows.map((row) => row.code ?? '')
  }

  beforeAll(async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = randomBytes(32).toString('base64')
    const customersIds: Record<string, string> = {}
    for (const map of defaultEncryptionMaps) customersIds[map.entityId.split(':')[1]] = map.entityId
    registerEntityIds({ customers: customersIds })

    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [
        ...entityClasses(customersEntities),
        Tenant,
        Organization,
        ...entityClasses(customFieldEntities),
        SyncExternalIdMapping,
        IntegrationLog,
      ],
      debug: false,
      pool: { min: 0, max: 8 },
    })
    await orm.schema.create()
    for (const map of defaultEncryptionMaps) {
      await upsertCanonicalEncryptionMap(orm.em.fork(), {
        entityId: map.entityId,
        tenantId: null,
        organizationId: null,
        fields: map.fields,
        isActive: true,
      })
    }
    encryption = new TenantDataEncryptionService(orm.em, { kms: createInMemoryKms() })
    registerTenantEncryptionSubscriber(orm.em, encryption)
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
    restoreEnv('TENANT_DATA_ENCRYPTION', previousToggle)
    restoreEnv('TENANT_DATA_ENCRYPTION_FALLBACK_KEY', previousFallbackKey)
  }, 30_000)

  it('claims the existing Company by its VAT ID, then writes a changed TaxNumber to the encrypted native VAT ID', async () => {
    const scope = await createScope()
    const existingId = await createCompany(scope, 'Acme Holdings', '123 456 789')
    const contactId = randomUUID()
    const externalId = formatContactExternalId(XERO_ORGANISATION_ID, contactId)

    const [claimed] = await runPage(scope, [contact(contactId, { TaxNumber: '123456789' })])

    expect(claimed).toMatchObject({ externalId, data: { localId: existingId } })
    expect(await readCompanies(scope)).toEqual([{ entityId: existingId, displayName: 'Acme Ltd', taxId: '123 456 789' }])
    expect((await loadXeroRunIndex(fork(), scope)).lookup(externalId)).toBe(existingId)
    const sources = await loadXeroCompanyIndexSources(fork(), scope)
    expect(sources.markers).toEqual([{ entityId: existingId, value: externalId }])
    expect(sources.taxNumbers).toEqual([{ entityId: existingId, value: '123 456 789' }])
    expect(await readLogCodes(scope)).toContain('xero.company_matched_by_tax_number')

    const [changed] = await runPage(scope, [contact(contactId, { TaxNumber: '987654321' })])

    expect(changed).toMatchObject({ action: 'update', data: { localId: existingId } })
    expect(await readCompanies(scope)).toEqual([{ entityId: existingId, displayName: 'Acme Ltd', taxId: '987654321' }])
    const storedTaxId = await readStoredTaxId(existingId)
    expect(isEncryptedPayloadShape(storedTaxId)).toBe(true)
    expect(storedTaxId).not.toContain('987654321')

    const [blank] = await runPage(scope, [contact(contactId, { TaxNumber: '' })])

    expect(blank).toMatchObject({ action: 'skip', data: { localId: existingId } })
    expect(await readCompanies(scope)).toEqual([{ entityId: existingId, displayName: 'Acme Ltd', taxId: '987654321' }])
  }, CASE_TIMEOUT_MS)

  it('matches by a personal US TaxNumberType but never writes it to the native VAT ID', async () => {
    const scope = await createScope()
    const existingId = await createCompany(scope, 'Jane Doe Consulting', '123-45-6789')
    const matchedContactId = randomUUID()
    const createdContactId = randomUUID()

    const [matched, created] = await runPage(scope, [
      contact(matchedContactId, { Name: 'Jane Doe Consulting', TaxNumber: '123-45-6789', TaxNumberType: 'SSN' }),
      contact(createdContactId, { Name: 'John Roe Services', TaxNumber: '900-70-1234', TaxNumberType: 'ITIN' }),
    ])

    expect(matched).toMatchObject({ data: { localId: existingId } })
    expect(created).toMatchObject({ action: 'create' })
    const createdId = String(created.data?.localId)
    expect(await readCompanies(scope)).toEqual([
      { entityId: existingId, displayName: 'Jane Doe Consulting', taxId: '123-45-6789' },
      { entityId: createdId, displayName: 'John Roe Services', taxId: null },
    ])

    const [changed] = await runPage(scope, [
      contact(matchedContactId, { Name: 'Jane Doe Consulting', TaxNumber: '987-65-4321', TaxNumberType: 'SSN' }),
    ])

    expect(changed).toMatchObject({ action: 'skip', data: { localId: existingId } })
    expect(await readCompanies(scope)).toEqual([
      { entityId: existingId, displayName: 'Jane Doe Consulting', taxId: '123-45-6789' },
      { entityId: createdId, displayName: 'John Roe Services', taxId: null },
    ])
  }, CASE_TIMEOUT_MS)
})
