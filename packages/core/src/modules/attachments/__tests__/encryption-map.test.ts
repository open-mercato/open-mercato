import { randomUUID } from 'node:crypto'
import { MetadataStorage } from '@mikro-orm/core'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { defaultEncryptionMaps } from '../encryption'
import * as attachmentEntities from '../data/entities'

const MODULE_ID = 'attachments'

function toSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\W+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/(?:^_+|_+$)/g, '')
    .toLowerCase()
}

type EntityMetadataLike = {
  className?: string
  properties?: Record<string, { name?: string; fieldName?: string; fieldNames?: string[] }>
}

function collectRegisteredEntities(): Map<string, Set<string>> {
  void attachmentEntities
  const registered = new Map<string, Set<string>>()
  for (const meta of Object.values(MetadataStorage.getMetadata()) as EntityMetadataLike[]) {
    if (!meta.className) continue
    const columns = new Set<string>()
    for (const [propertyName, property] of Object.entries(meta.properties ?? {})) {
      columns.add(property.fieldName ?? property.fieldNames?.[0] ?? toSnake(property.name ?? propertyName))
    }
    registered.set(`${MODULE_ID}:${toSnake(meta.className)}`, columns)
  }
  return registered
}

function fieldsOf(entityId: string): string[] {
  const map = defaultEncryptionMaps.find((entry) => entry.entityId === entityId)
  return (map?.fields ?? []).map((field) => (typeof field === 'string' ? field : field.field))
}

describe('attachments encryption maps', () => {
  const registered = collectRegisteredEntities()

  it('encrypts the extraction reference text and failure reason', () => {
    expect(fieldsOf('attachments:attachment_document_extraction')).toEqual(['normalized_text', 'failure_reason'])
  })

  it('encrypts section heading, heading path and text', () => {
    expect(fieldsOf('attachments:attachment_document_section')).toEqual(['heading', 'heading_path', 'text'])
  })

  it('keeps structural locator columns plaintext', () => {
    const sectionFields = fieldsOf('attachments:attachment_document_section')
    for (const column of ['number_label', 'anchor_key', 'page_start', 'page_end', 'char_start', 'char_end', 'text_sha256']) {
      expect(sectionFields).not.toContain(column)
    }
  })

  it('keeps every map tenant-scoped so rows seal under the tenant key', () => {
    for (const map of defaultEncryptionMaps) {
      expect(map.keyScope).toBeUndefined()
    }
  })

  it.each(defaultEncryptionMaps.map((map) => [map.entityId, map] as const))(
    'resolves %s to a registered entity and its columns',
    (entityId, map) => {
      const columns = registered.get(entityId)
      expect(columns).toBeDefined()
      const unknownFields = map.fields
        .map((field) => (typeof field === 'string' ? field : field.field))
        .filter((field) => !columns?.has(field))
      expect(unknownFields).toEqual([])
    },
  )
})

describe('attachments encryption maps applied by the tenant encryption service', () => {
  const dekKey = Buffer.alloc(32, 7).toString('base64')
  const originalToggle = process.env.TENANT_DATA_ENCRYPTION

  beforeAll(() => {
    process.env.TENANT_DATA_ENCRYPTION = 'yes'
  })

  afterAll(() => {
    if (originalToggle === undefined) delete process.env.TENANT_DATA_ENCRYPTION
    else process.env.TENANT_DATA_ENCRYPTION = originalToggle
  })

  function createService() {
    const em = {
      execute: async (_sql: string, params: unknown[]) => {
        const map = defaultEncryptionMaps.find((entry) => entry.entityId === params[0])
        return map ? [{ entity_id: map.entityId, fields_json: map.fields }] : []
      },
    }
    const kms: KmsService = {
      isHealthy: () => true,
      getTenantDek: async (tenantId) => ({ tenantId, key: dekKey, fetchedAt: Date.now() }),
      createTenantDek: async (tenantId) => ({ tenantId, key: dekKey, fetchedAt: Date.now() }),
    }
    return new TenantDataEncryptionService(em as never, { kms })
  }

  it('stores section content as ciphertext and leaves locator columns readable', async () => {
    const service = createService()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const section = {
      number_label: '§8.12',
      anchor_key: '0123456789abcdef0123456789abcdef',
      page_start: 3,
      heading: 'Confidential obligations',
      heading_path: ['Chapter 8', 'Confidential obligations'],
      text: 'The supplier shall keep the ACME pricing confidential.',
    }

    const encrypted = await service.encryptEntityPayload('attachments:attachment_document_section', section, tenantId, organizationId)

    for (const field of ['heading', 'heading_path', 'text'] as const) {
      expect(isEncryptedPayloadShape(encrypted[field])).toBe(true)
      expect(String(encrypted[field])).not.toContain('ACME')
    }
    expect(encrypted.number_label).toBe('§8.12')
    expect(encrypted.anchor_key).toBe(section.anchor_key)
    expect(encrypted.page_start).toBe(3)

    const decrypted = await service.decryptEntityPayload('attachments:attachment_document_section', encrypted, tenantId, organizationId)
    expect(decrypted.text).toBe(section.text)
    expect(decrypted.heading).toBe(section.heading)
  })

  it('stores the extraction normalized text as ciphertext', async () => {
    const service = createService()
    const encrypted = await service.encryptEntityPayload(
      'attachments:attachment_document_extraction',
      { status: 'completed', normalized_text: 'ACME rulebook body', failure_reason: '[internal] ACME parse failure' },
      randomUUID(),
      randomUUID(),
    )

    expect(isEncryptedPayloadShape(encrypted.normalized_text)).toBe(true)
    expect(isEncryptedPayloadShape(encrypted.failure_reason)).toBe(true)
    expect(encrypted.status).toBe('completed')
  })
})
