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

  it('matches custom fields by normalized label and key without touching core suggestions', () => {
    const nextSuggestedMapping = buildPeopleSuggestedMapping(
      ['Record Id', 'Email', 'Favorite Color', 'loyalty_score'],
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
    ]))
    expect(nextSuggestedMapping.unmappedColumns).toEqual([])
  })

  it('normalizes headers consistently for custom matching', () => {
    expect(normalizeMatchToken('Favorite_Color')).toBe('favorite color')
    expect(normalizeMatchToken('favorite-color')).toBe('favorite color')
    expect(normalizeMatchToken('favoriteColor')).toBe('favorite color')
  })
})
