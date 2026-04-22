/** @jest-environment jsdom */

const pushMock = jest.fn()
const confirmDialogMock = jest.fn()
const triggerEventMock = jest.fn()

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
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerEventMock }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm transform pipeline behavior', () => {
  const fields: CrudField[] = [{ id: 'title', label: 'Title', type: 'text' }]
  const noteFields: CrudField[] = [{ id: 'note', label: 'Note', type: 'text' }]

  beforeEach(() => {
    pushMock.mockReset()
    confirmDialogMock.mockReset()
    confirmDialogMock.mockResolvedValue(true)
    triggerEventMock.mockReset()
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'transformDisplayData') return { data }
      if (event === 'transformFormData') return { data }
      if (event === 'transformValidation') return data
      if (event === 'onBeforeSave') return { ok: true }
      if (event === 'onAfterSave') return { ok: true }
      return { ok: true, data }
    })
    window.history.replaceState({}, '', '/current')
  })

  it('keeps user-visible field values when transformFormData returns transformed payload without applyToForm', async () => {
    function Harness() {
      const [submitted, setSubmitted] = React.useState<Record<string, unknown> | null>(null)

      return (
        <>
          <CrudForm
            title="Form"
            fields={fields}
            initialValues={{ title: 'display me' }}
            injectionSpotId="example:phase-c-handlers"
            onSubmit={(values) => {
              setSubmitted(values)
            }}
          />
          <div data-testid="submitted">{JSON.stringify(submitted)}</div>
        </>
      )
    }

    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'transformFormData') {
        return {
          data: {
            ...data,
            title: typeof data.title === 'string' ? data.title.trim() : data.title,
          },
        }
      }
      if (event === 'onBeforeSave') return { ok: true }
      if (event === 'onAfterSave') return { ok: true }
      return { data }
    })

    const { container } = renderWithProviders(<Harness />, {
      dict: {
        'ui.forms.actions.save': 'Save',
      },
    })

    const input = container.querySelector('[data-crud-field-id="title"] input[type="text"]') as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.change(input, { target: { value: '  spaces around  ' } })
      fireEvent.blur(input)
    })

    await act(async () => {
      fireEvent.submit(form)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('submitted')).toHaveTextContent('"title":"spaces around"')
    expect(input).toHaveValue('  spaces around  ')
  })

  it('updates visible field values when transformFormData returns applyToForm: true', async () => {
    function Harness() {
      const [submitted, setSubmitted] = React.useState<Record<string, unknown> | null>(null)

      return (
        <>
          <CrudForm
            title="Form"
            fields={noteFields}
            initialValues={{ note: '  draft note  ' }}
            injectionSpotId="example:phase-c-handlers"
            onSubmit={(values) => {
              setSubmitted(values)
            }}
          />
          <div data-testid="submitted">{JSON.stringify(submitted)}</div>
        </>
      )
    }

    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'transformFormData') {
        return {
          data: {
            ...data,
            note: 'MAKE ME UPPERCASE',
          },
          applyToForm: true,
        }
      }
      if (event === 'onBeforeSave') return { ok: true }
      if (event === 'onAfterSave') return { ok: true }
      return { data }
    })

    const { container } = renderWithProviders(<Harness />, {
      dict: {
        'ui.forms.actions.save': 'Save',
      },
    })

    const input = container.querySelector('[data-crud-field-id="note"] input[type="text"]') as HTMLInputElement
    const form = container.querySelector('form') as HTMLFormElement

    await act(async () => {
      fireEvent.change(input, { target: { value: 'transform: make me uppercase' } })
      fireEvent.blur(input)
    })

    await act(async () => {
      fireEvent.submit(form)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('submitted')).toHaveTextContent('"note":"MAKE ME UPPERCASE"')
    expect(input).toHaveValue('MAKE ME UPPERCASE')
  })

  it('does not treat transformDisplayData initialization as an unsaved change', async () => {
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => {
      if (event === 'transformDisplayData') {
        return {
          data: {
            ...data,
            title: typeof data.title === 'string' ? data.title.toUpperCase() : data.title,
          },
        }
      }
      return { data, ok: true }
    })

    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ title: 'display me' }}
        injectionSpotId="example:phase-c-handlers"
        onSubmit={() => {}}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.confirmUnsavedChanges': 'Unsaved changes',
        },
      },
    )

    const input = container.querySelector('[data-crud-field-id="title"] input[type="text"]') as HTMLInputElement

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      triggerEventMock.mock.calls.some(([event]) => event === 'transformDisplayData'),
    ).toBe(true)

    const anchor = document.createElement('a')
    anchor.href = '/other'
    document.body.appendChild(anchor)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })

    await act(async () => {
      anchor.dispatchEvent(event)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(confirmDialogMock).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)

    anchor.remove()
  })
})
