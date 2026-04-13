/** @jest-environment node */

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({}))
jest.mock('../AddressTiles', () => ({
  CustomerAddressTiles: () => null,
}))
jest.mock('../detail/RolesSection', () => ({
  RolesSection: () => null,
}))

import {
  createCompanyDaneFiremyGroups,
  createPersonDaneOsoboweGroups,
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
    const groups = createPersonDaneOsoboweGroups(t)

    expect(groups.map((group) => group.id)).toEqual([
      'personalData',
      'companyRole',
      'customFields',
      'roles',
    ])
    expect(groups.every((group) => group.column === 1)).toBe(true)
  })
})
