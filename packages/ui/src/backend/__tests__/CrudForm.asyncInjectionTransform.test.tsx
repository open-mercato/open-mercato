/** @jest-environment jsdom */
const pushMock = jest.fn()
const triggerEventMock = jest.fn()
const confirmDialogMock = jest.fn()
const flashMock = jest.fn()
const mockInjectedDataWidgets: unknown[] = []
let injectionWidgets: Array<{ moduleId: string; widgetId: string; key: string }> = []
let suspendedDisplayTitle: string | null = null
const displaySuspension = new Promise<never>(() => {})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmDialogMock, ConfirmDialogElement: null }),
}))
jest.mock('../FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: ({ data }: { data?: Record<string, unknown> }) => {
    if (suspendedDisplayTitle !== null && data?.title === suspendedDisplayTitle) {
      throw displaySuspension
    }
    return null
  },
  useInjectionWidgets: () => ({ widgets: injectionWidgets, loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerEventMock }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: mockInjectedDataWidgets, isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm asynchronous injection display transforms', () => {
  beforeEach(() => {
    injectionWidgets = []
    suspendedDisplayTitle = null
    confirmDialogMock.mockReset()
    confirmDialogMock.mockResolvedValue(false)
    flashMock.mockReset()
    triggerEventMock.mockReset()
    triggerEventMock.mockImplementation(async (event: string, data: Record<string, unknown>) => ({
      data: event === 'transformDisplayData' && injectionWidgets.length > 0
        ? { ...data, title: String(data.title).toUpperCase() }
        : data,
      ok: true,
    }))
  })

  it('reapplies initial display data when an injection widget loads after the record', async () => {
    const fields: CrudField[] = [{ id: 'title', label: 'Title', type: 'text' }]
    const renderForm = () => (
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ title: 'display me' }}
        injectionSpotId="example:async-widget"
        onSubmit={() => {}}
      />
    )
    const rendered = renderWithProviders(renderForm(), {
      dict: { 'ui.forms.actions.save': 'Save' },
    })
    const input = rendered.container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement

    await act(async () => {
      await Promise.resolve()
    })
    expect(input).toHaveValue('display me')

    injectionWidgets = [{ moduleId: 'example', widgetId: 'example.async-widget', key: 'example:async-widget' }]
    rendered.rerender(renderForm())
    await waitFor(() => {
      expect(triggerEventMock.mock.calls.filter(([event]) => event === 'transformDisplayData')).toHaveLength(2)
    })
    await waitFor(() => {
      expect(triggerEventMock).toHaveBeenCalledWith(
        'transformDisplayData',
        expect.objectContaining({ title: 'display me' }),
        expect.anything(),
      )
      expect(input).toHaveValue('DISPLAY ME')
    })
  })

  it('does not commit a dirty baseline from an interrupted display transform', async () => {
    let resolveTransform: ((result: { ok: true; data: Record<string, unknown> }) => void) | null = null
    injectionWidgets = [{ moduleId: 'example', widgetId: 'example.async-widget', key: 'example:async-widget' }]
    triggerEventMock.mockImplementation((event: string, data: Record<string, unknown>) => {
      if (event !== 'transformDisplayData') return Promise.resolve({ ok: true, data })
      return new Promise<{ ok: true; data: Record<string, unknown> }>((resolve) => {
        resolveTransform = resolve
      })
    })
    const fields: CrudField[] = [{ id: 'title', label: 'Title', type: 'text' }]
    const rendered = renderWithProviders(
      <React.Suspense fallback={<div data-testid="display-transform-suspended" />}>
        <CrudForm
          title="Form"
          fields={fields}
          initialValues={{ title: 'display me' }}
          injectionSpotId="example:async-widget"
          onSubmit={() => {}}
        />
      </React.Suspense>,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.confirmUnsavedChanges': 'Unsaved changes',
        },
      },
    )
    const input = rendered.container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement

    await waitFor(() => expect(resolveTransform).not.toBeNull())
    suspendedDisplayTitle = 'DISPLAY ME'
    await act(async () => {
      resolveTransform?.({ ok: true, data: { title: 'DISPLAY ME' } })
      await Promise.resolve()
    })
    await waitFor(() => expect(rendered.getByTestId('display-transform-suspended')).toBeInTheDocument())

    suspendedDisplayTitle = null
    await act(async () => {
      fireEvent.change(input, { target: { value: 'DISPLAY ME' } })
      await Promise.resolve()
    })
    await waitFor(() => expect(input).toHaveValue('DISPLAY ME'))

    const anchor = document.createElement('a')
    anchor.href = '/other'
    document.body.appendChild(anchor)
    const navigationEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => {
      anchor.dispatchEvent(navigationEvent)
      await Promise.resolve()
    })

    expect(confirmDialogMock).toHaveBeenCalled()
    expect(navigationEvent.defaultPrevented).toBe(true)
    anchor.remove()
  })

  it('composes an async widget side effect with a user edit queued in the same batch', async () => {
    const noteEventPayloads: Record<string, unknown>[] = []
    let resolveFieldChange: ((result: {
      ok: true
      fieldChange: { sideEffects: Record<string, unknown> }
    }) => void) | null = null
    triggerEventMock.mockImplementation((event: string, data: Record<string, unknown>, _context: unknown, meta?: { fieldId?: string }) => {
      if (event === 'onFieldChange' && meta?.fieldId === 'title') {
        return new Promise((resolve) => {
          resolveFieldChange = resolve
        })
      }
      if (event === 'onFieldChange' && meta?.fieldId === 'note') {
        noteEventPayloads.push(data)
      }
      return Promise.resolve({ ok: true, data })
    })
    const fields: CrudField[] = [
      { id: 'title', label: 'Title', type: 'text' },
      { id: 'widgetValue', label: 'Widget value', type: 'text' },
      { id: 'note', label: 'Note', type: 'text' },
    ]
    const rendered = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ title: 'Original', widgetValue: '', note: '' }}
        injectionSpotId="example:async-widget"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )
    const titleInput = rendered.container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement
    const widgetInput = rendered.container.querySelector('[data-crud-field-id="widgetValue"] input') as HTMLInputElement
    const noteInput = rendered.container.querySelector('[data-crud-field-id="note"] input') as HTMLInputElement

    fireEvent.change(titleInput, { target: { value: 'Changed' } })
    await waitFor(() => expect(resolveFieldChange).not.toBeNull())

    await act(async () => {
      resolveFieldChange?.({
        ok: true,
        fieldChange: { sideEffects: { widgetValue: 'from widget' } },
      })
      await Promise.resolve()
      fireEvent.change(noteInput, { target: { value: 'from user' } })
    })

    expect(widgetInput).toHaveValue('from widget')
    expect(noteInput).toHaveValue('from user')
    await waitFor(() => {
      expect(noteEventPayloads).toContainEqual(expect.objectContaining({
        widgetValue: 'from widget',
        note: 'from user',
      }))
    })
  })

  it('drops a slow field result after a newer revision and dispatches the newer event with matching data', async () => {
    let resolveFirstChange: ((result: {
      ok: true
      fieldChange: { value: string }
    }) => void) | null = null
    const secondChangePayloads: Array<{
      data: Record<string, unknown>
      fieldValue: unknown
    }> = []
    triggerEventMock.mockImplementation((event: string, data: Record<string, unknown>, _context: unknown, meta?: {
      fieldId?: string
      fieldValue?: unknown
    }) => {
      if (event !== 'onFieldChange') return Promise.resolve({ ok: true, data })
      if (meta?.fieldValue === 'A') {
        return new Promise((resolve) => {
          resolveFirstChange = resolve
        })
      }
      if (meta?.fieldValue === 'B') {
        secondChangePayloads.push({ data, fieldValue: meta.fieldValue })
        return Promise.resolve({ ok: true, fieldChange: { value: 'B' } })
      }
      return Promise.resolve({ ok: true })
    })
    const rendered = renderWithProviders(
      <CrudForm
        title="Form"
        fields={[{ id: 'title', label: 'Title', type: 'text' }]}
        initialValues={{ title: 'Original' }}
        injectionSpotId="example:async-widget"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )
    const titleInput = rendered.container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement

    fireEvent.change(titleInput, { target: { value: 'A' } })
    await waitFor(() => expect(resolveFirstChange).not.toBeNull())
    fireEvent.change(titleInput, { target: { value: 'B' } })
    expect(titleInput).toHaveValue('B')

    await act(async () => {
      resolveFirstChange?.({ ok: true, fieldChange: { value: 'A' } })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(secondChangePayloads).toContainEqual({
        data: expect.objectContaining({ title: 'B' }),
        fieldValue: 'B',
      })
    })
    expect(titleInput).toHaveValue('B')
  })

  it('does not apply a slow field side effect to a target edited after dispatch', async () => {
    let resolveTitleChange: ((result: {
      ok: true
      fieldChange: { value: string; sideEffects: Record<string, unknown> }
    }) => void) | null = null
    let resolveNoteChange: ((result: {
      ok: true
      fieldChange: { value: string }
    }) => void) | null = null
    const noteEventPayloads: Record<string, unknown>[] = []
    triggerEventMock.mockImplementation((event: string, data: Record<string, unknown>, _context: unknown, meta?: {
      fieldId?: string
    }) => {
      if (event !== 'onFieldChange') return Promise.resolve({ ok: true, data })
      if (meta?.fieldId === 'title') {
        return new Promise((resolve) => {
          resolveTitleChange = resolve
        })
      }
      if (meta?.fieldId === 'note') {
        noteEventPayloads.push(data)
        return new Promise((resolve) => {
          resolveNoteChange = resolve
        })
      }
      return Promise.resolve({ ok: true })
    })
    const rendered = renderWithProviders(
      <CrudForm
        title="Form"
        fields={[
          { id: 'title', label: 'Title', type: 'text' },
          { id: 'note', label: 'Note', type: 'text' },
        ]}
        initialValues={{ title: 'Original', note: '' }}
        injectionSpotId="example:async-widget"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )
    const getTitleInput = () => rendered.container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement
    const getNoteInput = () => rendered.container.querySelector('[data-crud-field-id="note"] input') as HTMLInputElement

    fireEvent.change(getTitleInput(), { target: { value: 'Changed title' } })
    await waitFor(() => expect(resolveTitleChange).not.toBeNull())
    fireEvent.change(getNoteInput(), { target: { value: 'User note' } })

    await act(async () => {
      resolveTitleChange?.({
        ok: true,
        fieldChange: {
          value: 'Normalized title',
          sideEffects: { note: 'Stale widget note' },
        },
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(resolveNoteChange).not.toBeNull())
    expect(getNoteInput()).toHaveValue('User note')
    expect(noteEventPayloads).toContainEqual(expect.objectContaining({
      title: 'Normalized title',
      note: 'User note',
    }))

    await act(async () => {
      resolveNoteChange?.({ ok: true, fieldChange: { value: 'User note' } })
      await Promise.resolve()
    })
    expect(getNoteInput()).toHaveValue('User note')
  })

  it('does not apply a queued field side effect to a target edited before dispatch', async () => {
    let resolveBlockingChange: ((result: {
      ok: true
      fieldChange: { value: string }
    }) => void) | null = null
    let resolveQueuedTitleChange: ((result: {
      ok: true
      fieldChange: { value: string; sideEffects: Record<string, unknown> }
    }) => void) | null = null
    const queuedTitlePayloads: Record<string, unknown>[] = []
    const notePayloads: Record<string, unknown>[] = []
    triggerEventMock.mockImplementation((event: string, data: Record<string, unknown>, _context: unknown, meta?: {
      fieldId?: string
      fieldValue?: unknown
    }) => {
      if (event !== 'onFieldChange') return Promise.resolve({ ok: true, data })
      if (meta?.fieldId === 'blocker') {
        return new Promise((resolve) => {
          resolveBlockingChange = resolve
        })
      }
      if (meta?.fieldId === 'title') {
        queuedTitlePayloads.push(data)
        return new Promise((resolve) => {
          resolveQueuedTitleChange = resolve
        })
      }
      if (meta?.fieldId === 'note') {
        notePayloads.push(data)
        return Promise.resolve({ ok: true, fieldChange: { value: meta.fieldValue } })
      }
      return Promise.resolve({ ok: true })
    })
    const rendered = renderWithProviders(
      <CrudForm
        title="Form"
        fields={[
          { id: 'blocker', label: 'Blocker', type: 'text' },
          { id: 'title', label: 'Title', type: 'text' },
          { id: 'note', label: 'Note', type: 'text' },
        ]}
        initialValues={{ blocker: '', title: '', note: '' }}
        injectionSpotId="example:async-widget"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )
    const getInput = (fieldId: string) => rendered.container.querySelector(
      `[data-crud-field-id="${fieldId}"] input`,
    ) as HTMLInputElement

    fireEvent.change(getInput('blocker'), { target: { value: 'X' } })
    await waitFor(() => expect(resolveBlockingChange).not.toBeNull())
    fireEvent.change(getInput('title'), { target: { value: 'A' } })
    fireEvent.change(getInput('note'), { target: { value: 'User note' } })

    await act(async () => {
      resolveBlockingChange?.({ ok: true, fieldChange: { value: 'X' } })
      await Promise.resolve()
    })
    await waitFor(() => expect(resolveQueuedTitleChange).not.toBeNull())
    expect(queuedTitlePayloads).toContainEqual(expect.objectContaining({
      title: 'A',
      note: 'User note',
    }))

    await act(async () => {
      resolveQueuedTitleChange?.({
        ok: true,
        fieldChange: {
          value: 'A normalized',
          sideEffects: { note: 'Stale queued note' },
        },
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(notePayloads).toHaveLength(1))
    expect(getInput('note')).toHaveValue('User note')
    expect(notePayloads).toContainEqual(expect.objectContaining({
      title: 'A normalized',
      note: 'User note',
    }))
  })

  it('invalidates queued and in-flight field events when the initial record generation changes', async () => {
    let resolveOldChange: ((result: {
      ok: true
      fieldChange: {
        value: string
        sideEffects: Record<string, unknown>
        messages: Array<{ text: string; severity: 'error' }>
      }
    }) => void) | null = null
    let queuedOldChangeCalls = 0
    const freshChangePayloads: Record<string, unknown>[] = []
    triggerEventMock.mockImplementation((event: string, data: Record<string, unknown>, _context: unknown, meta?: {
      fieldValue?: unknown
    }) => {
      if (event !== 'onFieldChange') return Promise.resolve({ ok: true, data })
      if (meta?.fieldValue === 'old-active') {
        return new Promise((resolve) => {
          resolveOldChange = resolve
        })
      }
      if (meta?.fieldValue === 'old-queued') {
        queuedOldChangeCalls += 1
        return Promise.resolve({ ok: true })
      }
      if (meta?.fieldValue === 'fresh') {
        freshChangePayloads.push(data)
        return Promise.resolve({
          ok: true,
          fieldChange: {
            sideEffects: { marker: 'fresh marker' },
            messages: [{ text: 'fresh message', severity: 'info' }],
          },
        })
      }
      return Promise.resolve({ ok: true })
    })
    const fields: CrudField[] = [
      { id: 'title', label: 'Title', type: 'text' },
      { id: 'note', label: 'Note', type: 'text' },
      { id: 'marker', label: 'Marker', type: 'text' },
    ]
    const renderForm = (initialValues: Record<string, unknown>) => (
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={initialValues}
        injectionSpotId="example:async-widget"
        onSubmit={() => {}}
      />
    )
    const rendered = renderWithProviders(
      renderForm({ id: 'record-1', title: 'First', note: '', marker: 'first marker' }),
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )
    const titleInput = rendered.container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement
    const noteInput = rendered.container.querySelector('[data-crud-field-id="note"] input') as HTMLInputElement
    const markerInput = rendered.container.querySelector('[data-crud-field-id="marker"] input') as HTMLInputElement

    fireEvent.change(titleInput, { target: { value: 'old-active' } })
    await waitFor(() => expect(resolveOldChange).not.toBeNull())
    fireEvent.change(noteInput, { target: { value: 'old-queued' } })

    rendered.rerender(renderForm({ id: 'record-2', title: 'Second', note: '', marker: 'new marker' }))
    await waitFor(() => expect(markerInput).toHaveValue('new marker'))

    fireEvent.change(noteInput, { target: { value: 'fresh' } })
    await waitFor(() => expect(freshChangePayloads).toHaveLength(1))
    await waitFor(() => expect(markerInput).toHaveValue('fresh marker'))

    await act(async () => {
      resolveOldChange?.({
        ok: true,
        fieldChange: {
          value: 'stale result',
          sideEffects: { marker: 'stale marker' },
          messages: [{ text: 'stale message', severity: 'error' }],
        },
      })
      await Promise.resolve()
    })

    expect(queuedOldChangeCalls).toBe(0)
    expect(markerInput).toHaveValue('fresh marker')
    expect(flashMock).toHaveBeenCalledWith('fresh message', 'info')
    expect(flashMock).not.toHaveBeenCalledWith('stale message', 'error')
  })

  it('ignores an in-flight field result after unmount', async () => {
    let resolveFieldChange: ((result: {
      ok: true
      fieldChange: {
        sideEffects: Record<string, unknown>
        messages: Array<{ text: string; severity: 'error' }>
      }
    }) => void) | null = null
    triggerEventMock.mockImplementation((event: string, data: Record<string, unknown>) => {
      if (event !== 'onFieldChange') return Promise.resolve({ ok: true, data })
      return new Promise((resolve) => {
        resolveFieldChange = resolve
      })
    })
    const rendered = renderWithProviders(
      <CrudForm
        title="Form"
        fields={[{ id: 'title', label: 'Title', type: 'text' }]}
        initialValues={{ title: 'Original' }}
        injectionSpotId="example:async-widget"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )
    const titleInput = rendered.container.querySelector('[data-crud-field-id="title"] input') as HTMLInputElement

    fireEvent.change(titleInput, { target: { value: 'pending' } })
    await waitFor(() => expect(resolveFieldChange).not.toBeNull())
    rendered.unmount()

    await act(async () => {
      resolveFieldChange?.({
        ok: true,
        fieldChange: {
          sideEffects: { title: 'stale result' },
          messages: [{ text: 'stale message', severity: 'error' }],
        },
      })
      await Promise.resolve()
    })

    expect(flashMock).not.toHaveBeenCalledWith('stale message', 'error')
  })
})
