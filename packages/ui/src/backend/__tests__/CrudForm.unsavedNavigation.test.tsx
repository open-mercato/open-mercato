/** @jest-environment jsdom */
const pushMock = jest.fn()
const confirmDialogMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: confirmDialogMock,
    ConfirmDialogElement: null,
  }),
}))

import * as React from 'react'
import { act, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm unsaved navigation guard', () => {
  const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]

  beforeEach(() => {
    pushMock.mockReset()
    confirmDialogMock.mockReset()
    confirmDialogMock.mockResolvedValue(true)
    window.history.replaceState({}, '', '/current')
  })

  it('blocks history navigation when the user rejects the unsaved-changes prompt', async () => {
    confirmDialogMock.mockResolvedValueOnce(false)

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.confirmUnsavedChanges': 'You have unsaved changes. Are you sure you want to leave?',
        },
      },
    )

    const input = container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alice edited' } })
    })

    await act(async () => {
      window.history.pushState({}, '', '/other')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'You have unsaved changes. Are you sure you want to leave?' }),
    )
    expect(window.location.pathname).toBe('/current')
  })

  it('intercepts same-origin anchor clicks while the form is dirty', async () => {
    confirmDialogMock.mockResolvedValueOnce(false)

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.confirmUnsavedChanges': 'You have unsaved changes. Are you sure you want to leave?',
        },
      },
    )

    const input = container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alice edited' } })
    })

    const anchor = document.createElement('a')
    anchor.href = '/another-page'
    document.body.appendChild(anchor)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      anchor.dispatchEvent(event)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'You have unsaved changes. Are you sure you want to leave?' }),
    )
    expect(event.defaultPrevented).toBe(true)

    anchor.remove()
  })

  it('does not mark an untouched empty text field as dirty on blur before navigation', async () => {
    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{}} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.confirmUnsavedChanges': 'You have unsaved changes. Are you sure you want to leave?',
        },
      },
    )

    const input = container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement

    await act(async () => {
      fireEvent.focus(input)
      fireEvent.blur(input)
    })

    const anchor = document.createElement('a')
    anchor.href = '/another-page'
    document.body.appendChild(anchor)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)

    expect(confirmDialogMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)

    anchor.remove()
  })
})
