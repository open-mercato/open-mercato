/** @jest-environment jsdom */
jest.setTimeout(15000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn(async () => ({ ok: true, data: {} })) }),
}))
jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import plLocale from '../../i18n/pl.json'
import { COMPANY_TAX_ID_MAX_LENGTH, COMPANY_TAX_ID_TOO_LONG_MESSAGE_KEY } from '../../data/validators'
import {
  createCompanyEditFields,
  createCompanyEditSchema,
  createCompanyFormFields,
  createCompanyFormSchema,
  type Translator,
} from '../formConfig'

const t: Translator = (key, fallback) => fallback ?? key
const COMPANY_ID = '11111111-1111-4111-8111-111111111111'
const tooLongMessage = (plLocale as Record<string, string>)[COMPANY_TAX_ID_TOO_LONG_MESSAGE_KEY]

const forms = [
  {
    name: 'create',
    fields: createCompanyFormFields(t),
    schema: createCompanyFormSchema(),
    initialValues: { displayName: 'Acme' },
  },
  {
    name: 'edit',
    fields: createCompanyEditFields(t),
    schema: createCompanyEditSchema(),
    initialValues: { id: COMPANY_ID, displayName: 'Acme' },
  },
]

describe.each(forms)('company $name form — VAT ID length', ({ fields, schema, initialValues }) => {
  function renderForm(onSubmit: (values: Record<string, unknown>) => void) {
    const taxIdAndName = fields.filter((field) => field.id === 'displayName' || field.id === 'taxId')
    expect(taxIdAndName.map((field) => field.id)).toEqual(expect.arrayContaining(['displayName', 'taxId']))
    return renderWithProviders(
      <CrudForm
        title="Company"
        fields={taxIdAndName}
        schema={schema}
        initialValues={initialValues}
        onSubmit={onSubmit}
      />,
      { locale: 'pl', dict: plLocale },
    )
  }

  function typeTaxId(container: HTMLElement, value: string) {
    const input = container.querySelector('[data-crud-field-id="taxId"] input') as HTMLInputElement
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { value } })
    expect(input.value).toBe(value)
  }

  it('refuses a value one character over the limit with the translated message and submits nothing', async () => {
    const onSubmit = jest.fn()
    const { container, findByText } = renderForm(onSubmit)

    typeTaxId(container, 'X'.repeat(COMPANY_TAX_ID_MAX_LENGTH + 1))
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    expect(await findByText(tooLongMessage)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits a value exactly at the limit', async () => {
    const onSubmit = jest.fn()
    const { container, queryByText } = renderForm(onSubmit)
    const atLimit = 'X'.repeat(COMPANY_TAX_ID_MAX_LENGTH)

    typeTaxId(container, atLimit)
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ taxId: atLimit }))
    expect(queryByText(tooLongMessage)).toBeNull()
  })
})
