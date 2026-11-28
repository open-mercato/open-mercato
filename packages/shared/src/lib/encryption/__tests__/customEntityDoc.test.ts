import { decryptWithAesGcm, encryptWithAesGcm, isEncryptedPayloadShape, TenantDataEncryptionErrorCode } from '../aes'
import { decryptCustomEntityDocument, encryptCustomEntityDocument, type CustomEntityDocumentField } from '../customEntityDoc'
import type { TenantDataEncryptionService } from '../tenantDataEncryptionService'

const tenantId = 'tenant-document-test'
const key = Buffer.alloc(32, 17).toString('base64')
const fields: CustomEntityDocumentField[] = [
  { key: 'code', kind: 'text', encrypted: true },
  { key: 'count', kind: 'integer', encrypted: true },
  { key: 'enabled', kind: 'boolean', encrypted: true },
  { key: 'tags', kind: 'text', encrypted: true },
  { key: 'title', kind: 'text', encrypted: false },
]

function buildService(options: { enabled?: boolean; missingKey?: boolean; cannotCreate?: boolean } = {}) {
  const dek = { tenantId, key, fetchedAt: 0 }
  let current = options.missingKey ? null : dek
  const mock = {
    isEnabled: () => options.enabled !== false,
    getDek: jest.fn(async () => current),
    createDek: jest.fn(async () => {
      current = options.cannotCreate ? null : dek
      return current
    }),
  }
  return { service: mock as unknown as TenantDataEncryptionService, mock }
}

describe('custom entity document encryption', () => {
  const previousToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeEach(() => { process.env.TENANT_DATA_ENCRYPTION = 'yes' })
  afterEach(() => {
    if (previousToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = previousToggle
  })

  test('seals bare and prefixed keys while preserving array shape, null and scalar kinds', async () => {
    const { service } = buildService()
    const doc = { id: 'record-1', code: '123', 'cf:count': 12, cf_enabled: true, 'cf:tags': ['true', '123', null], title: 'Visible title', extra: null }
    const encrypted = await encryptCustomEntityDocument(doc, fields, tenantId, service)

    expect(doc.code).toBe('123')
    expect(encrypted.id).toBe('record-1')
    expect(encrypted.title).toBe('Visible title')
    expect(encrypted.extra).toBeNull()
    for (const field of ['code', 'cf:count', 'cf_enabled']) expect(isEncryptedPayloadShape(encrypted[field])).toBe(true)
    expect(encrypted['cf:tags']).toEqual([expect.any(String), expect.any(String), null])
    expect(await decryptCustomEntityDocument(encrypted, fields, tenantId, service)).toEqual(doc)
  })

  test('retains authenticated ciphertext and seals legacy plaintext without nesting envelopes', async () => {
    const { service } = buildService()
    const ciphertext = encryptWithAesGcm('already sealed', key).value
    const doc = { code: ciphertext, tags: ['legacy plaintext', ciphertext] }
    const encrypted = await encryptCustomEntityDocument(doc, fields, tenantId, service)

    expect(encrypted.code).toBe(ciphertext)
    expect((encrypted.tags as unknown[])[1]).toBe(ciphertext)
    expect(await decryptCustomEntityDocument(encrypted, fields, tenantId, service)).toEqual({ code: 'already sealed', tags: ['legacy plaintext', 'already sealed'] })
  })

  test('reads legacy plaintext without coercing text and leaves undefined or null values untouched', async () => {
    const { service } = buildService()
    const doc = { code: '123', count: 8, enabled: false, tags: null, title: undefined }
    expect(await decryptCustomEntityDocument(doc, fields, tenantId, service)).toEqual(doc)
    const encrypted = await encryptCustomEntityDocument({ code: null, tags: [null], count: undefined }, fields, tenantId, service)
    expect(encrypted).toEqual({ code: null, tags: [null], count: undefined })
  })

  test('creates a missing tenant key once before sealing the document', async () => {
    const { service, mock } = buildService({ missingKey: true })
    const encrypted = await encryptCustomEntityDocument({ code: 'private', tags: ['first', 'second'] }, fields, tenantId, service)
    expect(mock.createDek).toHaveBeenCalledTimes(1)
    expect(decryptWithAesGcm(String(encrypted.code), key)).toBe('private')
  })

  test('rejects ciphertext sealed under another key instead of wrapping it', async () => {
    const { service } = buildService()
    const ciphertext = encryptWithAesGcm('private', Buffer.alloc(32, 31).toString('base64')).value
    await expect(encryptCustomEntityDocument({ code: ciphertext }, fields, tenantId, service)).rejects.toMatchObject({ code: TenantDataEncryptionErrorCode.WRONG_KEY })
  })

  test.each([
    ['missing tenant', null, {}],
    ['disabled service', tenantId, { enabled: false }],
    ['unavailable key', tenantId, { missingKey: true, cannotCreate: true }],
  ] as const)('fails closed for protected values with %s', async (_label, scope, options) => {
    const { service } = buildService(options)
    await expect(encryptCustomEntityDocument({ code: 'private' }, fields, scope, service)).rejects.toMatchObject({ code: TenantDataEncryptionErrorCode.KMS_UNAVAILABLE })
  })

  test('does not require a key for unprotected fields or encryption-off mode', async () => {
    const { service, mock } = buildService({ enabled: false })
    expect(await encryptCustomEntityDocument({ title: 'public' }, fields, tenantId, service)).toEqual({ title: 'public' })
    process.env.TENANT_DATA_ENCRYPTION = 'no'
    expect(await encryptCustomEntityDocument({ code: 'private' }, fields, tenantId, service)).toEqual({ code: 'private' })
    expect(mock.getDek).not.toHaveBeenCalled()
    expect(mock.createDek).not.toHaveBeenCalled()
  })
})
