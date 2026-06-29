import {
  buildPeopleSuggestedMapping,
  buildPeopleTargetOptions,
  normalizeMatchToken,
  type SuggestedMapping,
} from '../target-options'

describe('sync_excel target options helpers', () => {
  const baseSuggestedMapping: SuggestedMapping = {
    entityType: 'customers.person',
    matchStrategy: 'externalId',
    matchField: 'person.externalId',
    fields: [
      {
        externalField: 'Record Id',
        localField: 'person.externalId',
        mappingKind: 'external_id',
        dedupeRole: 'primary',
      },
      {
        externalField: 'Email',
        localField: 'person.primaryEmail',
        mappingKind: 'core',
        dedupeRole: 'secondary',
      },
    ],
    unmappedColumns: ['Favorite Color', 'loyalty_score'],
  }

  it('builds a people target catalog with deduplicated custom fields', () => {
    const options = buildPeopleTargetOptions([
      {
        entityId: 'customers:customer_person_profile',
        key: 'favorite_color',
        kind: 'text',
        label: 'Favorite Color',
      },
      {
        entityId: 'customers:customer_entity',
        key: 'favorite_color',
        kind: 'dictionary',
        label: 'Account Favorite Color',
        filterable: true,
      },
      {
        entityId: 'customers:customer_entity',
        key: 'loyalty_score',
        kind: 'integer',
        label: 'Loyalty Score',
      },
    ])

    expect(options.some((option) => option.value === 'person.primaryEmail')).toBe(true)
    expect(options.find((option) => option.value === 'address.addressLine1')).toMatchObject({
      fallback: 'Address line 1',
      mappingKind: 'core',
    })
    expect(options.filter((option) => option.value === 'cf:favorite_color')).toHaveLength(1)
    expect(options.find((option) => option.value === 'cf:favorite_color')).toMatchObject({
      fallback: 'Account Favorite Color',
      mappingKind: 'custom_field',
    })
    expect(options.find((option) => option.value === 'cf:loyalty_score')).toMatchObject({
      fallback: 'Loyalty Score',
      mappingKind: 'custom_field',
    })
  })

  it('matches custom fields and address fields by normalized label without touching core suggestions', () => {
    const nextSuggestedMapping = buildPeopleSuggestedMapping(
      ['Record Id', 'Email', 'Favorite Color', 'loyalty_score', 'Address Line 1', 'Postal-Code'],
      baseSuggestedMapping,
      [
        {
          entityId: 'customers:customer_person_profile',
          key: 'favorite_color',
          kind: 'text',
          label: 'Favorite Color',
        },
        {
          entityId: 'customers:customer_entity',
          key: 'loyalty_score',
          kind: 'integer',
          label: 'Loyalty Score',
        },
      ],
    )

    expect(nextSuggestedMapping.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalField: 'Record Id',
        localField: 'person.externalId',
        mappingKind: 'external_id',
      }),
      expect.objectContaining({
        externalField: 'Favorite Color',
        localField: 'cf:favorite_color',
        mappingKind: 'custom_field',
      }),
      expect.objectContaining({
        externalField: 'loyalty_score',
        localField: 'cf:loyalty_score',
        mappingKind: 'custom_field',
      }),
      expect.objectContaining({
        externalField: 'Address Line 1',
        localField: 'address.addressLine1',
        mappingKind: 'core',
      }),
      expect.objectContaining({
        externalField: 'Postal-Code',
        localField: 'address.postalCode',
        mappingKind: 'core',
      }),
    ]))
    expect(nextSuggestedMapping.unmappedColumns).toEqual([])
  })

  it('matches Zoho lead headers to external custom fields with cleaned labels', () => {
    const nextSuggestedMapping = buildPeopleSuggestedMapping(
      [
        'Record Id',
        'Lead Name',
        'Company',
        'Created Time',
        'Service needed',
        'Lead Source',
        'Lead Status',
        'Annual Revenue',
        'Referred by',
        'Industry',
      ],
      {
        entityType: 'customers.person',
        matchStrategy: 'externalId',
        matchField: 'person.externalId',
        fields: [
          {
            externalField: 'Record Id',
            localField: 'person.externalId',
            mappingKind: 'external_id',
            dedupeRole: 'primary',
          },
          {
            externalField: 'Lead Name',
            localField: 'person.displayName',
            mappingKind: 'core',
          },
          {
            externalField: 'Lead Source',
            localField: 'person.source',
            mappingKind: 'core',
          },
          {
            externalField: 'Lead Status',
            localField: 'person.status',
            mappingKind: 'core',
          },
        ],
        unmappedColumns: [
          'Company',
          'Created Time',
          'Service needed',
          'Annual Revenue',
          'Referred by',
          'Industry',
        ],
      },
      [
        {
          entityId: 'customers:customer_person_profile',
          key: 'company_external',
          kind: 'text',
          label: 'Company (external)',
        },
        {
          entityId: 'customers:customer_person_profile',
          key: 'industry_external',
          kind: 'dictionary',
          label: 'Industry (external)',
        },
        {
          entityId: 'customers:customer_person_profile',
          key: 'service_needed',
          kind: 'dictionary',
          label: 'Service needed',
        },
        {
          entityId: 'customers:customer_person_profile',
          key: 'annual_revenue',
          kind: 'currency',
          label: 'Annual revenue (external)',
        },
      ],
    )

    expect(nextSuggestedMapping.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalField: 'Company',
        localField: 'cf:company_external',
        mappingKind: 'custom_field',
      }),
      expect.objectContaining({
        externalField: 'Industry',
        localField: 'cf:industry_external',
        mappingKind: 'custom_field',
      }),
      expect.objectContaining({
        externalField: 'Service needed',
        localField: 'cf:service_needed',
        mappingKind: 'custom_field',
      }),
      expect.objectContaining({
        externalField: 'Annual Revenue',
        localField: 'cf:annual_revenue',
        mappingKind: 'custom_field',
      }),
    ]))
    expect(nextSuggestedMapping.unmappedColumns).toEqual(['Created Time', 'Referred by'])
  })

  it('does not duplicate address target suggestions when the user already mapped a field manually', () => {
    const nextSuggestedMapping = buildPeopleSuggestedMapping(
      ['Address Line 1', 'Postal Code'],
      {
        entityType: 'customers.person',
        matchStrategy: 'custom',
        fields: [
          {
            externalField: 'Address Line 1',
            localField: 'address.addressLine1',
            mappingKind: 'core',
          },
        ],
        unmappedColumns: ['Postal Code'],
      },
      [],
    )

    expect(nextSuggestedMapping.fields.filter((field) => field.localField === 'address.addressLine1')).toHaveLength(1)
    expect(nextSuggestedMapping.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalField: 'Postal Code',
        localField: 'address.postalCode',
        mappingKind: 'core',
      }),
    ]))
  })

  it('normalizes headers consistently for custom matching', () => {
    expect(normalizeMatchToken('Favorite_Color')).toBe('favorite color')
    expect(normalizeMatchToken('favorite-color')).toBe('favorite color')
    expect(normalizeMatchToken('favoriteColor')).toBe('favorite color')
  })
})
