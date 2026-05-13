/** @jest-environment node */

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({}))
jest.mock('../AddressTiles', () => ({
  CustomerAddressTiles: () => null,
}))
jest.mock('../detail/RolesSection', () => ({
  RolesSection: () => null,
}))

import {
  buildCompanyPayload,
  buildPersonPayload,
  createCompanyDaneFiremyGroups,
  createPersonPersonalDataGroups,
  mapCompanyOverviewToFormValues,
  mapPersonOverviewToFormValues,
  type Translator,
} from '../formConfig'

const t: Translator = (_key, fallback) => fallback ?? _key

describe('detail page zone1 group layouts', () => {
  it('keeps all company v2 zone1 groups in the sortable primary column', () => {
    const groups = createCompanyDaneFiremyGroups(t)

    expect(groups.map((group) => group.id)).toEqual([
      'identity',
      'contact',
      'classification',
      'businessProfile',
      'notes',
      'customFields',
    ])
    expect(groups.every((group) => group.column === 1)).toBe(true)
  })

  it('keeps all person v2 zone1 groups in the sortable primary column', () => {
    const groups = createPersonPersonalDataGroups(t)

    expect(groups.map((group) => group.id)).toEqual([
      'personalDataDisplay',
      'personalData',
      'companyRole',
      'customFields',
      'roles',
    ])
    expect(groups.every((group) => group.column === 1)).toBe(true)
  })

  it('keeps selected custom select values and omits untouched undefined custom fields', () => {
    const company = buildCompanyPayload({
      displayName: 'Acme',
      cf_relationship_health: 'monitor',
      cf_renewal_quarter: undefined,
    })

    expect(company.customFields).toEqual({
      relationship_health: 'monitor',
    })
  })

  it('submits explicit custom select clears as null', () => {
    const person = buildPersonPayload({
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      cf_buying_role: null,
    })

    expect(person.customFields).toEqual({
      buying_role: null,
    })
  })

  it('maps company custom fields to prefixed edit-form keys', () => {
    const values = mapCompanyOverviewToFormValues({
      company: {
        id: 'company-1',
        displayName: 'Acme',
        primaryPhone: null,
        primaryEmail: null,
        status: null,
        lifecycleStage: null,
        source: null,
        description: null,
      },
      profile: {
        legalName: null,
        brandName: null,
        domain: null,
        websiteUrl: null,
        industry: null,
        sizeBucket: null,
        annualRevenue: null,
      },
      customFields: {
        relationship_health: 'healthy',
        renewal_quarter: 'Q3',
        customer_marketing_case: true,
      },
    } as any)

    expect(values.cf_relationship_health).toBe('healthy')
    expect(values.cf_renewal_quarter).toBe('Q3')
    expect(values.cf_customer_marketing_case).toBe(true)
  })

  it('maps person custom fields to prefixed edit-form keys', () => {
    const values = mapPersonOverviewToFormValues({
      person: {
        id: 'person-1',
        displayName: 'Ada Lovelace',
        primaryPhone: null,
        primaryEmail: null,
        status: null,
        lifecycleStage: null,
        source: null,
        description: null,
      },
      profile: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        companyEntityId: null,
        jobTitle: null,
        department: null,
        linkedInUrl: null,
        twitterUrl: null,
      },
      customFields: {
        buying_role: 'champion',
      },
    } as any)

    expect(values.cf_buying_role).toBe('champion')
  })
})
