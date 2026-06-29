import { detectCustomersPersonMapping } from '../column-detector'

describe('sync_excel column detector', () => {
  it('suggests customers.person mappings with dedupe semantics for known Zoho lead headers', () => {
    const mapping = detectCustomersPersonMapping([
      'Record Id',
      'First Name',
      'Last Name',
      'Email',
      'Lead Status',
      'Offer sent',
    ])

    expect(mapping.matchStrategy).toBe('externalId')
    expect(mapping.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalField: 'Record Id',
        localField: 'person.externalId',
        mappingKind: 'external_id',
        dedupeRole: 'primary',
      }),
      expect.objectContaining({
        externalField: 'Email',
        localField: 'person.primaryEmail',
        mappingKind: 'core',
        dedupeRole: 'secondary',
      }),
      expect.objectContaining({
        externalField: 'Lead Status',
        localField: 'person.status',
        mappingKind: 'core',
      }),
    ]))
    expect(mapping.unmappedColumns).toEqual(['Offer sent'])
  })
})
