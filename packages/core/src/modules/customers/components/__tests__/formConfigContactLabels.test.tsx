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
jest.mock('../../backend/hooks/useEmailDuplicateCheck', () => ({
  useEmailDuplicateCheck: () => ({ duplicate: null, checking: false }),
}))
jest.mock('@open-mercato/ui/backend/inputs/PhoneNumberField', () => {
  const phoneProps: Array<Record<string, unknown>> = []
  return {
    phoneProps,
    PhoneNumberField: (props: Record<string, unknown>) => {
      phoneProps.push(props)
      return null
    },
  }
})
jest.mock('@open-mercato/ui/primitives/email-input', () => {
  const emailProps: Array<Record<string, unknown>> = []
  return {
    emailProps,
    EmailInput: (props: Record<string, unknown>) => {
      emailProps.push(props)
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

const { phoneProps } = jest.requireMock('@open-mercato/ui/backend/inputs/PhoneNumberField') as {
  phoneProps: Array<Record<string, unknown>>
}
const { emailProps } = jest.requireMock('@open-mercato/ui/primitives/email-input') as {
  emailProps: Array<Record<string, unknown>>
}

const t: Translator = (_key, fallback) => fallback ?? _key

const baseRenderProps = {
  value: null,
  setValue: () => {},
  error: undefined,
  disabled: false,
  autoFocus: false,
  recordId: undefined,
}

function renderField(fields: CrudField[], fieldId: string, labelId?: string) {
  const field = fields.find((candidate) => candidate.id === fieldId)
  expect(field).toBeDefined()
  phoneProps.length = 0
  emailProps.length = 0
  renderToStaticMarkup(React.createElement((field as any).component, { ...baseRenderProps, labelId }))
}

// The email and phone fields render their own inputs, so CrudForm cannot tie
// its visible label to them. Without the reference their only accessible name
// was the placeholder ("name@example.com", "+00 000 000 000").
describe('contact fields take their name from the CrudForm label', () => {
  it('points the person email input at the label', () => {
    renderField(createPersonFormFields(t), 'primaryEmail', 'form-primaryEmail-label')

    expect(emailProps).toHaveLength(1)
    expect(emailProps[0]['aria-labelledby']).toBe('form-primaryEmail-label')
  })

  it('points the person phone input at the label', () => {
    renderField(createPersonFormFields(t), 'primaryPhone', 'form-primaryPhone-label')

    expect(phoneProps).toHaveLength(1)
    expect(phoneProps[0].ariaLabelledBy).toBe('form-primaryPhone-label')
  })

  it('points the company phone input at the label', () => {
    renderField(createCompanyFormFields(t), 'primaryPhone', 'form-primaryPhone-label')

    expect(phoneProps).toHaveLength(1)
    expect(phoneProps[0].ariaLabelledBy).toBe('form-primaryPhone-label')
  })

  it('adds no reference when the host renders the field without a label id', () => {
    renderField(createPersonFormFields(t), 'primaryEmail')
    expect(emailProps[0]['aria-labelledby']).toBeUndefined()

    renderField(createPersonFormFields(t), 'primaryPhone')
    expect(phoneProps[0].ariaLabelledBy).toBeUndefined()
  })
})
