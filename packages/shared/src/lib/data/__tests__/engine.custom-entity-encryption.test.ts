import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { DefaultDataEngine, clearDataEngineTableExistsCache } from '../engine'
import { decryptWithAesGcm, encryptWithAesGcm, isEncryptedPayloadShape, TenantDataEncryptionErrorCode } from '../../encryption/aes'
import { decryptCustomEntityDocument } from '../../encryption/customEntityDoc'
import type { TenantDataEncryptionService } from '../../encryption/tenantDataEncryptionService'

const entityId = 'user:protected_documents'
const recordId = '11111111-1111-4111-8111-111111111111'
const tenantId = 'tenant-1'
const organizationId = 'org-1'
const key = Buffer.alloc(32, 19).toString('base64')

type Definition = { key: string; kind: string; entityId: string; organizationId: string | null; tenantId: string | null; configJson: { encrypted: boolean; multi?: boolean }; updatedAt: Date; isActive: boolean; deletedAt: null }
type Write = { operation: 'insert' | 'update'; payload: Record<string, unknown>; scopes: Array<[string, string, unknown]> }
type SqlValue = { toOperationNode(): { parameters: readonly { value?: unknown }[] } }

function definition(field: string, options: Partial<Definition> = {}): Definition {
  return { key: field, kind: 'text', entityId, organizationId: null, tenantId, configJson: { encrypted: true }, updatedAt: new Date('2026-10-01T00:00:00Z'), isActive: true, deletedAt: null, ...options }
}

function matchesWhere(row: Definition, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([field, value]) => {
    if (field === '$and') return (value as Record<string, unknown>[]).every((clause) => matchesWhere(row, clause))
    if (field === '$or') return (value as Record<string, unknown>[]).some((clause) => matchesWhere(row, clause))
    return row[field as keyof Definition] === value
  })
}

function storedDocument(write: Write): Record<string, unknown> {
  const node = (write.payload.doc as SqlValue).toOperationNode()
  return JSON.parse(String(node.parameters[0].value)) as Record<string, unknown>
}

function buildEngine(options: { previousDoc?: Record<string, unknown>; definitions?: Definition[]; enabled?: boolean; missingKey?: boolean; cannotCreate?: boolean; noUpdatedRows?: boolean; rejectFirstInsert?: boolean } = {}) {
  const writes: Write[] = []
  let rejectFirstInsert = options.rejectFirstInsert === true
  const buildQuery = (operation: 'select' | 'insert' | 'update' | 'table-check') => {
    const write: Write = { operation: operation === 'insert' ? 'insert' : 'update', payload: {}, scopes: [] }
    const chain = {
      select: (_selection: unknown) => chain,
      values: (payload: Record<string, unknown>) => { write.payload = payload; return chain },
      set: (payload: Record<string, unknown>) => { write.payload = payload; return chain },
      where: (column: string, operator: string, value: unknown) => { write.scopes.push([column, operator, value]); return chain },
      onConflict: (callback: (builder: { columns(columns: string[]): { doUpdateSet(payload: Record<string, unknown>): unknown } }) => unknown) => {
        callback({ columns: (_columns) => ({ doUpdateSet: (_payload) => ({}) }) })
        return chain
      },
      executeTakeFirst: async () => {
        if (operation === 'table-check') return { present: 1 }
        if (operation === 'select') return options.previousDoc ? { doc: options.previousDoc } : undefined
        writes.push(write)
        return { numUpdatedRows: options.noUpdatedRows ? 0n : 1n }
      },
      execute: async () => {
        if (operation === 'insert' && rejectFirstInsert) { rejectFirstInsert = false; throw new Error('[internal] create fallback') }
        writes.push(write)
        return []
      },
    }
    return chain
  }
  const db = {
    selectFrom: (table: string) => buildQuery(table === 'information_schema.tables' ? 'table-check' : 'select'),
    insertInto: (_table: string) => buildQuery('insert'),
    updateTable: (_table: string) => buildQuery('update'),
  }
  const definitions = options.definitions ?? [definition('secret'), definition('tags', { configJson: { encrypted: true, multi: true } }), definition('title', { configJson: { encrypted: false } })]
  const find = jest.fn(async (entity: unknown, where: Record<string, unknown>) => entity === CustomFieldDef ? definitions.filter((row) => matchesWhere(row, where)) : [])
  const service = {
    isEnabled: () => options.enabled !== false,
    getDek: jest.fn(async () => options.missingKey ? null : { tenantId, key, fetchedAt: 0 }),
    createDek: jest.fn(async () => options.cannotCreate ? null : { tenantId, key, fetchedAt: 0 }),
  }
  const em = { getKysely: () => db, getMetadata: () => ({ find: () => undefined, getAll: () => [] }), find }
  const engine = new DefaultDataEngine(em as never, { resolve: () => service } as never)
  return { engine, writes, find, service: service as unknown as TenantDataEncryptionService }
}

describe('DataEngine custom-entity encrypted JSONB storage', () => {
  const previousToggle = process.env.TENANT_DATA_ENCRYPTION
  const previousEav = process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM

  beforeEach(() => {
    clearDataEngineTableExistsCache()
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
    delete process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
  })
  afterEach(() => {
    if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousToggle
    if (previousEav === undefined) delete process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
    else process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = previousEav
  })

  test('create serializes ciphertext even when optional EAV storage is disabled', async () => {
    const { engine, writes, service } = buildEngine()
    const result = await engine.createCustomEntityRecord({ entityId, recordId, organizationId, tenantId, values: { secret: '123', cf_tags: ['true', 'private'], title: 'Public' } })

    expect(result).toEqual({ id: recordId })
    expect(writes).toHaveLength(1)
    const stored = storedDocument(writes[0])
    expect(stored.title).toBe('Public')
    expect(isEncryptedPayloadShape(stored.secret)).toBe(true)
    expect(stored['cf:tags']).toEqual([expect.any(String), expect.any(String)])
    expect(JSON.stringify(stored)).not.toContain('private')
    expect(await decryptCustomEntityDocument(stored, [{ key: 'secret', kind: 'text', encrypted: true }, { key: 'tags', kind: 'text', encrypted: true }], tenantId, service)).toEqual({ id: recordId, secret: '123', 'cf:tags': ['true', 'private'], title: 'Public' })
  })

  test('merged updates seal omitted legacy plaintext and retain current-key ciphertext', async () => {
    const sealed = encryptWithAesGcm('existing ciphertext', key).value
    const { engine, writes } = buildEngine({ previousDoc: { id: recordId, secret: 'legacy secret', 'cf:tags': [sealed], title: 'Before' } })
    await engine.updateCustomEntityRecord({ entityId, recordId, organizationId, tenantId, values: { title: 'After' } })

    const stored = storedDocument(writes[0])
    expect(decryptWithAesGcm(String(stored.secret), key)).toBe('legacy secret')
    expect(stored['cf:tags']).toEqual([sealed])
    expect(stored.title).toBe('After')
    expect(writes[0].scopes).toEqual(expect.arrayContaining([['tenant_id', '=', tenantId], ['organization_id', '=', organizationId], ['entity_id', '=', recordId]]))
  })

  test('organization-specific definitions override tenant defaults while foreign definitions cannot affect the write', async () => {
    const definitions = [
      definition('secret', { configJson: { encrypted: false } }),
      definition('secret', { organizationId, configJson: { encrypted: true } }),
      definition('secret', { organizationId: 'foreign-org', updatedAt: new Date('2026-10-29T00:00:00Z'), configJson: { encrypted: false } }),
      definition('secret', { tenantId: 'foreign-tenant', organizationId, configJson: { encrypted: false } }),
    ]
    const { engine, writes, find } = buildEngine({ definitions })
    await engine.createCustomEntityRecord({ entityId, recordId, organizationId, tenantId, values: { secret: 'scope secret' } })
    expect(isEncryptedPayloadShape(storedDocument(writes[0]).secret)).toBe(true)
    const scopedWhere = find.mock.calls.find(([entity, where]) => entity === CustomFieldDef && Array.isArray(where.$and))?.[1]
    expect(scopedWhere).toMatchObject({ $and: [{ $or: [{ organizationId }, { organizationId: null }] }, { $or: [{ tenantId }, { tenantId: null }] }] })
  })

  test.each(['create', 'update'] as const)('%s fails before persistence when the tenant encryption key is unavailable', async (operation) => {
    const { engine, writes } = buildEngine({ missingKey: true, cannotCreate: true })
    const opts = { entityId, recordId, organizationId, tenantId, values: { secret: 'must not persist' } }
    const pending = operation === 'create' ? engine.createCustomEntityRecord(opts) : engine.updateCustomEntityRecord(opts)
    await expect(pending).rejects.toMatchObject({ code: TenantDataEncryptionErrorCode.KMS_UNAVAILABLE })
    expect(writes).toEqual([])
  })

  test('update refuses unknown ciphertext before any SQL mutation', async () => {
    const foreignCiphertext = encryptWithAesGcm('foreign secret', Buffer.alloc(32, 7).toString('base64')).value
    const { engine, writes } = buildEngine({ previousDoc: { id: recordId, secret: foreignCiphertext } })
    await expect(engine.updateCustomEntityRecord({ entityId, recordId, organizationId, tenantId, values: {} })).rejects.toMatchObject({ code: TenantDataEncryptionErrorCode.WRONG_KEY })
    expect(writes).toEqual([])
  })

  test.each(['create-fallback', 'update-insert'] as const)('%s persists the encrypted representation', async (operation) => {
    const { engine, writes } = buildEngine({ rejectFirstInsert: operation === 'create-fallback', noUpdatedRows: operation === 'update-insert' })
    const opts = { entityId, recordId, organizationId, tenantId, values: { secret: 'fallback secret' } }
    if (operation === 'create-fallback') await engine.createCustomEntityRecord(opts)
    else await engine.updateCustomEntityRecord(opts)
    for (const write of writes) expect(decryptWithAesGcm(String(storedDocument(write).secret), key)).toBe('fallback secret')
    expect(writes.length).toBeGreaterThan(0)
  })

  test('encryption-off mode preserves existing plaintext behavior', async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    const { engine, writes } = buildEngine({ enabled: false })
    await engine.createCustomEntityRecord({ entityId, recordId, organizationId, tenantId, values: { secret: 'legacy plaintext' } })
    expect(storedDocument(writes[0]).secret).toBe('legacy plaintext')
  })
})
