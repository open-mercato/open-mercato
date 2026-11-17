/** @jest-environment jsdom */
// Regression (#9225): an injection widget's onBeforeSave/onBeforeDelete can
// block the mutation with an i18n key as `message` (e.g. the record-lock
// conflict toast) instead of literal English text. CrudForm must resolve the
// key through the active dictionary before flashing it — the same way it
// already resolves field-level validation messages.
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { InjectionFieldWidget, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import { registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import { CrudForm, type CrudFormProps } from '../CrudForm'

const mockChrome = { grantedFeatures: ['extension.*'] }
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
jest.mock('../BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: mockChrome, isReady: true }) }))
jest.mock('../confirm-dialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }) }))
jest.mock('../fields/registry', () => ({ loadGeneratedFieldRegistrations: async () => {} }))

const SPOT = 'crud-form:test.lockable'
type Values = Record<string, unknown>

function register(widgets: InjectionFieldWidget[], table: ModuleInjectionTable) {
  const entries: ModuleInjectionWidgetEntry[] = widgets.map((widget) => ({ moduleId: 'test', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'package', loader: async () => widget }))
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'test', table }], entries)
  registerEnabledModuleIds(['test'])
}

function blockingWidget(message: string): InjectionFieldWidget {
  return {
    metadata: { id: 'test.lock', features: ['extension.edit'] },
    fields: [{ id: '_extension.lock', type: 'text', label: 'Lock', group: 'main' }],
    eventHandlers: {
      onBeforeSave: async () => ({ ok: false, message }),
      onBeforeDelete: async () => ({ ok: false, message }),
    },
  }
}

function renderForm(props: Partial<CrudFormProps<Values>> = {}, dict: Record<string, string> = {}) {
  return renderWithProviders(
    <CrudForm<Values>
      injectionSpotId={SPOT}
      fields={[{ id: 'name', label: 'Name', type: 'text' }]}
      groups={[{ id: 'main', title: 'Main', fields: ['name'] }]}
      initialValues={{ id: 'record-1', name: 'Original' }}
      {...props}
    />,
    { dict },
  )
}

beforeEach(() => { register([], {}) })
afterEach(async () => { await act(async () => register([], {})) })

it('translates an onBeforeSave i18n-key message instead of flashing it raw', async () => {
  register([blockingWidget('record_locks.conflict.title')], { [`${SPOT}:fields`]: 'test.lock' })
  const flashed = jest.fn()
  window.addEventListener('flash', flashed as EventListener)
  try {
    const { container, getByLabelText } = renderForm({}, { 'record_locks.conflict.title': 'Translated Conflict' })
    await waitFor(() => expect(getByLabelText('Lock')).toBeInTheDocument())
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(flashed).toHaveBeenCalledTimes(1))
    expect((flashed.mock.calls[0][0] as CustomEvent).detail.message).toBe('Translated Conflict')
  } finally {
    window.removeEventListener('flash', flashed as EventListener)
  }
})

it('leaves a literal (non-key) onBeforeSave message unchanged', async () => {
  register([blockingWidget('This order has shipments.')], { [`${SPOT}:fields`]: 'test.lock' })
  const flashed = jest.fn()
  window.addEventListener('flash', flashed as EventListener)
  try {
    const { container, getByLabelText } = renderForm()
    await waitFor(() => expect(getByLabelText('Lock')).toBeInTheDocument())
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(flashed).toHaveBeenCalledTimes(1))
    expect((flashed.mock.calls[0][0] as CustomEvent).detail.message).toBe('This order has shipments.')
  } finally {
    window.removeEventListener('flash', flashed as EventListener)
  }
})

it('translates an onBeforeDelete i18n-key message instead of flashing it raw', async () => {
  register([blockingWidget('record_locks.conflict.record_deleted_title')], { [`${SPOT}:fields`]: 'test.lock' })
  const flashed = jest.fn()
  window.addEventListener('flash', flashed as EventListener)
  try {
    const { container, getByLabelText } = renderForm(
      { onDelete: jest.fn(), deleteVisible: true },
      { 'record_locks.conflict.record_deleted_title': 'Translated Deleted' },
    )
    await waitFor(() => expect(getByLabelText('Lock')).toBeInTheDocument())
    fireEvent.click(container.querySelector('button[type="button"]')!)
    await waitFor(() => expect(flashed).toHaveBeenCalledTimes(1))
    expect((flashed.mock.calls[0][0] as CustomEvent).detail.message).toBe('Translated Deleted')
  } finally {
    window.removeEventListener('flash', flashed as EventListener)
  }
})
