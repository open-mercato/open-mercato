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

const DICT = {
  'ui.forms.actions.save': 'Save',
  'ui.forms.errors.highlighted': 'Please fix the highlighted errors.',
  'ui.forms.errors.required': 'This field is required',
}
const REQUIRED = 'This field is required'

// A failed validation used to render only a line of text under the field: the
// control was not marked invalid, nothing tied the message to it, and nothing
// was announced, so a screen reader user could not tell which field was wrong.
describe('CrudForm field error association', () => {
  function renderForm(fields: CrudField[]) {
    const result = renderWithProviders(<CrudForm title="Form" fields={fields} onSubmit={() => {}} />, { dict: DICT })
    const form = result.container.querySelector('form') as HTMLFormElement
    const field = (id: string) => result.container.querySelector(`[data-crud-field-id="${id}"]`) as HTMLElement
    const errorNode = (id: string) => field(id).querySelector<HTMLElement>('.text-xs.text-status-error-text')
    const announcement = (id: string) => field(id).querySelector<HTMLElement>('[aria-live="polite"]')
    const submit = async () => {
      await act(async () => {
        fireEvent.submit(form)
      })
    }
    return { ...result, field, errorNode, announcement, submit }
  }

  const describedBy = (element: Element | null) => (element?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)

  it('marks a failing text input invalid and describes it by its message', async () => {
    const { field, errorNode, submit } = renderForm([{ id: 'name', label: 'Name', type: 'text', required: true }])
    const input = field('name').querySelector('input') as HTMLInputElement
    expect(input).not.toHaveAttribute('aria-invalid')

    await submit()

    await waitFor(() => expect(errorNode('name')).toHaveTextContent(REQUIRED))
    const message = errorNode('name') as HTMLElement
    expect(message.id).not.toBe('')
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(describedBy(input)).toContain(message.id)
  })

  it('marks a failing select trigger invalid and describes it by its message', async () => {
    const { field, errorNode, submit } = renderForm([
      { id: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'open', label: 'Open' }] },
    ])

    await submit()

    await waitFor(() => expect(errorNode('status')).toHaveTextContent(REQUIRED))
    const trigger = field('status').querySelector('[role="combobox"]') as HTMLElement
    await waitFor(() => expect(trigger).toHaveAttribute('aria-invalid', 'true'))
    expect(describedBy(trigger)).toContain((errorNode('status') as HTMLElement).id)
  })

  it('describes a checkbox group by its message', async () => {
    const { field, errorNode, submit } = renderForm([
      {
        id: 'channels',
        label: 'Channels',
        type: 'select',
        multiple: true,
        required: true,
        options: [{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }],
      },
    ])

    await submit()

    await waitFor(() => expect(errorNode('channels')).toHaveTextContent(REQUIRED))
    const group = field('channels').querySelector('[role="group"]') as HTMLElement
    expect(describedBy(group)).toContain((errorNode('channels') as HTMLElement).id)
  })

  it('clears the invalid state and the description once the field is corrected', async () => {
    const { field, errorNode, submit } = renderForm([{ id: 'name', label: 'Name', type: 'text', required: true }])
    const input = field('name').querySelector('input') as HTMLInputElement

    await submit()
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    const messageId = (errorNode('name') as HTMLElement).id

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Mia' } })
    })

    await waitFor(() => expect(errorNode('name')).toBeNull())
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(describedBy(input)).not.toContain(messageId)
  })

  it('announces a field error politely, naming the field', async () => {
    const { announcement, submit } = renderForm([{ id: 'name', label: 'Name', type: 'text', required: true }])
    expect(announcement('name')).not.toBeNull()
    expect(announcement('name')).toHaveTextContent('')

    await submit()

    await waitFor(() => expect(announcement('name')).toHaveTextContent(`Name: ${REQUIRED}`))
    expect(announcement('name')).toHaveAttribute('aria-atomic', 'true')
  })

  it('stops announcing once the field is corrected', async () => {
    const { field, announcement, submit } = renderForm([{ id: 'name', label: 'Name', type: 'text', required: true }])
    const input = field('name').querySelector('input') as HTMLInputElement

    await submit()
    await waitFor(() => expect(announcement('name')).toHaveTextContent(`Name: ${REQUIRED}`))

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Mia' } })
    })

    await waitFor(() => expect(announcement('name')).toHaveTextContent(''))
  })

  it('announces a wrapper-owned custom field error even without a control to mark', async () => {
    const { errorNode, announcement, submit } = renderForm([
      { id: 'custom', label: 'Custom', type: 'custom', required: true, component: () => <input aria-label="Custom" /> },
    ])

    await submit()

    await waitFor(() => expect(errorNode('custom')).toHaveTextContent(REQUIRED))
    expect(announcement('custom')).toHaveTextContent(`Custom: ${REQUIRED}`)
  })

  it('leaves a field that renders its own error alone', async () => {
    const { field, errorNode, announcement, getByTestId, submit } = renderForm([
      {
        id: 'owned',
        label: 'Owned',
        type: 'custom',
        required: true,
        rendersOwnError: true,
        component: ({ error }) => (
          <div>
            <input aria-label="Owned" />
            {error ? <span role="alert" data-testid="owned-error">{error}</span> : null}
          </div>
        ),
      },
    ])

    await submit()

    await waitFor(() => expect(getByTestId('owned-error')).toHaveTextContent(REQUIRED))
    expect(errorNode('owned')).toBeNull()
    expect(announcement('owned')).toBeNull()
    expect(field('owned').querySelector('input')).not.toHaveAttribute('aria-invalid')
  })
})
