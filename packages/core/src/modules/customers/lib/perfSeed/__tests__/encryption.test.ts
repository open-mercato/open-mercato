const encryptCustomFieldValueMock = jest.fn(async (value: unknown) => `cf-enc:${String(value)}`)

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  encryptCustomFieldValue: (...args: unknown[]) => encryptCustomFieldValueMock(args[0]),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createRowEncryptor, customFieldColumnForKind, type CustomFieldDefIndex } from '../encryption'
import { ENCRYPTION_ENTITY_BY_TABLE, buildEntityBundle } from '../generator'
import type { CustomFieldDraft, SqlRow } from '../types'
import { buildTestContext, TEST_ORG_ID, TEST_TENANT_ID } from './fixtures'

const ENCRYPTED_ENTITY_FIELDS = ['display_name', 'primary_email', 'primary_phone', 'description', 'next_interaction_name']

function reverse(value: string): string {
  return Array.from(value).reverse().join('')
}

function createMockService(enabled = true) {
  const encryptEntityPayload = jest.fn(async (entityId: string, payload: Record<string, unknown>) => {
    if (entityId !== 'customers:customer_entity') return payload
    const output: Record<string, unknown> = { ...payload }
    for (const field of ENCRYPTED_ENTITY_FIELDS) {
      const value = output[field]
      if (typeof value === 'string') output[field] = `enc:${reverse(value)}`
    }
    if (typeof payload.primary_email === 'string') output.primaryEmailHash = `hash:${payload.primary_email}`
    return output
  })
  const decryptEntityPayload = jest.fn(async (_entityId: string, payload: Record<string, unknown>) => {
    const output: Record<string, unknown> = { ...payload }
    for (const field of ENCRYPTED_ENTITY_FIELDS) {
      const value = output[field]
      if (typeof value === 'string' && value.startsWith('enc:')) output[field] = reverse(value.slice(4))
    }
    return output
  })
  const service = {
    isEnabled: () => enabled,
    encryptEntityPayload,
    decryptEntityPayload,
  } as unknown as TenantDataEncryptionService
  return { service, encryptEntityPayload, decryptEntityPayload }
}

const emMarker = { marker: 'em' } as unknown as EntityManager

function buildEncryptor(service: TenantDataEncryptionService | null, defs: CustomFieldDefIndex = new Map(), withHashColumn = false) {
  const entityColumns = new Set([
    'id', 'organization_id', 'tenant_id', 'kind', 'display_name', 'description', 'owner_user_id', 'primary_email', 'primary_phone',
    'status', 'lifecycle_stage', 'source', 'temperature', 'renewal_quarter', 'next_interaction_at', 'next_interaction_name',
    'next_interaction_ref_id', 'next_interaction_icon', 'next_interaction_color', 'is_active', 'created_at', 'updated_at', 'deleted_at',
  ])
  if (withHashColumn) entityColumns.add('primary_email_hash')
  return createRowEncryptor({
    service,
    em: emMarker,
    scope: { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID },
    tableColumns: new Map([['customer_entities', entityColumns]]),
    customFieldDefs: defs,
    customFieldRowId: (draft) => `${draft.recordId}:${draft.fieldKey}`,
    createdAt: new Date('2026-11-26T00:00:00Z'),
  })
}

describe('perf seed encryption wiring', () => {
  beforeEach(() => encryptCustomFieldValueMock.mockClear())

  it('encrypts each row through encryptEntityPayload with the entity id, row scope and seeding em', async () => {
    const { service, encryptEntityPayload, decryptEntityPayload } = createMockService()
    const bundle = buildEntityBundle(buildTestContext(), 0)
    const plaintext = bundle.rows.customer_entities[0]
    const encryptor = buildEncryptor(service)
    const [stored] = await encryptor.encryptRows(ENCRYPTION_ENTITY_BY_TABLE.customer_entities, 'customer_entities', [plaintext])
    expect(encryptEntityPayload).toHaveBeenCalledWith('customers:customer_entity', expect.objectContaining({ id: plaintext.id }), TEST_TENANT_ID, TEST_ORG_ID, { em: emMarker })
    expect(stored.display_name).not.toBe(plaintext.display_name)
    expect(String(stored.display_name).startsWith('enc:')).toBe(true)
    expect(stored.status).toBe(plaintext.status)
    const roundTrip = await (service as unknown as { decryptEntityPayload: (entityId: string, payload: SqlRow) => Promise<SqlRow> })
      .decryptEntityPayload('customers:customer_entity', stored)
    expect(decryptEntityPayload).toHaveBeenCalled()
    for (const field of ENCRYPTED_ENTITY_FIELDS) expect(roundTrip[field]).toEqual(plaintext[field])
  })

  it('writes lookup hashes only into existing columns and reports the rest', async () => {
    const { service } = createMockService()
    const row = buildEntityBundle(buildTestContext(), 1).rows.customer_entities[0]
    const withColumn = buildEncryptor(service, new Map(), true)
    const [hashed] = await withColumn.encryptRows('customers:customer_entity', 'customer_entities', [row])
    expect(hashed.primary_email_hash).toBe(`hash:${row.primary_email}`)
    expect(withColumn.droppedColumns()).toEqual([])
    const withoutColumn = buildEncryptor(service)
    const [plain] = await withoutColumn.encryptRows('customers:customer_entity', 'customer_entities', [row])
    expect(plain).not.toHaveProperty('primary_email_hash')
    expect(withoutColumn.droppedColumns()).toEqual(['customer_entities.primary_email_hash'])
  })

  it('passes a null scope for link tables without tenant columns, like the ORM subscriber', async () => {
    const { service, encryptEntityPayload } = createMockService()
    const encryptor = buildEncryptor(service)
    await encryptor.encryptRows('customers:customer_deal_company_link', 'customer_deal_companies', [{ id: 'x', deal_id: 'd', company_entity_id: 'c', created_at: new Date() }])
    expect(encryptEntityPayload).toHaveBeenCalledWith('customers:customer_deal_company_link', expect.any(Object), null, null, { em: emMarker })
  })

  it('leaves rows untouched when encryption is disabled', async () => {
    const { service, encryptEntityPayload } = createMockService(false)
    const row = buildEntityBundle(buildTestContext(), 0).rows.customer_entities[0]
    const [stored] = await buildEncryptor(service).encryptRows('customers:customer_entity', 'customer_entities', [row])
    expect(stored).toBe(row)
    expect(encryptEntityPayload).not.toHaveBeenCalled()
    const [withoutService] = await buildEncryptor(null).encryptRows('customers:customer_entity', 'customer_entities', [row])
    expect(withoutService).toBe(row)
  })

  it('stores custom field values in the column the write path would pick and encrypts flagged definitions', async () => {
    const defs: CustomFieldDefIndex = new Map([
      ['customers:customer_person_profile', new Map([
        ['buying_role', { kind: 'select', encrypted: true }],
        ['newsletter_opt_in', { kind: 'boolean', encrypted: false }],
      ])],
      ['customers:customer_deal', new Map([['estimated_seats', { kind: 'integer', encrypted: false }]])],
    ])
    const drafts: CustomFieldDraft[] = [
      { entityId: 'customers:customer_person_profile', recordId: 'p1', fieldKey: 'buying_role', value: 'champion' },
      { entityId: 'customers:customer_person_profile', recordId: 'p1', fieldKey: 'newsletter_opt_in', value: true },
      { entityId: 'customers:customer_deal', recordId: 'd1', fieldKey: 'estimated_seats', value: 42 },
      { entityId: 'customers:customer_deal', recordId: 'd1', fieldKey: 'undeclared', value: 1.5 },
    ]
    const rows = await buildEncryptor(null, defs).buildCustomFieldRows(drafts)
    expect(encryptCustomFieldValueMock).toHaveBeenCalledTimes(1)
    expect(rows[0]).toMatchObject({ id: 'p1:buying_role', value_text: 'cf-enc:champion', tenant_id: TEST_TENANT_ID, organization_id: TEST_ORG_ID })
    expect(rows[1]).toMatchObject({ value_bool: true, value_text: null })
    expect(rows[2]).toMatchObject({ value_int: 42 })
    expect(rows[3]).toMatchObject({ value_float: 1.5 })
    expect(customFieldColumnForKind('multiline')).toBe('value_multiline')
    expect(customFieldColumnForKind('dictionary')).toBe('value_text')
  })
})
