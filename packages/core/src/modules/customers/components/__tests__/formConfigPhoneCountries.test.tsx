/** @jest-environment node */

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({}))
jest.mock('../AddressTiles', () => ({
  CustomerAddressTiles: () => null,
}))
jest.mock('../detail/RolesSection', () => ({
  RolesSection: () => null,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
  useOptionalLocale: () => undefined,
}))
jest.mock('@open-mercato/ui/backend/inputs/PhoneNumberField', () => {
  const capturedCountries: unknown[] = []
  return {
    capturedCountries,
    PhoneNumberField: (props: { countries?: unknown }) => {
      capturedCountries.push(props.countries)
      return null
    },
  }
})

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  createCompanyFormFields,
  createPersonFormFields,
  type Translator,
} from '../formConfig'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import type { PhoneCountry } from '@open-mercato/ui/backend/inputs/PhoneNumberField'

const { capturedCountries } = jest.requireMock('@open-mercato/ui/backend/inputs/PhoneNumberField') as {
  capturedCountries: unknown[]
}

const t: Translator = (_key, fallback) => fallback ?? _key

const mockRenderProps = {
  value: null,
  setValue: () => {},
  error: undefined,
  disabled: false,
  autoFocus: false,
  recordId: undefined,
}

const MARKETS: PhoneCountry[] = [
  { iso2: 'PL', dialCode: '+48', label: 'Rzeczpospolita Polska', flag: '🇵🇱' },
  { iso2: 'DE', dialCode: '+49', label: 'Deutschland', flag: '🇩🇪' },
]

function renderPrimaryPhone(fields: CrudField[]): unknown {
  const phoneField = fields.find((field) => field.id === 'primaryPhone')
  expect(phoneField).toBeDefined()
  capturedCountries.length = 0
  renderToStaticMarkup(React.createElement((phoneField as any).component, mockRenderProps))
  expect(capturedCountries).toHaveLength(1)
  return capturedCountries[0]
}

describe('phoneCountries forwarding to PhoneNumberField', () => {
  it('passes a supplied country list to the person form phone field', () => {
    expect(renderPrimaryPhone(createPersonFormFields(t, { phoneCountries: MARKETS }))).toEqual(MARKETS)
  })

  it('passes a supplied country list to the company form phone field', () => {
    expect(renderPrimaryPhone(createCompanyFormFields(t, { phoneCountries: MARKETS }))).toEqual(MARKETS)
  })

  it('leaves the country list undefined when no override is supplied, so the field localizes its own', () => {
    expect(renderPrimaryPhone(createPersonFormFields(t))).toBeUndefined()
    expect(renderPrimaryPhone(createCompanyFormFields(t))).toBeUndefined()
  })
})
