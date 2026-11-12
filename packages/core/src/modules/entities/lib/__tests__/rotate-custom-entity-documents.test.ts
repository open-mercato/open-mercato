import type { EntityManager } from '@mikro-orm/postgresql'
import { decryptWithAesGcm, encryptWithAesGcm, isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { decryptCustomEntityDocument } from '@open-mercato/shared/lib/encryption/customEntityDoc'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { CustomFieldDef } from '../../data/entities'
import { rotateCustomEntityDocuments } from '../rotate-custom-entity-documents'

const tenantId = 'document-rotation-tenant'
const organizationId = 'document-rotation-org'
const entityId = 'user:private_record'
const currentKey = Buffer.alloc(32, 21).toString('base64')
const oldKey = Buffer.alloc(32, 22).toString('base64')
const unknownKey = Buffer.alloc(32, 23).toString('base64')

type Row = {
  id: string
  entity_type: string
  tenant_id: string | null
  organization_id: string | null
  doc: Record<string, unknown>
  updated_at?: string
}

function definition(key: string, kind = 'text', overrides: Partial<CustomFieldDef> = {}): CustomFieldDef {
  return Object.assign(new CustomFieldDef(), {
    entityId,
    key,
    kind,
    tenantId,
    organizationId,
    configJson: { encrypted: true },
    deletedAt: null,
  }, overrides)
}

function matchesDefinition(entry: CustomFieldDef, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === '$and' && Array.isArray(expected)) {
      return expected.every((clause) => matchesDefinition(entry, clause as Record<string, unknown>))
    }
    if (key === '$or' && Array.isArray(expected)) {
      return expected.some((clause) => matchesDefinition(entry, clause as Record<string, unknown>))
    }
    return ((entry as unknown as Record<string, unknown>)[key] ?? null) === expected
  })
}

function fixture(definitions: CustomFieldDef[], batches: Row[][], key: string | null = currentKey) {
  const pending = batches.slice()
  const updates: Array<{ query: string; parameters: unknown[]; doc: Record<string, unknown> }> = []
  const execute = jest.fn(async (query: string, parameters: unknown[]) => {
    if (query.startsWith('select 1 as oversized')) {
      expect(query).toContain('order by id asc limit 8')
      expect(query).toContain('frontier as materialized')
      expect(query).toContain('offset 0')
      return []
    }
    if (query.startsWith('select count(*)::text as verified from custom_entities_storage')) return [{ verified: String(parameters.length / 6) }]
    if (query.startsWith('select ')) return pending.shift() ?? []
    updates.push({ query, parameters, doc: JSON.parse(String(parameters[0])) as Record<string, unknown> })
    return [{ id: parameters[1] }]
  })
  const getConnection = jest.fn(() => ({ execute }))
  const find = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => definitions.filter((entry) => matchesDefinition(entry, where)))
  const em = { find, getConnection } as unknown as EntityManager
  let storedKey = key
  const getTenantDek = jest.fn(async (targetTenantId: string): Promise<TenantDek | null> => storedKey
    ? { tenantId: targetTenantId, key: storedKey, fetchedAt: Date.now() }
    : null)
  const createTenantDek = jest.fn(async (targetTenantId: string): Promise<TenantDek> => {
    storedKey = currentKey
    return { tenantId: targetTenantId, key: currentKey, fetchedAt: Date.now() }
  })
  const kms: KmsService = { getTenantDek, createTenantDek, isHealthy: () => true }
  const service = new TenantDataEncryptionService(em, { kms })
  service.invalidateDek(tenantId)
  const options: Parameters<typeof rotateCustomEntityDocuments>[1] = { encryptionService: service, tenantId, organizationId, dryRun: false, oldKms: null }
  return { em, execute, updates, service, options, createTenantDek, getTenantDek, getConnection }
}

function row(doc: Record<string, unknown>, overrides: Partial<Row> = {}): Row {
  return { id: 'row-001', entity_type: entityId, tenant_id: tenantId, organization_id: organizationId, doc, ...overrides }
}

function oldKms(): KmsService {
  return {
    isHealthy: () => true,
    getTenantDek: async (targetTenantId) => ({ tenantId: targetTenantId, key: oldKey, fetchedAt: Date.now() }),
    createTenantDek: async () => { throw new Error('[internal] Old key must never be provisioned') },
  }
}

describe('custom entity document encryption rotation', () => {
  const originalEncryption = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterAll(() => {
    if (originalEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalEncryption
  })

  test('does not open document storage when no custom field definitions exist', async () => {
    const setup = fixture([], [])
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(0)
    expect(setup.getConnection).not.toHaveBeenCalled()
    expect(setup.getTenantDek).not.toHaveBeenCalled()
  })

  test('backfills legacy scalar and array fields with real AES while retaining types and unrelated values', async () => {
    const definitions = [definition('code'), definition('amount', 'integer'), definition('enabled', 'boolean'), definition('tags', 'text')]
    const original = { id: 'record-1', 'cf:code': '123', cf_amount: 0, enabled: false, 'cf:tags': ['first', null, 'true'], public: 'visible' }
    const setup = fixture(definitions, [[row(original)]])

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)

    const encrypted = setup.updates[0]!.doc
    expect(encrypted.public).toBe('visible')
    expect(encrypted.id).toBe('record-1')
    expect(isEncryptedPayloadShape(encrypted['cf:code'])).toBe(true)
    expect(encrypted['cf:tags']).toEqual([expect.any(String), null, expect.any(String)])
    const fields = definitions.map((entry) => ({ key: entry.key, kind: entry.kind, encrypted: true }))
    await expect(decryptCustomEntityDocument(encrypted, fields, tenantId, setup.service)).resolves.toEqual(original)
    expect(setup.updates[0]!.query).toContain('tenant_id is not distinct from ? and organization_id is not distinct from ?')
    expect(setup.updates[0]!.parameters.slice(1, 5)).toEqual(['row-001', entityId, tenantId, organizationId])
    expect(setup.updates[0]!.parameters[5]).toBe(JSON.stringify(original))
  })

  test('rotates old-key ciphertext, retains current ciphertext, and leaves plaintext alone in rotation mode', async () => {
    const currentCiphertext = encryptWithAesGcm('current', currentKey).value!
    const oldCiphertext = encryptWithAesGcm('123', oldKey).value!
    const definitions = [definition('code'), definition('tags'), definition('amount', 'integer')]
    const setup = fixture(definitions, [[row({
      'cf:code': oldCiphertext,
      'cf:tags': [encryptWithAesGcm('old', oldKey).value, currentCiphertext, 'legacy', null],
      'cf:amount': encryptWithAesGcm('12', oldKey).value,
    })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)

    const next = setup.updates[0]!.doc
    expect(decryptWithAesGcm(String(next['cf:code']), currentKey)).toBe('123')
    expect(decryptWithAesGcm(String(next['cf:code']), oldKey)).toBeNull()
    expect(next['cf:tags']).toEqual([expect.any(String), currentCiphertext, 'legacy', null])
    await expect(decryptCustomEntityDocument(next, definitions.map((entry) => ({ key: entry.key, kind: entry.kind, encrypted: true })), tenantId, setup.service))
      .resolves.toEqual({ 'cf:code': '123', 'cf:tags': ['old', 'current', 'legacy', null], 'cf:amount': 12 })
  })

  test('does not rewrite already-current ciphertext', async () => {
    const currentCiphertext = encryptWithAesGcm('current', currentKey).value!
    const setup = fixture([definition('code')], [[row({ 'cf:code': currentCiphertext })]])
    setup.options.oldKms = oldKms()
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(0)
    expect(setup.updates).toHaveLength(0)
  })

  test('rotates encrypted empty strings and retains current empty-string ciphertext', async () => {
    const currentEmpty = encryptWithAesGcm('', currentKey).value!
    const setup = fixture([definition('code'), definition('tags')], [[row({
      'cf:code': encryptWithAesGcm('', oldKey).value,
      'cf:tags': [currentEmpty],
    })]])
    setup.options.oldKms = oldKms()
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)
    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:code']), currentKey)).toBe('')
    expect(setup.updates[0]!.doc['cf:tags']).toEqual([currentEmpty])
  })

  test('refuses an empty-string envelope sealed under an unknown key', async () => {
    const setup = fixture([definition('code')], [[row({ 'cf:code': encryptWithAesGcm('', unknownKey).value })]])
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).rejects.toMatchObject({ code: 'WRONG_KEY' })
    expect(setup.updates).toHaveLength(0)
  })

  test.each([false, true])('refuses unknown ciphertext without changing the row (dryRun=%s)', async (dryRun) => {
    const secret = encryptWithAesGcm('must-never-be-nested', unknownKey).value!
    const setup = fixture([definition('code')], [[row({ 'cf:code': secret })]])
    setup.options.oldKms = oldKms()
    setup.options.dryRun = dryRun
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).rejects.toMatchObject({ code: 'WRONG_KEY' })
    expect(setup.updates).toHaveLength(0)
    expect(setup.createTenantDek).not.toHaveBeenCalled()
  })

  test('previews plaintext without creating a missing tenant key or writing storage', async () => {
    const setup = fixture([definition('code')], [[row({ 'cf:code': 'legacy' })]], null)
    setup.options.dryRun = true
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)
    expect(setup.getTenantDek).toHaveBeenCalled()
    expect(setup.createTenantDek).not.toHaveBeenCalled()
    expect(setup.updates).toHaveLength(0)
  })

  test('previews old-key rotation without creating a missing current key', async () => {
    const setup = fixture([definition('code')], [[row({ 'cf:code': encryptWithAesGcm('old', oldKey).value })]], null)
    setup.options.oldKms = oldKms()
    setup.options.dryRun = true
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)
    expect(setup.createTenantDek).not.toHaveBeenCalled()
    expect(setup.updates).toHaveLength(0)
  })

  test('provisions the current key only for a real backfill', async () => {
    const setup = fixture([definition('code')], [[row({ 'cf:code': 'legacy' })]], null)
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)
    expect(setup.createTenantDek).toHaveBeenCalledTimes(1)
    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:code']), currentKey)).toBe('legacy')
  })

  test('honors a plaintext organization override over an encrypted tenant-wide definition', async () => {
    const forgedEnvelope = encryptWithAesGcm('ordinary user data', unknownKey).value!
    const setup = fixture([
      definition('code', 'text', { organizationId: null }),
      definition('code', 'text', { configJson: { encrypted: false } }),
      definition('secret'),
    ], [[row({ 'cf:code': forgedEnvelope, 'cf:secret': encryptWithAesGcm('protected', oldKey).value })]])
    setup.options.oldKms = oldKms()
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)
    expect(setup.updates[0]!.doc['cf:code']).toBe(forgedEnvelope)
    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:secret']), currentKey)).toBe('protected')
    expect(setup.execute.mock.calls[0]![0]).toContain('tenant_id = ? and organization_id = ?')
    expect(setup.execute.mock.calls.find(([query]) => query.startsWith('select id'))![1]).toEqual([tenantId, organizationId])
  })

  test.each([
    {
      basis: 'scope specificity',
      broader: { organizationId: null, isActive: false },
      winner: { isActive: false, configJson: { encrypted: false } },
    },
    {
      basis: 'recency',
      broader: { deletedAt: new Date(), updatedAt: new Date('2026-01-01') },
      winner: { deletedAt: new Date(), updatedAt: new Date('2026-02-01'), configJson: { encrypted: false } },
    },
  ])('resolves historical plaintext definitions by $basis before enforcing ciphertext keys', async ({ broader, winner }) => {
    const forgedEnvelope = encryptWithAesGcm('ordinary user data', unknownKey).value!
    const setup = fixture([
      definition('code', 'text', broader),
      definition('code', 'text', winner),
      definition('secret'),
    ], [[row({ 'cf:code': forgedEnvelope, 'cf:secret': encryptWithAesGcm('protected', oldKey).value })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)

    expect(setup.updates[0]!.doc['cf:code']).toBe(forgedEnvelope)
    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:secret']), currentKey)).toBe('protected')
  })

  test('enforces the newer historical protected definition over an older plaintext definition', async () => {
    const setup = fixture([
      definition('code', 'text', { isActive: false, updatedAt: new Date('2026-01-01'), configJson: { encrypted: false } }),
      definition('code', 'text', { isActive: false, updatedAt: new Date('2026-02-01') }),
    ], [[row({ 'cf:code': encryptWithAesGcm('unavailable ciphertext', unknownKey).value })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).rejects.toMatchObject({ code: 'WRONG_KEY' })

    expect(setup.updates).toHaveLength(0)
  })

  test.each([
    { state: 'inactive', overrides: { isActive: false } },
    { state: 'soft-deleted', overrides: { deletedAt: new Date('2026-10-01T00:00:00.000Z') } },
  ])('rotates $state fields so restoring their definitions retains readable values and types', async ({ overrides }) => {
    const definitions = [definition('code', 'text', overrides), definition('amount', 'integer', overrides)]
    const setup = fixture(definitions, [[row({
      'cf:code': encryptWithAesGcm('123', oldKey).value,
      'cf:amount': encryptWithAesGcm('12', oldKey).value,
    })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)

    for (const entry of definitions) {
      entry.isActive = true
      entry.deletedAt = null
    }
    const fields = definitions.map((entry) => ({ key: entry.key, kind: entry.kind, encrypted: true }))
    await expect(decryptCustomEntityDocument(setup.updates[0]!.doc, fields, tenantId, setup.service))
      .resolves.toEqual({ 'cf:code': '123', 'cf:amount': 12 })
    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:amount']), oldKey)).toBeNull()
  })

  test('preserves raw decrypted bytes when a deleted field kind no longer describes its stored value', async () => {
    const previousBytes = ' 1e+03 '
    const setup = fixture([definition('amount', 'text', { deletedAt: new Date() })], [[row({
      'cf:amount': encryptWithAesGcm(previousBytes, oldKey).value,
    })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)

    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:amount']), currentKey)).toBe(previousBytes)
    await expect(decryptCustomEntityDocument(setup.updates[0]!.doc, [{ key: 'amount', kind: 'integer', encrypted: true }], tenantId, setup.service))
      .resolves.toEqual({ 'cf:amount': 1000 })
  })

  test('rotates stored ciphertext after the encrypted flag is removed without sealing plaintext fields', async () => {
    const definitions = [definition('code', 'text', { configJson: { encrypted: false } }), definition('tags', 'text', { configJson: { encrypted: false } })]
    const currentCiphertext = encryptWithAesGcm('current', currentKey).value!
    const setup = fixture(definitions, [[row({
      'cf:code': encryptWithAesGcm('123', oldKey).value,
      'cf:tags': [encryptWithAesGcm('old', oldKey).value, 'leave plaintext', currentCiphertext, null],
      public: 'unchanged',
    })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)

    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:code']), currentKey)).toBe('123')
    expect(setup.updates[0]!.doc['cf:tags']).toEqual([expect.any(String), 'leave plaintext', currentCiphertext, null])
    expect(setup.updates[0]!.doc.public).toBe('unchanged')
  })

  test('leaves forged envelopes in never-encrypted fields untouched while rotating protected values', async () => {
    const forgedEnvelope = encryptWithAesGcm('ciphertext-looking user input', unknownKey).value!
    const setup = fixture([
      definition('secret'),
      definition('plain', 'text', { configJson: { encrypted: false } }),
      definition('tags', 'text', { configJson: { encrypted: false } }),
    ], [[row({
      'cf:secret': encryptWithAesGcm('protected', oldKey).value,
      'cf:plain': forgedEnvelope,
      'cf:tags': [forgedEnvelope, 'ordinary text'],
    })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)

    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:secret']), currentKey)).toBe('protected')
    expect(setup.updates[0]!.doc['cf:plain']).toBe(forgedEnvelope)
    expect(setup.updates[0]!.doc['cf:tags']).toEqual([forgedEnvelope, 'ordinary text'])
  })

  test.each([false, true])('never-encrypted envelope-looking plaintext does not block rotation (dryRun=%s)', async (dryRun) => {
    const forgedEnvelope = encryptWithAesGcm('ordinary user data', unknownKey).value!
    const setup = fixture([definition('plain', 'text', { configJson: { encrypted: false } })], [[row({ 'cf:plain': forgedEnvelope })]])
    setup.options.oldKms = oldKms()
    setup.options.dryRun = dryRun

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(0)

    expect(setup.updates).toHaveLength(0)
    expect(setup.createTenantDek).not.toHaveBeenCalled()
  })

  test('still rejects unopenable ciphertext for historically encrypted inactive fields', async () => {
    const setup = fixture([definition('secret', 'text', { isActive: false })], [[row({
      'cf:secret': encryptWithAesGcm('historically protected', unknownKey).value,
    })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).rejects.toMatchObject({ code: 'WRONG_KEY' })

    expect(setup.updates).toHaveLength(0)
  })

  test('does not backfill plaintext belonging to inactive, deleted, or newly plain fields', async () => {
    const setup = fixture([
      definition('inactive', 'text', { isActive: false }),
      definition('deleted', 'text', { deletedAt: new Date() }),
      definition('plain', 'text', { configJson: { encrypted: false } }),
    ], [[row({ 'cf:inactive': 'legacy', 'cf:deleted': 'legacy', 'cf:plain': 'public' })]])

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(0)

    expect(setup.getTenantDek).not.toHaveBeenCalled()
    expect(setup.createTenantDek).not.toHaveBeenCalled()
    expect(setup.updates).toHaveLength(0)
  })

  test('keeps historical discovery within the selected tenant and does not open foreign document storage', async () => {
    const setup = fixture([definition('code', 'text', { tenantId: 'foreign-tenant', isActive: false, deletedAt: new Date() })], [[row({
      'cf:code': encryptWithAesGcm('foreign', oldKey).value,
    }, { tenant_id: 'foreign-tenant' })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(0)

    expect(setup.getConnection).not.toHaveBeenCalled()
    expect(setup.getTenantDek).not.toHaveBeenCalled()
    expect(setup.updates).toHaveLength(0)
  })

  test('rotates historical ciphertext even when the effective organization definition is now plaintext', async () => {
    const setup = fixture([
      definition('code', 'integer', { organizationId: null }),
      definition('code', 'text', { configJson: { encrypted: false } }),
    ], [[row({ 'cf:code': encryptWithAesGcm('123', oldKey).value })]])
    setup.options.oldKms = oldKms()

    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)

    expect(decryptWithAesGcm(String(setup.updates[0]!.doc['cf:code']), currentKey)).toBe('123')
  })

  test('updates organization-global rows with an exact null organization scope', async () => {
    const setup = fixture([definition('code', 'text', { organizationId: null })], [[row({ 'cf:code': 'legacy' }, { organization_id: null })]])
    setup.options.organizationId = null
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)
    expect(setup.updates[0]!.parameters[4]).toBeNull()
  })

  test('keyset pages through all selected documents', async () => {
    const firstPage = Array.from({ length: 8 }, (_, index) => row({}, { id: `row-${String(index).padStart(3, '0')}` }))
    const setup = fixture([definition('code')], [firstPage, [row({ 'cf:code': 'legacy' }, { id: 'row-008' })]])
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)
    const selections = setup.execute.mock.calls.filter(([query]) => query.startsWith('select id'))
    expect(selections[1]![0]).toContain('id > ? order by id asc limit 8')
    expect(selections[1]![1]).toEqual([tenantId, organizationId, 'row-007'])
  })

  test('advances a full ineligible PK frontier before rotating a later eligible document', async () => {
    const skipped = Array.from({ length: 8 }, (_, index) => ({ ...row({}, { id: `row-${index}` }), doc: null, rotation_eligible: false }))
    const setup = fixture([definition('code')], [skipped as unknown as Row[], [row({ 'cf:code': 'legacy' }, { id: 'row-8' })]])
    const checkpointBatch = jest.fn()
    await expect(rotateCustomEntityDocuments(setup.em, { ...setup.options, checkpointBatch })).resolves.toBe(1)
    expect(checkpointBatch.mock.calls[0]![0]).toMatchObject({ cursor: ['row-7'], readRows: 8, writtenRows: 0 })
    expect(setup.updates).toHaveLength(1)
    const query = setup.execute.mock.calls.find(([sql]) => sql.startsWith('select id'))![0]
    expect(query.indexOf('limit 8')).toBeLessThan(query.indexOf('exists (select'))
    expect(query).toContain('left join lateral')
    expect(query).toContain('s.id = e.id and e.rotation_eligible offset 0')
  })

  test('refuses to overwrite a document changed during rotation', async () => {
    const setup = fixture([definition('code')], [[row({ 'cf:code': 'legacy' })]])
    setup.execute.mockImplementationOnce(async () => [])
    setup.execute.mockImplementationOnce(async () => [row({ 'cf:code': 'legacy' })])
    setup.execute.mockImplementationOnce(async () => [])
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).rejects.toThrow('document changed during encryption')
  })
  test('persists the exact protected timestamp after the durable intent callback', async () => {
    const original = '2026-11-12 10:11:12.123456+00'
    const timestamp = new Date('2026-11-12T11:22:33.444Z')
    const setup = fixture([definition('code')], [[row({ 'cf:code': 'legacy' }, { updated_at: original })]])
    const intent = jest.fn(async () => {
      expect(setup.updates).toHaveLength(0)
      return timestamp
    })
    setup.options.timestampForWrite = intent
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).resolves.toBe(1)
    expect(intent).toHaveBeenCalledWith({ table: 'custom_entities_storage', identity: 'row-001', tenantId, organizationId, previousTimestamp: original })
    expect(setup.updates[0]!.query).toContain('updated_at = ?')
    expect(setup.updates[0]!.parameters[1]).toBe(timestamp)
  })

  test('timestamp-intent failure prevents mutation', async () => {
    const setup = fixture([definition('code')], [[row({ 'cf:code': 'legacy' })]])
    setup.options.timestampForWrite = async () => { throw new Error('intent not durable') }
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).rejects.toThrow('intent not durable')
    expect(setup.updates).toHaveLength(0)
  })

  test('unsupported definition inventory refuses before document contents are fetched', async () => {
    const setup = fixture(Array.from({ length: 501 }, (_, n) => definition(`field_${n}`)), [])
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).rejects.toThrow('inventory exceeds')
    expect(setup.getConnection).not.toHaveBeenCalled()
  })

  test('oversized document preflight prevents fetching and mutating its contents', async () => {
    const setup = fixture([definition('code')], [])
    setup.execute.mockResolvedValueOnce([{ oversized: 1 }] as never)
    await expect(rotateCustomEntityDocuments(setup.em, setup.options)).rejects.toThrow('supported maintenance size')
    expect(setup.execute).toHaveBeenCalledTimes(1)
    expect(setup.updates).toHaveLength(0)
  })

  test('resumes from a committed cursor and checkpoints only after persisted batch readback',async()=>{
    const setup=fixture([definition('code')],[[row({'cf:code':'legacy'},{id:'row-002'})]])
    setup.options.resumeCursor=jest.fn(async()=>['row-001'])
    setup.options.timestampForWrite=async()=>new Date('2026-01-02T00:00:00Z')
    const checkpoint=jest.fn(async()=>{
      const calls=setup.execute.mock.calls
      expect(calls[calls.length-1]![0]).toContain('select count(*)::text as verified')
    })
    setup.options.checkpointBatch=checkpoint
    await rotateCustomEntityDocuments(setup.em,setup.options)
    expect(setup.execute.mock.calls.find(([sql])=>sql.startsWith('select id'))![1]).toContain('row-001')
    expect(checkpoint).toHaveBeenCalledWith({operationId:JSON.stringify(['custom-documents-v1',tenantId,organizationId]),cursor:['row-002'],readRows:1,writtenRows:1})
  })
  test('failed persisted readback never advances the durable custom cursor',async()=>{
    const setup=fixture([definition('code')],[[row({'cf:code':'legacy'})]])
    const original=setup.execute.getMockImplementation()!
    setup.execute.mockImplementation(async(sql,params)=>sql.startsWith('select count(*)::text as verified')?[{verified:'0'}]:original(sql,params))
    setup.options.timestampForWrite=async()=>new Date('2026-01-02T00:00:00Z')
    setup.options.checkpointBatch=jest.fn()
    await expect(rotateCustomEntityDocuments(setup.em,setup.options)).rejects.toThrow('Persisted custom document batch')
    expect(setup.options.checkpointBatch).not.toHaveBeenCalled()
  })

  test('timestamp batch intents cover actual writes and never authorize an unchanged current-key row',async()=>{
    const current=encryptWithAesGcm('already-current',currentKey).value!
    const setup=fixture([definition('code')],[[row({'cf:code':current},{id:'row-001'}),row({'cf:code':'legacy'},{id:'row-002'})]])
    const timestamp=new Date('2026-01-02T00:00:00Z')
    setup.options.timestampForBatchWrite=jest.fn(async intents=>{
      expect(setup.updates).toHaveLength(0)
      expect(intents.map(intent=>intent.identity)).toEqual(['row-002'])
      return [timestamp]
    })
    await expect(rotateCustomEntityDocuments(setup.em,setup.options)).resolves.toBe(1)
    expect(setup.options.timestampForBatchWrite).toHaveBeenCalledTimes(1)
    expect(setup.updates[0]!.query).toContain('updated_at is not distinct from ?')
  })

  test('an ambiguous committed write replays from the old cursor without rewriting current ciphertext',async()=>{
    const first=fixture([definition('code')],[[row({'cf:code':'legacy'})]])
    const original=first.execute.getMockImplementation()!
    first.execute.mockImplementation(async(sql,parameters)=>{
      if(sql.startsWith('select count(*)::text as verified'))throw new Error('connection lost after commit')
      return original(sql,parameters)
    })
    first.options.timestampForWrite=async()=>new Date('2026-01-02T00:00:00Z')
    first.options.checkpointBatch=jest.fn()
    await expect(rotateCustomEntityDocuments(first.em,first.options)).rejects.toThrow('after commit')
    expect(first.updates).toHaveLength(1);expect(first.options.checkpointBatch).not.toHaveBeenCalled()
    const resumed=fixture([definition('code')],[[row(first.updates[0]!.doc)]])
    resumed.options.resumeCursor=async()=>['row-000']
    resumed.options.timestampForBatchWrite=jest.fn()
    resumed.options.checkpointBatch=jest.fn()
    await expect(rotateCustomEntityDocuments(resumed.em,resumed.options)).resolves.toBe(0)
    expect(resumed.updates).toHaveLength(0);expect(resumed.options.timestampForBatchWrite).not.toHaveBeenCalled()
    expect(resumed.options.checkpointBatch).toHaveBeenCalledWith(expect.objectContaining({cursor:['row-001'],writtenRows:0,readRows:1}))
  })

})
