import type { EntityManager } from '@mikro-orm/postgresql'
import { Kysely, PostgresDialect, type PostgresPoolClient } from 'kysely'
import { decryptWithAesGcm, encryptWithAesGcm, generateDek, hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { backfillCustomerLookupHashes, type LookupHashBackfillReport } from '../backfillLookupHashes'

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const otherOrganizationId = '00000000-0000-4000-8000-000000000003'
const scope = { tenantId, organizationId }
const personEntity = 'customers:customer_entity'
const companyEntity = 'customers:customer_company_profile'
const rules = {
  [personEntity]: [{ field: 'primary_email', hashField: 'primary_email_hash' }],
  [companyEntity]: [{ field: 'domain', hashField: 'domain_hash' }],
}

type StoredRow = { id: string; source: string; hash?: string; organizationId?: string }

function fixture(
  records: { personRows?: StoredRow[]; companyRows?: StoredRow[] } = {},
  options: { raceId?: string; failUpdate?: boolean } = {},
) {
  const dek = generateDek()
  const execute = jest.fn(async (statement: string, params: readonly unknown[]) => {
    const sql = statement.trim()
    if (sql.includes('from "organizations"')) {
      return { command: 'SELECT', rowCount: 1, rows: [{ id: organizationId, tenant_id: tenantId }] }
    }
    const rows = (sql.includes('"customer_companies"') ? records.companyRows : records.personRows) ?? []
    if (sql.startsWith('select')) {
      const cursor = params.length > 3 ? String(params[2]) : ''
      const selected = rows.filter((row) =>
        !row.hash && row.id > cursor && (row.organizationId ?? organizationId) === params[1],
      ).slice(0, Number(params.at(-1)))
      return { command: 'SELECT', rowCount: selected.length, rows: selected }
    }
    const [hash, id, , org, source] = params
    const row = rows.find((candidate) => candidate.id === id && candidate.source === source
      && (candidate.organizationId ?? organizationId) === org && !candidate.hash)
    if (!row || id === options.raceId) return { command: 'UPDATE', rowCount: 0, rows: [] }
    if (options.failUpdate) throw new Error(`Database rejected sensitive value: ${source}`)
    row.hash = String(hash)
    return { command: 'UPDATE', rowCount: 1, rows: [{ id }] }
  })
  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: {
        options: {},
        end: async () => {},
        connect: async () => ({
          query: execute as unknown as PostgresPoolClient['query'],
          release: () => {},
        }),
      },
    }),
  })
  const em = { getKysely: () => db } as unknown as EntityManager
  const encryption = {
    getEncryptedFieldNames: jest.fn(async (entityId: string) => rules[entityId as keyof typeof rules]?.map(({ field }) => field) ?? []),
    getLookupHashRules: jest.fn(async (entityId: string) => rules[entityId as keyof typeof rules] ?? []),
    decryptEntityPayload: jest.fn(async (_entityId, payload: Record<string, unknown>) => {
      const [[field, value]] = Object.entries(payload)
      return { [field]: decryptWithAesGcm(String(value), dek) ?? value }
    }),
  }
  const reports: LookupHashBackfillReport[] = []
  const run = (dryRun = false) => backfillCustomerLookupHashes(em, encryption, { ...scope, dryRun }, (report) => reports.push(report))
  return { dek, encryption, execute, reports, run }
}

function clearLookupSecrets(): void {
  delete process.env.LOOKUP_HASH_PEPPER
  delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
  delete process.env.TENANT_DATA_ENCRYPTION_KEY
}

beforeEach(() => {
  jest.replaceProperty(process, 'env', { ...process.env })
  clearLookupSecrets()
  process.env.LOOKUP_HASH_PEPPER = 'crm-backfill-unit-test-pepper'
})

afterEach(() => jest.restoreAllMocks())

test('backfills both scoped fields, preserves raw values and populated hashes, and is idempotent', async () => {
  const personRows: StoredRow[] = [
    { id: 'existing', source: 'existing@example.test', hash: 'keep' },
    { id: 'foreign', source: 'foreign@example.test', organizationId: otherOrganizationId },
    { id: 'plaintext', source: ' Plaintext@Example.test ' },
  ]
  const companyRows: StoredRow[] = []
  const { dek, encryption, execute, reports, run } = fixture({ personRows, companyRows })
  encryption.getLookupHashRules.mockImplementation(async (entityId) =>
    entityId === personEntity
      ? [{ field: 'primaryEmail', hashField: 'primaryEmailHash' }]
      : rules[companyEntity],
  )
  const domain = ' WWW.Example.test '
  const ciphertext = encryptWithAesGcm(domain, dek).value
  companyRows.push({ id: 'company', source: ciphertext })

  await expect(run()).resolves.toBe(true)
  expect(execute.mock.calls[0]).toEqual([
    'select "id", "tenant_id" from "organizations" where "tenant_id" = $1 and "id" = $2 order by "id" limit $3',
    [tenantId, organizationId, 500],
  ])
  expect(personRows.map(({ hash }) => hash)).toEqual(['keep', undefined, hashForLookup('plaintext@example.test')])
  expect(companyRows[0]).toEqual({ id: 'company', source: ciphertext, hash: hashForLookup(domain) })
  expect(encryption.decryptEntityPayload).toHaveBeenCalledTimes(1)
  expect(encryption.decryptEntityPayload).toHaveBeenCalledWith(
    companyEntity, { domain: ciphertext }, tenantId, organizationId, expect.objectContaining({ em: expect.anything() }),
  )
  const writes = execute.mock.calls.filter(([sql]) => sql.trimStart().startsWith('update'))
  expect(writes).toHaveLength(2)
  expect(writes[0][0]).toContain('where id = $2 and tenant_id = $3 and organization_id = $4')
  expect(writes[0][0]).toContain('and "primary_email" = $5 and "primary_email_hash" is null')
  expect(writes[0][0]).not.toContain(personRows[2].source)
  expect(writes[0][1]).toEqual([hashForLookup(personRows[2].source), 'plaintext', tenantId, organizationId, personRows[2].source])
  expect(writes[0][0]).not.toContain('updated_at')
  expect(writes[1][1]).toEqual([hashForLookup(domain), 'company', tenantId, organizationId, ciphertext])
  expect(reports).toEqual([
    { ...scope, field: 'primary_email', status: 'processed', changed: 1, undecryptable: 0, concurrentChanges: 0 },
    { ...scope, field: 'domain', status: 'processed', changed: 1, undecryptable: 0, concurrentChanges: 0 },
  ])

  await expect(run()).resolves.toBe(true)
  expect(reports.slice(2).map((report) => report.status === 'processed' && report.changed)).toEqual([0, 0])
  expect(execute.mock.calls.filter(([sql]) => sql.trimStart().startsWith('update'))).toHaveLength(2)
})

test('reports ciphertext it could not decrypt and rows changed by another writer', async () => {
  const sealed = encryptWithAesGcm('person@example.test', generateDek()).value
  const personRows: StoredRow[] = [{ id: 'sealed', source: sealed }, { id: 'race', source: 'race@example.test' }]
  const { reports, execute, run } = fixture({ personRows }, { raceId: 'race' })

  await expect(run()).resolves.toBe(false)
  expect(personRows.every(({ hash }) => hash === undefined)).toBe(true)
  expect(reports[0]).toMatchObject({ status: 'processed', changed: 0, undecryptable: 1, concurrentChanges: 1 })
  expect(execute.mock.calls.filter(([sql]) => sql.trimStart().startsWith('update')).map(([, params]) => params[1])).toEqual(['race'])
})

test('previews all pages without modifying hashes', async () => {
  const personRows: StoredRow[] = Array.from({ length: 501 }, (_, index) => ({
    id: String(index).padStart(3, '0'),
    source: 'person@example.test',
  }))
  const { reports, execute, run } = fixture({ personRows })

  await expect(run(true)).resolves.toBe(true)
  const pages = execute.mock.calls.filter(([sql]) => sql.includes('from "customer_entities"'))
  expect(pages.map(([, params]) => params)).toEqual([
    [tenantId, organizationId, 500],
    [tenantId, organizationId, '499', 500],
  ])
  expect(execute.mock.calls.some(([sql]) => sql.trimStart().startsWith('update'))).toBe(false)
  expect(reports[0]).toMatchObject({ status: 'processed', changed: 501 })
})

test.each([
  { encryptedFields: [], expected: 'unprotected-field', complete: true },
  { encryptedFields: ['description', 'legal_name'], expected: 'unprotected-field', complete: true },
  { encryptedFields: ['primary_email', 'domain'], expected: 'unreconciled-map', complete: false },
])('handles a missing hash rule for encrypted fields $encryptedFields', async ({ encryptedFields, expected, complete }) => {
  const { encryption, execute, reports, run } = fixture()
  encryption.getEncryptedFieldNames.mockResolvedValue(encryptedFields)
  encryption.getLookupHashRules.mockResolvedValue([])

  await expect(run()).resolves.toBe(complete)
  expect(reports.map(({ status }) => status)).toEqual([expected, expected])
  expect(execute).toHaveBeenCalledTimes(1)
})

test('sanitizes database write failures before reporting them', async () => {
  const source = 'sensitive@example.test'
  const { run } = fixture({ personRows: [{ id: 'contact', source }] }, { failUpdate: true })

  await expect(run()).rejects.toThrow(
    '[internal] CRM lookup hash update failed. Check the database connection and permissions before retrying.',
  )
})

test('fails an encrypted scope before reading sources when the lookup pepper is unavailable', async () => {
  clearLookupSecrets()
  const { encryption, execute, reports, run } = fixture()

  await expect(run()).resolves.toBe(false)
  expect(reports.map(({ status }) => status)).toEqual(['no-pepper', 'no-pepper'])
  expect(execute).toHaveBeenCalledTimes(1)
  expect(encryption.decryptEntityPayload).not.toHaveBeenCalled()
})
