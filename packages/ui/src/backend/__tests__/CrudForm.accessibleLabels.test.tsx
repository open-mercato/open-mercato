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
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const dict = {
  'ui.forms.actions.save': 'Save',
  'ui.forms.select.emptyOption': '—',
}

describe('CrudForm accessible field labels (#5360)', () => {
  it('associates a text field label with its input via htmlFor/id', () => {
    const fields: CrudField[] = [{ id: 'displayName', label: 'Display name', type: 'text' }]
    const { getByLabelText } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ displayName: '' }} onSubmit={() => {}} />,
      { dict },
    )

    const input = getByLabelText('Display name') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(input.id).toBeTruthy()

    const label = document.querySelector(`label[for="${input.id}"]`) as HTMLLabelElement
    expect(label).not.toBeNull()
    fireEvent.click(label)
    expect(document.activeElement).toBe(input)
  })

  it('associates a decimal field label with its input via htmlFor/id', () => {
    const fields: CrudField[] = [{ id: 'rate', label: 'Exchange Rate', type: 'decimal' }]
    const { getByLabelText } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ rate: '' }} onSubmit={() => {}} />,
      { dict },
    )

    const input = getByLabelText('Exchange Rate') as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
    expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull()
  })

  it('associates a select field label with its trigger via htmlFor/id', () => {
    const fields: CrudField[] = [
      {
        id: 'status',
        label: 'Status',
        type: 'select',
        options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }],
      },
    ]
    const { getByLabelText } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ status: 'open' }} onSubmit={() => {}} />,
      { dict },
    )

    const trigger = getByLabelText('Status')
    expect(trigger).not.toBeNull()
  })

  it('associates a checkbox field label with its control via htmlFor/id, and clicking the label toggles it', () => {
    const onSubmit = jest.fn()
    const fields: CrudField[] = [{ id: 'active', label: 'Active', type: 'checkbox' }]
    const { getByLabelText } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ active: false }} onSubmit={onSubmit} />,
      { dict },
    )

    const checkbox = getByLabelText('Active') as HTMLElement
    expect(checkbox).not.toBeNull()
    expect(checkbox).toHaveAttribute('aria-checked', 'false')

    const label = document.querySelector(`label[for="${checkbox.id}"]`) as HTMLLabelElement
    expect(label).not.toBeNull()
    fireEvent.click(label)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })

  it('gives a custom field group an accessible name derived from its label (aria-labelledby fallback)', () => {
    const fields: CrudField[] = [
      {
        id: 'notes',
        label: 'Notes',
        type: 'custom',
        component: ({ value, setValue }) => (
          <textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => setValue(event.target.value)}
          />
        ),
      },
    ]
    const { getByRole } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ notes: '' }} onSubmit={() => {}} />,
      { dict },
    )

    const group = getByRole('group', { name: 'Notes' })
    expect(group).not.toBeNull()
    expect(group.querySelector('textarea')).not.toBeNull()
  })
})
