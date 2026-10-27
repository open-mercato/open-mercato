jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    t: (key: string, fallbackOrParams?: string | Record<string, unknown>, params?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
      const values = typeof fallbackOrParams === 'object' && fallbackOrParams ? fallbackOrParams : params
      let out = fallback
      if (values) for (const [name, value] of Object.entries(values)) out = out.replace(new RegExp(`{{${name}}}`, 'g'), String(value))
      return out
    },
  }),
}))

import { searchConfig } from '../search'
import type { SearchBuildContext } from '@open-mercato/shared/modules/search'

describe('customers search config', () => {
  test('exclusions override searchable custom fields across supported key spellings', async () => {
    const config = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_company_profile')!
    const originalPolicy = config.fieldPolicy
    try {
      config.fieldPolicy = { searchable: ['size_bucket', 'description'], hashOnly: ['sizeBucket'], excluded: ['cf:description'] }
      const source = await config.buildSource!({
        tenantId: 'tenant-privacy',
        record: { id: 'policy-company', sizeBucket: 'private-record-size', description: 'private-record-description' },
        customFields: { 'cf:size_bucket': 'private-custom-size', cf_description: 'private-custom-description' },
      })
      expect(source?.text).toEqual(['Record ID: policy-company'])
      expect(JSON.stringify(source)).not.toContain('private-')
    } finally {
      config.fieldPolicy = originalPolicy
    }
  })

  test('does not serialize nested objects under an approved scalar field', async () => {
    const config = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_company_profile')!
    const source = await config.buildSource!({
      tenantId: 'tenant-privacy',
      record: { id: 'nested-company' },
      customFields: { size_bucket: { email: 'private-nested@example.com' } },
    })
    expect(source?.text).toEqual(['Record ID: nested-company'])
    expect(JSON.stringify(source)).not.toContain('private-')
  })

  test.each(['person', 'company'] as const)('%s vector source and presenter exclude contact PII and unapproved custom fields', async (kind) => {
    const config = searchConfig.entities.find((entity) => entity.entityId === `customers:customer_${kind}_profile`)!
    const context: SearchBuildContext = {
      tenantId: 'tenant-privacy',
      organizationId: 'org-privacy',
      record: {
        id: `privacy-${kind}`,
        firstName: 'Encrypted First Name',
        legalName: 'Encrypted Legal Name',
        entity: {
          id: `privacy-entity-${kind}`,
          display_name: 'Customer Display Name',
          primaryEmail: 'private-contact@example.com',
          primaryPhone: '+48-555-010-7826',
          status: 'active',
        },
      },
      customFields: {
        primary_email: 'private-custom@example.com',
        primaryPhone: '+48-555-020-7826',
        personal_email: 'private-personal@example.com',
        government_id: 'private-government-id',
        bank_account: 'private-bank-account',
        unknown_field: 'private-unapproved-value',
        summary: 'private-unapproved-summary',
        first_name: 'Encrypted Custom First Name',
        industry: 'Encrypted Custom Industry',
        size_bucket: 'approved-company-size',
      },
    }

    const source = await config.buildSource!(context)
    const presenter = await config.formatResult!(context)
    expect(source).not.toBeNull()
    const serialized = JSON.stringify({ source, presenter })
    for (const forbidden of ['private-', '+48-555-']) expect(serialized).not.toContain(forbidden)
    expect(source!.text).toEqual(expect.arrayContaining(['Status: active']))
    const text = JSON.stringify(source!.text)
    expect(text).not.toContain('Encrypted')
    expect(text).not.toContain('Customer Display Name')
    expect(source!.presenter?.title).toBe('Customer Display Name')
    if (kind === 'company') expect(text).toContain('approved-company-size')
  })

  test.each(['person', 'company'] as const)('%s sparse vector source never serializes arbitrary record fields', async (kind) => {
    const config = searchConfig.entities.find((entity) => entity.entityId === `customers:customer_${kind}_profile`)!
    const source = await config.buildSource!({
      tenantId: 'tenant-privacy',
      record: { id: `sparse-${kind}`, primaryEmail: 'sparse-private@example.com', ssn: 'private-ssn', extra: 'private-extra' },
      customFields: {},
    })
    expect(source).not.toBeNull()
    expect(JSON.stringify(source)).not.toContain('private')
    expect(source!.text).toEqual([`Record ID: sparse-${kind}`])
  })

  test('person profile buildSource loads customer entity by entity id without profile joins', async () => {
    const personConfig = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_person_profile')
    expect(personConfig?.buildSource).toBeDefined()

    const query = jest.fn(async () => ({
      items: [
        {
          id: 'entity-1',
          kind: 'person',
          display_name: 'Ada Lovelace',
          primary_email: 'ada@example.com',
        },
      ],
    }))

    const result = await personConfig!.buildSource!({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      queryEngine: {
        query,
      } as any,
      record: {
        id: 'profile-1',
        entity_id: 'entity-1',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
      customFields: {},
    })

    expect(result).not.toBeNull()
    expect(query).toHaveBeenCalledWith(
      'customers:customer_entity',
      expect.objectContaining({
        filters: {
          id: { $eq: 'entity-1' },
        },
      }),
    )
    expect(query.mock.calls[0]?.[1]).not.toHaveProperty('customFieldSources')
  })

  test('person search results link to the v2 detail page (#2843)', async () => {
    const personConfig = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_person_profile')
    const ctx = { record: { entity_id: 'entity-1' } } as any

    const url = await personConfig!.resolveUrl!(ctx)
    expect(url).toBe('/backend/customers/people-v2/entity-1')

    const links = await personConfig!.resolveLinks!(ctx)
    expect(links?.[0]?.href).toContain('/backend/customers/people-v2/entity-1')
  })

  test('company search results link to the v2 detail page (#2843)', async () => {
    const companyConfig = searchConfig.entities.find((entity) => entity.entityId === 'customers:customer_company_profile')
    const ctx = { record: { entity_id: 'entity-2' } } as any

    const url = await companyConfig!.resolveUrl!(ctx)
    expect(url).toBe('/backend/customers/companies-v2/entity-2')

    const links = await companyConfig!.resolveLinks!(ctx)
    expect(links?.[0]?.href).toContain('/backend/customers/companies-v2/entity-2')
  })
})
