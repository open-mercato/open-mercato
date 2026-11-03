import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { HybridQueryEngine } from '@open-mercato/core/modules/query_index/lib/engine'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'
import { TenantDataEncryptionService } from '../../encryption/tenantDataEncryptionService'
import { isEncryptedPayloadShape } from '../../encryption/aes'

// Complements `engine.custom-entity-encryption.integration.test.ts` by covering the two
// behaviors that file leaves unexercised on a real JSONB store: encrypted-field ordering via
// the plaintext decrypt-and-sort scan, the `OM_ENCRYPTED_SORT_MAX_ROWS` fail-closed candidate
// cap, and a non-matching encrypted filter that returns nothing without leaking ciphertext.
const databaseUrl = process.env.OM_CUSTOM_ENTITY_ENCRYPTION_TEST_DATABASE_URL
const describePostgres = process.env.OM_PG_INTEGRATION === '1' && databaseUrl ? describe : describe.skip
const entityId = 'user:encrypted_test_documents_sort'

describePostgres('custom entity encrypted document ordering and filtering in PostgreSQL JSONB (#7810)', () => {
  test('orders by a decrypted encrypted field, caps the candidate scan, and rejects a non-matching filter', async () => {
    const schema = `encryption_sort_test_${randomUUID().replaceAll('-', '')}`
    const admin = new Pool({ connectionString: databaseUrl })
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` })
    const db = new Kysely<{ custom_entities_storage: { entity_type: string; entity_id: string; organization_id: string; tenant_id: string; doc: Record<string, unknown>; created_at: Date; updated_at: Date; deleted_at: Date | null } }>({ dialect: new PostgresDialect({ pool }) })
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const key = Buffer.alloc(32, 41).toString('base64')
    const encryptionToggle = process.env.TENANT_DATA_ENCRYPTION
    const backcompatToggle = process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
    const sortCapToggle = process.env.OM_ENCRYPTED_SORT_MAX_ROWS
    try {
      process.env.TENANT_DATA_ENCRYPTION = 'yes'
      process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = 'no'
      delete process.env.OM_ENCRYPTED_SORT_MAX_ROWS
      await admin.query(`create schema "${schema}"`)
      await sql`create table custom_entities_storage (
        id uuid primary key default gen_random_uuid(),
        entity_type text not null, entity_id uuid not null, organization_id uuid, tenant_id uuid,
        doc jsonb not null, created_at timestamptz not null, updated_at timestamptz not null, deleted_at timestamptz,
        unique (entity_type, entity_id, organization_id)
      )`.execute(db)
      await sql`create table custom_field_defs (
        entity_id text, key text, kind text, organization_id uuid, tenant_id uuid, config_json jsonb,
        is_active boolean, updated_at timestamptz, deleted_at timestamptz
      )`.execute(db)
      await sql`insert into custom_field_defs values (${entityId}, 'secret', 'text', null, ${tenantId}, ${'{"encrypted":true}' as never}, true, now(), null)`.execute(db)
      const em = {
        getKysely: () => db,
        getConnection: () => ({ execute: async <Result>(statement: string, parameters: readonly unknown[] = []): Promise<Result> => {
          let parameterIndex = 0
          const result = await pool.query(statement.replace(/\?/g, () => `$${++parameterIndex}`), [...parameters])
          return result.rows as Result
        } }),
        getMetadata: () => ({ find: () => undefined, getAll: () => [] }),
        find: async (entity: unknown) => entity === CustomFieldDef ? [{ entityId, key: 'secret', kind: 'text', organizationId: null, tenantId, configJson: { encrypted: true }, isActive: true, deletedAt: null, updatedAt: new Date() }] : [],
      }
      const service = new TenantDataEncryptionService(em as never, { kms: {
        isHealthy: () => true,
        getTenantDek: async (requestedTenant) => requestedTenant === tenantId ? { tenantId, key, fetchedAt: Date.now() } : null,
        createTenantDek: async () => null,
      } })
      const engine = new DefaultDataEngine(em as never, { resolve: () => service } as never)
      const queryEngine = new HybridQueryEngine(em as never, { query: async () => { throw new Error('[internal] Unexpected query fallback') } } as never, undefined, undefined, () => service)
      clearDataEngineTableExistsCache()

      // Three rows whose ciphertext byte-order is unrelated to their decrypted order.
      const plainValues = ['charlie', 'alpha', 'bravo']
      const recordIds: string[] = []
      for (const value of plainValues) {
        const recordId = randomUUID()
        recordIds.push(recordId)
        await engine.createCustomEntityRecord({ entityId, recordId, tenantId, organizationId, values: { secret: value } })
      }
      const stored = await db.selectFrom('custom_entities_storage').select('doc').execute()
      for (const row of stored) {
        expect(isEncryptedPayloadShape(String(row.doc.secret))).toBe(true)
        expect(JSON.stringify(row.doc)).not.toMatch(/"(charlie|alpha|bravo)"/)
      }

      // Ascending decrypt-order over ciphertext that is not stored in that order.
      const ordered = await queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id', 'secret'],
        sort: [{ field: 'secret', dir: SortDir.Asc }], page: { page: 1, pageSize: 10 },
      })
      expect(ordered.items.map((row) => row.secret)).toEqual(['alpha', 'bravo', 'charlie'])
      expect(ordered.meta).toBeUndefined()

      // A non-matching encrypted filter returns nothing; a matching one resolves the single value.
      const missed = await queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id', 'secret'],
        filters: { secret: 'does-not-exist' }, page: { page: 1, pageSize: 10 },
      })
      expect(missed.items).toEqual([])

      const hit = await queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id', 'secret'],
        filters: { secret: 'alpha' }, page: { page: 1, pageSize: 10 },
      })
      expect(hit.items).toEqual([{ id: recordIds[1], secret: 'alpha' }])

      // Bounding the candidate scan fails closed once it cannot hold the whole scoped set:
      // the scan is capped so it throws rather than return a partial, silently truncated page.
      process.env.OM_ENCRYPTED_SORT_MAX_ROWS = '2'
      await expect(queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id', 'secret'],
        sort: [{ field: 'secret', dir: SortDir.Desc }], page: { page: 1, pageSize: 10 },
      })).rejects.toThrow('[internal] Custom entity encrypted query exceeds the candidate row limit')
    } finally {
      if (encryptionToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = encryptionToggle
      if (backcompatToggle === undefined) delete process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
      else process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = backcompatToggle
      if (sortCapToggle === undefined) delete process.env.OM_ENCRYPTED_SORT_MAX_ROWS
      else process.env.OM_ENCRYPTED_SORT_MAX_ROWS = sortCapToggle
      await db.destroy()
      await admin.query(`drop schema if exists "${schema}" cascade`)
      await admin.end()
      clearDataEngineTableExistsCache()
    }
  })
})
