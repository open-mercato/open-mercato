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
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm field help', () => {
  it('keeps the label as a direct sibling of the control when a field has no help', () => {
    const fields: CrudField[] = [{ id: 'first_name', label: 'First name', type: 'text', required: true }]

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} />,
    )

    const label = screen.getByText('First name', { exact: false }).closest('label')
    expect(label).not.toBeNull()
    expect(label?.className).toContain('block text-sm font-medium')

    const fieldWrapper = container.querySelector('[data-crud-field-id="first_name"]') as HTMLElement
    const input = fieldWrapper.querySelector('input')
    expect(input).not.toBeNull()
    // The label's parent is the field wrapper itself (no extra wrapper div in between),
    // exactly as an integration spec that walks `label -> parent -> getByRole('textbox')` expects.
    expect(label?.parentElement).toBe(fieldWrapper)
    expect(label?.parentElement?.contains(input as Node)).toBe(true)

    expect(screen.queryByRole('button', { name: 'What is this?' })).toBeNull()
  })

  it('keeps the checkbox label as a direct sibling of the control when a field has no help', () => {
    const fields: CrudField[] = [{ id: 'is_active', label: 'Active', type: 'checkbox' }]

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ is_active: false }} onSubmit={() => {}} />,
    )

    const fieldWrapper = container.querySelector('[data-crud-field-id="is_active"]') as HTMLElement
    const label = fieldWrapper.querySelector('label')
    expect(label).not.toBeNull()
    expect(label?.parentElement).toBe(fieldWrapper)
    expect(label?.querySelector('input[type="checkbox"], button[role="checkbox"]')).not.toBeNull()
  })

  it('renders the "?" affordance next to the label when a field declares help, without losing the label text', () => {
    const fields: CrudField[] = [
      {
        id: 'segment',
        label: 'Segment',
        type: 'text',
        help: { title: 'Segment', body: 'A saved audience.' },
      },
    ]

    renderWithProviders(<CrudForm title="Form" fields={fields} onSubmit={() => {}} />)

    expect(screen.getByText('Segment')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'What is this?' })
    expect(trigger).toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByText('A saved audience.')).toBeInTheDocument()
  })
})
