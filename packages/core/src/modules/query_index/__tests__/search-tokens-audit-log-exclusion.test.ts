import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import { encryptWithAesGcm, generateDek } from '@open-mercato/shared/lib/encryption/aes'
import {
  buildSearchTokenRows,
  replaceSearchTokensForBatch,
  replaceSearchTokensForRecord,
  type SearchTokenRow,
} from '../lib/search-tokens'

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: jest.fn(() => ({})),
  resolveEncryptionMode: jest.fn(() => 'disabled'),
}))

type TokenDatabase = { search_tokens: SearchTokenRow & { created_at: Date } }

function createRecordingDb() {
  const statements: CompiledQuery[] = []
  const db = new Kysely<TokenDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      if (event.level === 'query') statements.push(event.query)
    },
  })
  return { db, statements }
}

const auditEntityTypes = ['audit_logs:action_log', 'audit_logs:access_log']
const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const snapshot = JSON.stringify({
  id: '6a8e817f-0115-467b-b31e-091480a7cb3c',
  description: 'A long product description repeated in the audit snapshot. '.repeat(100),
})
const ciphertext = encryptWithAesGcm(snapshot, generateDek()).raw
const documents = [
  { action_label: 'Product created', snapshot_after: snapshot, command_payload: snapshot, search_text: snapshot },
  { action_label: ciphertext, snapshot_after: ciphertext, search_text: ciphertext },
]

describe('audit logs stay out of the search token index (#6182)', () => {
  const originalEnabled = process.env.OM_SEARCH_ENABLED

  beforeEach(() => {
    process.env.OM_SEARCH_ENABLED = 'true'
  })

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.OM_SEARCH_ENABLED
    else process.env.OM_SEARCH_ENABLED = originalEnabled
  })

  it.each(auditEntityTypes)('never tokenizes plaintext or ciphertext for %s', (entityType) => {
    for (const doc of documents) {
      expect(buildSearchTokenRows({ entityType, recordId: 'log-1', doc, guardCiphertext: false })).toEqual([])
    }
  })

  it('continues indexing customer base entities and ordinary JSON-looking text', () => {
    const rows = buildSearchTokenRows({
      entityType: 'customers:customer_entity',
      recordId: 'customer-1',
      doc: { display_name: 'Ada Lovelace', description: snapshot },
      guardCiphertext: false,
    })

    expect(new Set(rows.map((row) => row.field))).toEqual(new Set(['display_name', 'description']))
  })

  it.each(auditEntityTypes)('purges all old fields for one %s within its exact scope', async (entityType) => {
    const { db, statements } = createRecordingDb()
    await replaceSearchTokensForRecord(db, { entityType, recordId: 'log-1', ...scope, doc: documents[1] })

    expect(statements).toHaveLength(1)
    expect(statements[0].sql).toBe(
      'delete from "search_tokens" where "entity_type" = $1 and "entity_id" = $2'
      + ' and organization_id is not distinct from $3 and tenant_id is not distinct from $4',
    )
    expect(statements[0].parameters).toEqual([entityType, 'log-1', 'org-1', 'tenant-1'])
    await db.destroy()
  })

  it('uses the supplied transaction for record cleanup', async () => {
    const { db, statements } = createRecordingDb()
    const transaction = jest.spyOn(db, 'transaction')
    const directDelete = jest.spyOn(db, 'deleteFrom')
    await db.transaction().execute(async (trx) => {
      const transactionDelete = jest.spyOn(trx, 'deleteFrom')
      await replaceSearchTokensForRecord(db, {
        entityType: auditEntityTypes[0], recordId: 'log-1', ...scope, doc: documents[0],
      }, { trx })
      expect(transactionDelete).toHaveBeenCalledWith('search_tokens')
    })

    expect(directDelete).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(statements).toHaveLength(1)
    expect(statements[0].sql).toMatch(/^delete from "search_tokens"/)
    await db.destroy()
  })

  it('cleans existing audit tokens even when token generation is disabled', async () => {
    process.env.OM_SEARCH_ENABLED = 'false'
    const { db, statements } = createRecordingDb()
    await replaceSearchTokensForRecord(db, {
      entityType: auditEntityTypes[0], recordId: 'log-1', ...scope, doc: documents[1],
    })
    await replaceSearchTokensForBatch(db, [{
      entityType: auditEntityTypes[1], recordId: 'log-2', ...scope, doc: documents[1],
    }])

    expect(statements).toHaveLength(2)
    expect(statements.every((query) => query.sql.startsWith('delete from "search_tokens"'))).toBe(true)
    await db.destroy()
  })

  it.each(auditEntityTypes)('cleans a batch of %s without inspecting old token rows', async (entityType) => {
    const { db, statements } = createRecordingDb()
    await replaceSearchTokensForBatch(db, [
      { entityType, recordId: 'log-1', ...scope, doc: documents[0] },
      { entityType, recordId: 'log-2', ...scope, doc: documents[1] },
    ])

    expect(statements).toHaveLength(1)
    expect(statements[0].sql).toBe(
      'delete from "search_tokens" where "entity_type" = $1'
      + ' and organization_id is not distinct from $2 and tenant_id is not distinct from $3'
      + ' and "entity_id" in ($4, $5)',
    )
    expect(statements[0].parameters).toEqual([entityType, 'org-1', 'tenant-1', 'log-1', 'log-2'])
    await db.destroy()
  })

  it('separates entity types, tenants, organizations and null scopes during batch cleanup', async () => {
    const { db, statements } = createRecordingDb()
    const payloads = [
      { entityType: auditEntityTypes[0], recordId: 'same-id', ...scope, doc: documents[0] },
      { entityType: auditEntityTypes[1], recordId: 'same-id', ...scope, doc: documents[0] },
      { entityType: auditEntityTypes[0], recordId: 'same-id', organizationId: 'org-2', tenantId: 'tenant-1', doc: documents[0] },
      { entityType: auditEntityTypes[0], recordId: 'same-id', organizationId: 'org-1', tenantId: 'tenant-2', doc: documents[0] },
      { entityType: auditEntityTypes[0], recordId: 'same-id', organizationId: null, tenantId: null, doc: documents[0] },
    ]
    await replaceSearchTokensForBatch(db, payloads)

    expect(statements).toHaveLength(payloads.length)
    for (const [index, payload] of payloads.entries()) {
      expect(statements[index].parameters).toEqual([
        payload.entityType, payload.organizationId, payload.tenantId, 'same-id',
      ])
      expect(statements[index].sql).toContain('organization_id is not distinct from $2')
      expect(statements[index].sql).toContain('tenant_id is not distinct from $3')
      expect(statements[index].sql).toContain('"entity_id" in ($4)')
    }
    await db.destroy()
  })

  it('still writes non-audit tokens when a batch includes audit records', async () => {
    const { db, statements } = createRecordingDb()
    await replaceSearchTokensForBatch(db, [
      { entityType: auditEntityTypes[0], recordId: 'log-1', ...scope, doc: documents[0] },
      { entityType: 'customers:customer_entity', recordId: 'customer-1', ...scope, doc: { display_name: 'Ada Lovelace' } },
    ])

    const inserts = statements.filter((query) => query.sql.startsWith('insert into "search_tokens"'))
    expect(inserts).toHaveLength(1)
    expect(inserts[0].parameters).toContain('customers:customer_entity')
    expect(inserts[0].parameters).not.toContain(auditEntityTypes[0])
    expect(statements[0].parameters).toEqual([auditEntityTypes[0], 'org-1', 'tenant-1', 'log-1'])
    await db.destroy()
  })
})
