import { randomUUID } from 'node:crypto'
import { MetadataStorage } from '@mikro-orm/core'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { defaultEncryptionMaps } from '../encryption'
import * as aiAssistantEntities from '../data/entities'

const MODULE_ID = 'ai_assistant'

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
  properties?: Record<string, { name?: string; fieldName?: string }>
}

function collectRegisteredEntities(): Map<string, Set<string>> {
  void aiAssistantEntities
  const registered = new Map<string, Set<string>>()
  for (const meta of Object.values(MetadataStorage.getMetadata()) as EntityMetadataLike[]) {
    if (!meta.className) continue
    const columns = new Set<string>()
    for (const [propertyName, property] of Object.entries(meta.properties ?? {})) {
      columns.add(property.fieldName ?? toSnake(property.name ?? propertyName))
    }
    registered.set(`${MODULE_ID}:${toSnake(meta.className)}`, columns)
  }
  return registered
}

function fieldsOf(entityId: string): string[] {
  const map = defaultEncryptionMaps.find((entry) => entry.entityId === entityId)
  return (map?.fields ?? []).map((field) => (typeof field === 'string' ? field : field.field))
}

describe('ai_assistant encryption maps', () => {
  const registered = collectRegisteredEntities()

  it('encrypts chat message content and its structured payloads', () => {
    expect(fieldsOf('ai_assistant:ai_chat_message')).toEqual([
      'content',
      'ui_parts',
      'files_metadata',
      'metadata',
    ])
  })

  it('encrypts the conversation title', () => {
    expect(fieldsOf('ai_assistant:ai_chat_conversation')).toEqual(['title'])
  })

  it('encrypts the pending-action mutation payloads', () => {
    expect(fieldsOf('ai_assistant:ai_pending_action')).toEqual([
      'normalized_input',
      'field_diff',
      'records',
    ])
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

describe('ai_assistant encryption maps applied by the tenant encryption service', () => {
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
    const connection = {
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
    const em = { getConnection: () => connection }
    return new TenantDataEncryptionService(em as never, { kms })
  }

  it('stores chat message content and payloads as ciphertext and restores them on read', async () => {
    const service = createService()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const message = {
      conversation_id: 'conv-1',
      role: 'user',
      content: 'Raise the credit limit for ACME to 50k',
      ui_parts: [{ componentId: 'field-diff-card', props: { field: 'creditLimit' } }],
      files_metadata: [{ name: 'contract.pdf' }],
      metadata: { note: 'customer asked by phone' },
    }

    const encrypted = await service.encryptEntityPayload('ai_assistant:ai_chat_message', message, tenantId, organizationId)

    for (const field of ['content', 'ui_parts', 'files_metadata', 'metadata'] as const) {
      expect(isEncryptedPayloadShape(encrypted[field])).toBe(true)
      expect(String(encrypted[field])).not.toContain('ACME')
    }
    expect(encrypted.conversation_id).toBe('conv-1')
    expect(encrypted.role).toBe('user')

    const decrypted = await service.decryptEntityPayload('ai_assistant:ai_chat_message', encrypted, tenantId, organizationId)
    expect(decrypted.content).toBe(message.content)
    expect(JSON.parse(String(decrypted.ui_parts))).toEqual(message.ui_parts)
    expect(JSON.parse(String(decrypted.metadata))).toEqual(message.metadata)
  })

  it('stores pending-action mutation payloads as ciphertext', async () => {
    const service = createService()
    const encrypted = await service.encryptEntityPayload(
      'ai_assistant:ai_pending_action',
      {
        tool_name: 'customers.update_company',
        normalized_input: { name: 'ACME Holdings' },
        field_diff: [{ field: 'name', before: 'ACME', after: 'ACME Holdings' }],
        records: [{ recordId: 'rec-1', label: 'ACME' }],
      },
      randomUUID(),
      randomUUID(),
    )

    for (const field of ['normalized_input', 'field_diff', 'records'] as const) {
      expect(isEncryptedPayloadShape(encrypted[field])).toBe(true)
    }
    expect(encrypted.tool_name).toBe('customers.update_company')
  })

  it('stores the conversation title as ciphertext', async () => {
    const service = createService()
    const encrypted = await service.encryptEntityPayload(
      'ai_assistant:ai_chat_conversation',
      { title: 'ACME credit review', agent_id: 'customers.account_assistant' },
      randomUUID(),
      randomUUID(),
    )

    expect(isEncryptedPayloadShape(encrypted.title)).toBe(true)
    expect(encrypted.agent_id).toBe('customers.account_assistant')
  })
})
