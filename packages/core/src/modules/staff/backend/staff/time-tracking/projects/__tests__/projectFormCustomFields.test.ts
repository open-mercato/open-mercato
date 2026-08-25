/** @jest-environment node */
// Regression for the custom-field drop introduced with the project form itself
// (9c8e01608): the form has always passed `entityIds`, so `CrudForm` renders an
// input for every custom field defined on `staff:staff_time_project`, but
// `buildProjectPayload` rebuilt the request body from named fields only. Every
// value the user typed was discarded on save, and the form reported success.
// The payload MUST carry the `cf_*` keys across, and the command MUST see them.
import { extractCustomFieldValuesFromPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { buildProjectPayload, pickCustomFieldValues, type ProjectFormValues } from '../projectFormConfig'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

const BASE_VALUES: ProjectFormValues = {
  name: 'Nordvik — service portal',
  code: 'NRD-01',
  currencyCode: 'EUR',
  status: 'active',
}

describe('buildProjectPayload custom fields', () => {
  it('carries cf_ values into the create payload', () => {
    const payload = buildProjectPayload({
      ...BASE_VALUES,
      cf_engagement_code: 'ENG-4471',
      cf_requires_nda: true,
    })

    expect(payload.cf_engagement_code).toBe('ENG-4471')
    expect(payload.cf_requires_nda).toBe(true)
  })

  it('carries cf_ values into the update payload alongside the id', () => {
    const payload = buildProjectPayload({
      ...BASE_VALUES,
      id: PROJECT_ID,
      cf_engagement_code: 'ENG-4471',
    })

    expect(payload.id).toBe(PROJECT_ID)
    expect(payload.cf_engagement_code).toBe('ENG-4471')
  })

  it('reaches the command as custom field values under their bare keys', () => {
    const payload = buildProjectPayload({
      ...BASE_VALUES,
      cf_engagement_code: 'ENG-4471',
      cf_requires_nda: false,
    })

    expect(extractCustomFieldValuesFromPayload(payload)).toEqual({
      engagement_code: 'ENG-4471',
      requires_nda: false,
    })
  })

  it('does not invent custom field keys when the form has none', () => {
    const payload = buildProjectPayload(BASE_VALUES)

    expect(Object.keys(payload).some((key) => key.startsWith('cf_') || key.startsWith('cf:'))).toBe(false)
    expect(extractCustomFieldValuesFromPayload(payload)).toEqual({})
  })

  it('leaves every named field untouched', () => {
    const withCustom = buildProjectPayload({ ...BASE_VALUES, cf_engagement_code: 'ENG-4471' })
    const withoutCustom = buildProjectPayload(BASE_VALUES)

    expect(pickCustomFieldValues(withCustom)).toEqual({ cf_engagement_code: 'ENG-4471' })
    for (const [key, value] of Object.entries(withoutCustom)) {
      expect(withCustom[key]).toEqual(value)
    }
  })
})

describe('pickCustomFieldValues', () => {
  it('accepts both the cf_ and cf: spellings and nothing else', () => {
    expect(
      pickCustomFieldValues({
        name: 'Nordvik',
        cf_engagement_code: 'ENG-4471',
        'cf:requires_nda': true,
        cfNotAPrefix: 'ignored',
      }),
    ).toEqual({ cf_engagement_code: 'ENG-4471', 'cf:requires_nda': true })
  })
})
