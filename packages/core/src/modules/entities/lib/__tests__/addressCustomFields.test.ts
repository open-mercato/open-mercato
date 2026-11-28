import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomFieldDef } from '../../data/entities'
import {
  applyAddressCustomValues,
  loadAddressCustomFieldDefinitions,
  readAddressCustomValues,
  sealAddressCustomValues,
} from '../addressCustomFields'
import { CUSTOMER_ADDRESS_FIELD_HOST, isSupportedAddressCustomField } from '../addressCustomFieldPolicy'

jest.mock('../htmlRichTextSanitizer', () => ({
  sanitizeCustomFieldHtmlRichTextValuesServer: (_em: unknown, options: { values: Record<string, unknown> }) => options.values,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const scope = { tenantId: 'tenant-1', organizationId: 'organization-1', entityId: CUSTOMER_ADDRESS_FIELD_HOST }

function definition(key: string, overrides: Partial<CustomFieldDef> = {}): CustomFieldDef {
  return Object.assign(new CustomFieldDef(), {
    key, kind: 'text', configJson: {}, isActive: true, deletedAt: null, updatedAt: new Date(0),
  }, overrides)
}

function managerWith(definitions: CustomFieldDef[]): EntityManager {
  return { find: jest.fn().mockResolvedValue(definitions) } as unknown as EntityManager
}

describe('address custom field values', () => {
  it('reserves built-in aliases while allowing unrelated text fields', () => {
    for (const key of ['Phone', 'taxId', 'tax_id_type', 'recipient_name', 'addressCustomValues']) {
      expect(isSupportedAddressCustomField(key, 'text')).toBe(false)
    }
    expect(isSupportedAddressCustomField('gate_code', 'text')).toBe(true)
    expect(isSupportedAddressCustomField('gate_photo', 'attachment')).toBe(false)
  })

  it('honors a scoped tombstone for an inherited definition', async () => {
    const active = definition('gate_code')
    const tombstone = definition('gate_code', { ...scope, isActive: false, deletedAt: new Date() })
    const definitions = await loadAddressCustomFieldDefinitions(managerWith([active, tombstone]), scope)
    expect(definitions.has('gate_code')).toBe(false)
  })

  it('clears an explicit null and preserves omitted active and parked values', async () => {
    const previous = { gate_code: '1234', bay: 'West', retired_key: 'Historical' }
    const updated = await applyAddressCustomValues(managerWith([definition('gate_code'), definition('bay')]), {
      ...scope, previous, patch: { gate_code: null },
    })
    expect(updated).toEqual({ bay: 'West', retired_key: 'Historical' })
    expect(previous.gate_code).toBe('1234')
  })

  it('rejects reserved writes and an unreadable encrypted storage value', async () => {
    await expect(applyAddressCustomValues(managerWith([definition('tax_id')]), {
      ...scope, previous: null, patch: { tax_id: 'unknown' },
    })).rejects.toMatchObject({ status: 400, body: { fieldErrors: { cf_tax_id: expect.any(String) } } })
    expect(() => readAddressCustomValues('invalid ciphertext')).toThrow()
  })

  it('fails closed when the tenant encryption service returns plaintext', async () => {
    const previous = process.env.TENANT_DATA_ENCRYPTION
    process.env.TENANT_DATA_ENCRYPTION = 'true'
    try {
      const values = { gate_code: 'example' }
      const container = { resolve: jest.fn().mockReturnValue({
        encryptEntityPayload: jest.fn().mockResolvedValue({ customValues: values }),
      }) }
      await expect(sealAddressCustomValues(container, { ...scope, column: 'customValues', values }))
        .rejects.toMatchObject({ status: 503 })
    } finally {
      if (previous === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = previous
    }
  })
})
