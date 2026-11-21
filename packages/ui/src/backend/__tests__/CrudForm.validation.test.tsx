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
import { z } from 'zod'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'
import { createCrudFormError } from '../utils/serverErrors'

describe('CrudForm validation state', () => {
  it.each(['submit', 'blur'])('localizes structured client schema errors on %s', async (validationTrigger) => {
    const onSubmit = jest.fn()
    const { container, getByLabelText, findByText, queryByText } = renderWithProviders(
      <CrudForm
        title="Form"
        schema={z.object({ description: z.string().max(20) })}
        fields={[{ id: 'description', label: 'Description', type: 'text' }]}
        initialValues={{ description: '' }}
        onSubmit={onSubmit}
      />,
      { dict: { 'ui.forms.errors.tooBig': 'Wartość przekracza maksimum {{maximum}}.' } },
    )

    await act(async () => {
      fireEvent.change(getByLabelText('Description'), { target: { value: 'A description exceeding twenty characters' } })
    })
    await act(async () => {
      if (validationTrigger === 'blur') fireEvent.blur(getByLabelText('Description'))
      else fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })

    expect(await findByText('Wartość przekracza maksimum 20.')).toBeInTheDocument()
    expect(queryByText('Too big: expected string to have <=20 characters')).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('localizes nested client schema errors without losing their complete paths', async () => {
    const { container, findByText } = renderWithProviders(
      <CrudForm
        title="Form"
        schema={z.object({ labels: z.array(z.object({ value: z.string().max(3) })) })}
        fields={[]}
        initialValues={{ labels: [{ value: 'Long label' }] }}
        groups={[{ id: 'labels', component: ({ errors }) => <div>{errors['labels.0.value']}</div> }]}
        onSubmit={jest.fn()}
      />,
      { dict: { 'ui.forms.errors.tooBig': 'Value exceeds {{maximum}}.' } },
    )

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })

    expect(await findByText('Value exceeds 3.')).toBeInTheDocument()
  })

  it('preserves explicit client schema messages that start with default wording', async () => {
    const message = 'Too big: use a shorter description'
    const { container, findByText, queryByText } = renderWithProviders(
      <CrudForm
        title="Form"
        schema={z.object({ description: z.string().max(3, message) })}
        fields={[{ id: 'description', label: 'Description', type: 'text' }]}
        initialValues={{ description: 'Long description' }}
        onSubmit={jest.fn()}
      />,
      { dict: { 'ui.forms.errors.tooBig': 'Value exceeds {{maximum}}.' } },
    )

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })

    expect(await findByText(message)).toBeInTheDocument()
    expect(queryByText('Value exceeds 3.')).toBeNull()
  })

  it('renders each custom field error through exactly one declared owner', async () => {
    const fields: CrudField[] = [
      {
        id: 'wrapperOwned',
        label: 'Wrapper owned',
        type: 'custom',
        required: true,
        component: () => <input aria-label="Wrapper owned" />,
      },
      {
        id: 'componentOwned',
        label: 'Component owned',
        type: 'custom',
        required: true,
        rendersOwnError: true,
        component: ({ error }) => (
          <div>{error ? <span data-testid="component-owned-error">{error}</span> : null}</div>
        ),
      },
    ]

    const { container, getByTestId } = renderWithProviders(
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
    const wrapperOwnedField = container.querySelector('[data-crud-field-id="wrapperOwned"]')
    const componentOwnedField = container.querySelector('[data-crud-field-id="componentOwned"]')

    expect(form).not.toBeNull()
    expect(wrapperOwnedField).not.toBeNull()
    expect(componentOwnedField).not.toBeNull()

    await act(async () => {
      fireEvent.submit(form as HTMLFormElement)
    })

    await waitFor(() => {
      expect(wrapperOwnedField?.querySelector('.text-xs.text-status-error-text')).toHaveTextContent('This field is required')
      expect(getByTestId('component-owned-error')).toHaveTextContent('This field is required')
    })

    expect(componentOwnedField?.querySelector('.text-xs.text-status-error-text')).toBeNull()
  })

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

  it('validates number fields on blur only after the user edited them', async () => {
    const fields: CrudField[] = [
      { id: 'title', label: 'Title', type: 'text' },
      { id: 'cf_priority', label: 'Priority', type: 'number', required: true },
    ]

    const { container, findByText, queryByText } = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.errors.required': 'This field is required',
        },
      },
    )

    const priorityInput = container.querySelector('[data-crud-field-id="cf_priority"] input')
    expect(priorityInput).not.toBeNull()

    // Blurring an untouched field must NOT flag the required error — tabbing
    // through an empty form is not an error condition.
    await act(async () => {
      fireEvent.blur(priorityInput as HTMLInputElement)
    })
    expect(queryByText('This field is required')).toBeNull()

    // After the user actually edits the field, clearing it and blurring flags it.
    await act(async () => {
      fireEvent.change(priorityInput as HTMLInputElement, { target: { value: '5' } })
    })
    await act(async () => {
      fireEvent.change(priorityInput as HTMLInputElement, { target: { value: '' } })
    })
    await act(async () => {
      fireEvent.blur(priorityInput as HTMLInputElement)
    })

    expect(await findByText('This field is required')).toBeInTheDocument()
  })

  it('does not run schema validation when an untouched required field blurs', async () => {
    const fields: CrudField[] = [
      { id: 'firstName', label: 'First name', type: 'text', required: true },
    ]
    const schema = z.object({
      firstName: z.string().trim().min(1),
    })

    const { container, findByText, queryByText } = renderWithProviders(
      <CrudForm title="Form" schema={schema} fields={fields} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.errors.required': 'This field is required',
        },
      },
    )

    const firstNameInput = container.querySelector('[data-crud-field-id="firstName"] input[type="text"]')
    expect(firstNameInput).not.toBeNull()

    await act(async () => {
      fireEvent.blur(firstNameInput as HTMLInputElement)
    })

    expect(queryByText('Invalid input: expected string, received undefined')).toBeNull()
    expect(queryByText('This field is required')).toBeNull()

    await act(async () => {
      fireEvent.change(firstNameInput as HTMLInputElement, { target: { value: 'Jane' } })
      fireEvent.change(firstNameInput as HTMLInputElement, { target: { value: '' } })
      fireEvent.blur(firstNameInput as HTMLInputElement)
    })

    expect(await findByText('This field is required')).toBeInTheDocument()
  })

  it('shows a top-level banner and a localized field message when the server rejects with field details', async () => {
    const fields: CrudField[] = [
      { id: 'lastName', label: 'Last name', type: 'text' },
    ]

    const serverError = createCrudFormError('Invalid input', undefined, {
      status: 400,
      details: [
        {
          origin: 'string',
          code: 'too_big',
          maximum: 120,
          path: ['lastName'],
          message: 'Too big: expected string to have <=120 characters',
        },
      ],
    })

    const { container, getByText, queryByText } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        onSubmit={() => {
          throw serverError
        }}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.errors.highlighted': 'Please fix the highlighted errors.',
          'ui.forms.errors.tooBig': 'Value exceeds the maximum of {{maximum}}.',
          'ui.forms.flash.saveError': 'Save failed',
        },
      },
    )

    const form = container.querySelector('form')
    expect(form).not.toBeNull()

    await act(async () => {
      fireEvent.submit(form as HTMLFormElement)
    })

    // The banner stays visible even though a field error exists — it must not
    // be hidden by `formError && !Object.keys(errors).length`.
    await waitFor(() => {
      expect(container.querySelector('.text-sm.text-status-error-text')).toHaveTextContent(
        'Please fix the highlighted errors.',
      )
    })
    expect(getByText('Value exceeds the maximum of 120.')).toBeInTheDocument()
    // The raw, untranslatable Zod message must not leak to the UI.
    expect(queryByText('Too big: expected string to have <=120 characters')).toBeNull()
  })

  it.each([
    {
      name: 'a module translation key',
      message: 'availability.policies.errors.integerTooLarge',
      expected: 'Value is too large for this policy.',
    },
    {
      name: 'custom validator text with a default-message prefix',
      message: 'Too big: use a shorter person name',
      expected: 'Too big: use a shorter person name',
    },
    {
      name: 'custom validator text',
      message: 'Last name is far too long for our records',
      expected: 'Last name is far too long for our records',
    },
  ])('preserves $name supplied on a known Zod code instead of the generic message', async ({ message, expected }) => {
    const fields: CrudField[] = [
      { id: 'lastName', label: 'Last name', type: 'text' },
    ]

    const serverError = createCrudFormError('Invalid input', undefined, {
      status: 400,
      details: [{ origin: 'number', code: 'too_big', maximum: 120, path: ['lastName'], message }],
    })

    const { container, getByText, queryByText } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        onSubmit={() => {
          throw serverError
        }}
      />,
      {
        dict: {
          'availability.policies.errors.integerTooLarge': 'Value is too large for this policy.',
          'ui.forms.actions.save': 'Save',
          'ui.forms.errors.highlighted': 'Please fix the highlighted errors.',
          'ui.forms.errors.tooBig': 'Value exceeds the maximum of {{maximum}}.',
          'ui.forms.flash.saveError': 'Save failed',
        },
      },
    )

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })

    await waitFor(() => {
      expect(getByText(expected)).toBeInTheDocument()
    })
    expect(queryByText('Value exceeds the maximum of 120.')).toBeNull()
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
