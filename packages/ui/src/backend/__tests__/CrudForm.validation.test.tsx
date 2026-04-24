/** @jest-environment jsdom */
jest.setTimeout(15000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))
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
import { z } from 'zod'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm validation state', () => {
  it('clears corrected field errors immediately without dropping unrelated errors', async () => {
    const fields: CrudField[] = [
      { id: 'name', label: 'Name', type: 'text', required: true },
      {
        id: 'gatewayProviderKey',
        label: 'Gateway provider',
        type: 'select',
        required: true,
        options: [{ value: 'mock', label: 'Mock Gateway' }],
      },
    ]

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.errors.highlighted': 'Please fix the highlighted errors.',
          'ui.forms.errors.required': 'This field is required',
        },
      },
    )

    const form = container.querySelector('form')
    const nameField = container.querySelector('[data-crud-field-id="name"]')
    const gatewayField = container.querySelector('[data-crud-field-id="gatewayProviderKey"]')
    const nameInput = container.querySelector('[data-crud-field-id="name"] input[type="text"]')

    expect(form).not.toBeNull()
    expect(nameField).not.toBeNull()
    expect(gatewayField).not.toBeNull()
    expect(nameInput).not.toBeNull()

    await act(async () => {
      fireEvent.submit(form as HTMLFormElement)
    })

    await waitFor(() => {
      expect(nameField?.querySelector('.text-xs.text-status-error-text')).toHaveTextContent('This field is required')
      expect(gatewayField?.querySelector('.text-xs.text-status-error-text')).toHaveTextContent('This field is required')
    })

    await act(async () => {
      fireEvent.change(nameInput as HTMLInputElement, { target: { value: 'QA test link' } })
    })

    await waitFor(() => {
      expect(nameField?.querySelector('.text-xs.text-status-error-text')).toBeNull()
      expect(gatewayField?.querySelector('.text-xs.text-status-error-text')).toHaveTextContent('This field is required')
    })
    expect(container.textContent).toContain('Gateway provider')
  })

  it('preserves nested schema error paths for inline rendering', async () => {
    const schema = z.object({
      customerFieldsSchema: z.array(
        z.object({
          key: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'Use camelCase starting with a letter.'),
        }),
      ),
    })

    const { container, getByText } = renderWithProviders(
      <CrudForm
        title="Form"
        schema={schema}
        fields={[]}
        groups={[
          {
            id: 'customer-fields',
            component: ({ errors }) => (
              <div>{errors['customerFieldsSchema.0.key'] ?? 'missing'}</div>
            ),
          },
        ]}
        initialValues={{ customerFieldsSchema: [{ key: 'first Name' }] }}
        onSubmit={() => {}}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.errors.highlighted': 'Please fix the highlighted errors.',
        },
      },
    )

    const form = container.querySelector('form')
    expect(form).not.toBeNull()

    await act(async () => {
      fireEvent.submit(form as HTMLFormElement)
    })

    await waitFor(() => {
      expect(getByText('Use camelCase starting with a letter.')).toBeInTheDocument()
    })
  })

  it('validates number fields on blur', async () => {
    const fields: CrudField[] = [
      { id: 'title', label: 'Title', type: 'text' },
      { id: 'cf_priority', label: 'Priority', type: 'number', required: true },
    ]

    const { container, findByText } = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.errors.required': 'This field is required',
        },
      },
    )

    const priorityInput = container.querySelector('[data-crud-field-id="cf_priority"] input[type="number"]')
    expect(priorityInput).not.toBeNull()

    await act(async () => {
      fireEvent.blur(priorityInput as HTMLInputElement)
    })

    expect(await findByText('This field is required')).toBeInTheDocument()
  })

  it('does not validate date picker fields when the trigger blurs', async () => {
    const fields: CrudField[] = [
      { id: 'dueDate', label: 'Due date', type: 'datepicker', required: true },
    ]

    const { container, queryByText } = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.errors.required': 'This field is required',
          'ui.datePicker.placeholder': 'Pick a date',
        },
      },
    )

    const trigger = container.querySelector('[data-crud-field-id="dueDate"] button')
    expect(trigger).not.toBeNull()

    await act(async () => {
      fireEvent.blur(trigger as HTMLButtonElement)
    })

    expect(queryByText('This field is required')).not.toBeInTheDocument()
  })
})
