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
})
