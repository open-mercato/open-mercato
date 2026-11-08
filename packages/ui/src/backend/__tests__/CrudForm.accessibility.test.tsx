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
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn() }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm accessible field associations', () => {
  it('names built-in controls with unique visible labels across forms', () => {
    const fields: CrudField[] = [
      { id: 'code', label: 'Code', type: 'text' },
      { id: 'password', label: 'Password', type: 'password' },
      { id: 'rate', label: 'Rate', type: 'number' },
      { id: 'notes', label: 'Notes', type: 'textarea' },
      { id: 'kind', label: 'Kind', type: 'select', options: [{ value: 'tax', label: 'Tax' }] },
      { id: 'customer', label: 'Customer', type: 'combobox', suggestions: ['Acme'] },
    ]
    const { getAllByLabelText } = renderWithProviders(
      <><CrudForm fields={fields} onSubmit={() => {}} /><CrudForm fields={fields} onSubmit={() => {}} /></>,
    )
    for (const field of fields) {
      const controls = getAllByLabelText(field.label)
      expect(controls).toHaveLength(2)
      expect(controls[0].id).toBeTruthy()
      expect(controls[0].id).not.toBe(controls[1].id)
      expect(['INPUT', 'TEXTAREA', 'BUTTON']).toContain(controls[0].tagName)
    }
  })

  it('links required errors and descriptions to their controls and clears invalid state after correction', async () => {
    const fields: CrudField[] = [
      { id: 'name', label: 'Name', type: 'text', required: true, description: 'Name shown on invoices' },
      { id: 'rate', label: 'Rate', type: 'number', required: true },
      { id: 'kind', label: 'Kind', type: 'select', required: true, options: [{ value: 'tax', label: 'Tax' }] },
    ]
    const { container, getByLabelText } = renderWithProviders(<CrudForm fields={fields} onSubmit={() => {}} />, {
      dict: { 'ui.forms.errors.required': 'This field is required' },
    })
    await act(async () => { fireEvent.submit(container.querySelector('form')!) })
    await waitFor(() => expect(getByLabelText('Name', { exact: false })).toHaveAttribute('aria-invalid', 'true'))
    for (const field of fields) {
      const control = getByLabelText(new RegExp(field.label))
      expect(control).toHaveAttribute('aria-invalid', 'true')
      const descriptions = control.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent)
      expect(descriptions).toContain('This field is required')
    }
    const name = getByLabelText(/Name/)
    expect(name).toHaveAccessibleDescription('Name shown on invoices This field is required')
    fireEvent.change(name, { target: { value: 'Standard VAT' } })
    await waitFor(() => expect(name).not.toHaveAttribute('aria-invalid'))
    expect(name).toHaveAccessibleDescription('Name shown on invoices')
  })
})
