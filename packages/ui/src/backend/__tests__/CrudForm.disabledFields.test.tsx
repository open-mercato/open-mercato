/** @jest-environment jsdom */
jest.setTimeout(15000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const dict = {
  'ui.forms.actions.save': 'Save',
  'ui.forms.select.emptyOption': '—',
}

describe('CrudForm field-level disabled', () => {
  it('disables a number field', () => {
    const fields: CrudField[] = [{ id: 'leadTime', label: 'Lead time', type: 'number', disabled: true }]
    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ leadTime: 5 }} onSubmit={() => {}} />,
      { dict },
    )

    const input = container.querySelector('[data-crud-field-id="leadTime"] input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input).toBeDisabled()
  })

  it('disables a tags field so values cannot be added or removed', () => {
    const fields: CrudField[] = [{ id: 'locales', label: 'Locales', type: 'tags', disabled: true }]
    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ locales: ['en', 'pl'] }} onSubmit={() => {}} />,
      { dict },
    )

    const field = container.querySelector('[data-crud-field-id="locales"]') as HTMLElement
    expect(field.querySelector('input')).toBeDisabled()
    const removeButtons = Array.from(field.querySelectorAll('button'))
    expect(removeButtons.length).toBeGreaterThan(0)
    removeButtons.forEach((button) => expect(button).toBeDisabled())
  })
})
