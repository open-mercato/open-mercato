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

const FIELDS: CrudField[] = [
  { id: 'nickname', label: 'Nickname', type: 'text' },
  { id: 'firstName', label: 'First name', type: 'text', required: true },
  { id: 'lastName', label: 'Last name', type: 'text', required: true },
]

// Submitting blurs the active control (to commit buffered input), so a failed
// submit has to put focus somewhere or a keyboard user is left on <body> with no
// indication of what to fix. CrudForm moves it to the first invalid field.
describe('CrudForm focus after a failed submit', () => {
  function renderForm(fields: CrudField[] = FIELDS) {
    const result = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} disableInitialFocus />,
      { dict: DICT },
    )
    const form = result.container.querySelector('form') as HTMLFormElement
    const input = (id: string) => result.container.querySelector(`[data-crud-field-id="${id}"] input`) as HTMLInputElement
    const errorOf = (id: string) => result.container.querySelector(`[data-crud-field-id="${id}"] .text-xs.text-status-error-text`)
    const submit = async () => {
      await act(async () => {
        fireEvent.submit(form)
      })
    }
    return { ...result, form, input, errorOf, submit }
  }

  it('moves focus to the first invalid field when focus was on a control inside the form', async () => {
    const { form, input, errorOf, submit } = renderForm()
    const insideForm = document.createElement('button')
    insideForm.type = 'button'
    form.appendChild(insideForm)
    insideForm.focus()

    await submit()

    await waitFor(() => expect(errorOf('firstName')).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(input('firstName')))
  })

  it('moves focus to the first invalid field when the submit came from another field', async () => {
    const { input, errorOf, submit } = renderForm()
    input('nickname').focus()

    await submit()

    await waitFor(() => expect(errorOf('firstName')).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(input('firstName')))
  })

  it('skips an invalid field that has nothing to focus and takes the next one', async () => {
    // The person form's first required field is a display-name preview with no
    // input of its own. Trying only the first error left focus on <body>.
    const { input, errorOf, submit } = renderForm([
      { id: 'preview', label: 'Preview', type: 'custom', required: true, component: () => <div>Mia Johnson</div> },
      { id: 'locked', label: 'Locked', type: 'text', required: true, disabled: true },
      ...FIELDS,
    ])
    input('nickname').focus()

    await submit()

    await waitFor(() => expect(errorOf('preview')).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(input('firstName')))
  })

  it('returns to the first invalid field when the same submit fails again', async () => {
    const { input, errorOf, submit } = renderForm()

    await submit()
    await waitFor(() => expect(document.activeElement).toBe(input('firstName')))
    input('nickname').focus()

    await submit()

    await waitFor(() => expect(errorOf('firstName')).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(input('firstName')))
  })

  it('keeps focus in the field being corrected instead of jumping to the next error', async () => {
    const { input, errorOf, submit } = renderForm()

    await submit()
    await waitFor(() => expect(document.activeElement).toBe(input('firstName')))

    await act(async () => {
      fireEvent.change(input('firstName'), { target: { value: 'Mia' } })
    })

    await waitFor(() => expect(errorOf('firstName')).toBeNull())
    expect(errorOf('lastName')).not.toBeNull()
    expect(document.activeElement).toBe(input('firstName'))
  })
})
