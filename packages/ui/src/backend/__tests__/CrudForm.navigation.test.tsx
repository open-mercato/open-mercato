/** @jest-environment jsdom */

const mockPush = jest.fn()
const confirmDialogMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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
    mockPush.mockReset()
    confirmDialogMock.mockReset()
    confirmDialogMock.mockResolvedValue(true)
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('registers a beforeunload prompt when the form becomes dirty', async () => {
    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.confirmUnsavedChanges': 'Unsaved changes',
        },
      },
    )

    const input = container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alice updated' } })
    })

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    Object.defineProperty(event, 'returnValue', { writable: true, value: undefined })

    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(event.returnValue).toBe('')
  })

  it('blocks router-driven history pushes until the user confirms leaving', async () => {
    confirmDialogMock.mockResolvedValueOnce(false)

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.confirmUnsavedChanges': 'Unsaved changes',
        },
      },
    )

    const input = container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alice updated' } })
    })

    await act(async () => {
      window.history.pushState({}, '', '/next')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Unsaved changes' }),
    )
    expect(window.location.pathname).toBe('/')

    confirmDialogMock.mockResolvedValueOnce(true)

    await act(async () => {
      window.history.pushState({}, '', '/next')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.location.pathname).toBe('/next')
  })

  it('allows submit-triggered router navigation without showing the unsaved changes prompt', async () => {
    mockPush.mockImplementation((target: string) => {
      void Promise.resolve().then(() => {
        window.history.pushState({}, '', target)
      })
    })
    const onSubmit = jest.fn(async () => {
      mockPush('/created')
    })

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={onSubmit} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.confirmUnsavedChanges': 'Unsaved changes',
        },
      },
    )

    const input = container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alice updated' } })
    })

    await act(async () => {
      fireEvent.submit(form)
      await Promise.resolve()
    })

    expect(onSubmit).toHaveBeenCalled()
    expect(confirmDialogMock).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(window.location.pathname).toBe('/created')

    await act(async () => {
      window.history.pushState({}, '', '/after-save')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(confirmDialogMock).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/after-save')
  })
})
