import { randomUUID } from 'node:crypto'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { HybridQueryEngine } from '@open-mercato/core/modules/query_index/lib/engine'
import { rotateCustomEntityDocuments } from '@open-mercato/core/modules/entities/lib/rotate-custom-entity-documents'
import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'
import { TenantDataEncryptionService } from '../../encryption/tenantDataEncryptionService'
import { decryptWithAesGcm, isEncryptedPayloadShape } from '../../encryption/aes'

const databaseUrl = process.env.OM_CUSTOM_ENTITY_ENCRYPTION_TEST_DATABASE_URL
const describePostgres = process.env.OM_PG_INTEGRATION === '1' && databaseUrl ? describe : describe.skip

describePostgres('custom entity encryption in PostgreSQL JSONB (#7810)', () => {
  test('persists ciphertext, reads and filters decrypted values, and seals legacy fields on update', async () => {
    const schema = `encryption_test_${randomUUID().replaceAll('-', '')}`
    const admin = new Pool({ connectionString: databaseUrl })
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` })
    const db = new Kysely<{ custom_entities_storage: { entity_type: string; entity_id: string; organization_id: string; tenant_id: string; doc: Record<string, unknown>; created_at: Date; updated_at: Date; deleted_at: Date | null } }>({ dialect: new PostgresDialect({ pool }) })
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const entityId = 'user:encrypted_test_documents'
    const recordId = randomUUID()
    const key = Buffer.alloc(32, 29).toString('base64')
    let activeKey = key
    const encryptionToggle = process.env.TENANT_DATA_ENCRYPTION
    const backcompatToggle = process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
    try {
      process.env.TENANT_DATA_ENCRYPTION = 'yes'
      process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = 'no'
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
      const definitions = ['secret', 'title'].map((field) => ({
        entityId, key: field, kind: 'text', organizationId: null, tenantId,
        configJson: { encrypted: field === 'secret' }, isActive: true, deletedAt: null, updatedAt: new Date(),
      }))
      for (const definition of definitions) {
        await sql`insert into custom_field_defs values (
          ${entityId}, ${definition.key}, 'text', null, ${tenantId}, ${JSON.stringify(definition.configJson)}::jsonb, true, now(), null
        )`.execute(db)
      }
      const em = {
        getKysely: () => db,
        getConnection: () => ({ execute: async <Result>(statement: string, parameters: readonly unknown[] = []): Promise<Result> => {
          let parameterIndex = 0
          const result = await pool.query(statement.replace(/\?/g, () => `$${++parameterIndex}`), [...parameters])
          return result.rows as Result
        } }),
        getMetadata: () => ({ find: () => undefined, getAll: () => [] }),
        find: async (entity: unknown) => entity === CustomFieldDef ? definitions : [],
      }
      const service = new TenantDataEncryptionService(em as never, { kms: {
        isHealthy: () => true,
        getTenantDek: async (requestedTenant) => requestedTenant === tenantId ? { tenantId, key: activeKey, fetchedAt: Date.now() } : null,
        createTenantDek: async () => null,
      } })
      const engine = new DefaultDataEngine(em as never, { resolve: () => service } as never)
      const queryEngine = new HybridQueryEngine(em as never, { query: async () => { throw new Error('[internal] Unexpected query fallback') } } as never, undefined, undefined, () => service)
      clearDataEngineTableExistsCache()
      await engine.createCustomEntityRecord({ entityId, recordId, tenantId, organizationId, values: { secret: '123', title: 'Visible' } })
      const stored = await db.selectFrom('custom_entities_storage').select('doc').executeTakeFirstOrThrow()
      expect(isEncryptedPayloadShape(stored.doc.secret)).toBe(true)
      expect(JSON.stringify(stored.doc)).not.toContain('"secret":"123"')
      expect(decryptWithAesGcm(String(stored.doc.secret), key)).toBe('123')
      const result = await queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id', 'secret', 'title'],
        filters: { secret: '123' }, page: { page: 1, pageSize: 10 },
      })
      expect(result.items).toEqual([{ id: recordId, secret: '123', title: 'Visible' }])
      for (const scope of [{ tenantId: randomUUID(), organizationId }, { tenantId, organizationId: randomUUID() }]) {
        const outOfScope = await queryEngine.query(entityId, {
          forceCustomEntityStorage: true, ...scope, fields: ['id', 'secret'], filters: { secret: '123' },
        })
        expect(outOfScope.items).toEqual([])
        expect(outOfScope.total).toBe(0)
      }
      await db.updateTable('custom_entities_storage').set({ doc: { ...stored.doc, tags: ['red', 'blue'] } }).execute()
      const scopedResult = await queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id', 'secret'],
        filters: { secret: '123', organization_id: { $in: [organizationId] }, tags: { $overlap: ['red'] } },
      })
      expect(scopedResult.items).toEqual([{ id: recordId, secret: '123' }])
      expect(scopedResult.total).toBe(1)
      const groupedResult = await queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id'],
        filters: { $or: [{ secret: 'missing' }, { organization_id: organizationId }] },
      })
      expect(groupedResult.items).toEqual([{ id: recordId }])
      expect(groupedResult.total).toBe(1)
      const overlapResult = await queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id', 'tags'],
        filters: { $or: [{ secret: 'missing' }, { tags: { $overlap: ['red'] } }] },
      })
      expect(overlapResult.items).toEqual([{ id: recordId, tags: '["red", "blue"]' }])
      expect(overlapResult.total).toBe(1)
      await db.updateTable('custom_entities_storage').set({ doc: { ...stored.doc, tags: '["red", "blue"]' } }).execute()
      const scalarResult = await queryEngine.query(entityId, {
        forceCustomEntityStorage: true, tenantId, organizationId, fields: ['id'],
        filters: { $or: [{ secret: 'missing' }, { tags: { $overlap: ['red'] } }] },
      })
      expect(scalarResult.items).toEqual([])
      expect(scalarResult.total).toBe(0)
      await db.updateTable('custom_entities_storage').set({ doc: { id: recordId, secret: 'legacy plaintext', title: 'Visible' } }).execute()
      await engine.updateCustomEntityRecord({ entityId, recordId, tenantId, organizationId, values: { title: 'Updated' } })
      const updated = await db.selectFrom('custom_entities_storage').select('doc').executeTakeFirstOrThrow()
      expect(decryptWithAesGcm(String(updated.doc.secret), key)).toBe('legacy plaintext')
      expect(updated.doc.title).toBe('Updated')
      activeKey = Buffer.alloc(32, 30).toString('base64')
      service.invalidateDek(tenantId)
      const rotation = {
        encryptionService: service,
        oldKms: { isHealthy: () => true, getTenantDek: async () => ({ tenantId, key, fetchedAt: Date.now() }), createTenantDek: async () => null },
        tenantId, organizationId, dryRun: true,
      }
      await expect(rotateCustomEntityDocuments(em as never, rotation)).resolves.toBe(1)
      expect((await db.selectFrom('custom_entities_storage').select('doc').executeTakeFirstOrThrow()).doc).toEqual(updated.doc)
      await expect(rotateCustomEntityDocuments(em as never, { ...rotation, dryRun: false })).resolves.toBe(1)
      const rotated = await db.selectFrom('custom_entities_storage').select('doc').executeTakeFirstOrThrow()
      expect(decryptWithAesGcm(String(rotated.doc.secret), activeKey)).toBe('legacy plaintext')
      expect(decryptWithAesGcm(String(rotated.doc.secret), key)).toBeNull()
    } finally {
      if (encryptionToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = encryptionToggle
      if (backcompatToggle === undefined) delete process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
      else process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = backcompatToggle
      await db.destroy()
      await admin.query(`drop schema if exists "${schema}" cascade`)
      await admin.end()
      clearDataEngineTableExistsCache()
    }
  })
})
