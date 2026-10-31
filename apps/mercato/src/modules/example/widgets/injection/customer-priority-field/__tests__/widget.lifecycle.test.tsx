/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import dictionary from '../../../../i18n/en.json'
import widget from '../widget'

const mockReadApi = jest.fn()
const mockFlash = jest.fn()
const mockChrome = { grantedFeatures: ['example.*'] }
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApi(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, action: () => Promise<unknown>) => action(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: mockChrome, isReady: true }) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }) }))
jest.mock('@open-mercato/ui/backend/fields/registry', () => ({ loadGeneratedFieldRegistrations: async () => {} }))
jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({ ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldForms'), fetchCustomFieldFormStructure: async () => ({ definitions: [], metadata: {} }) }))
jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({ ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldDefs'), fetchCustomFieldDefs: async () => [] }))

beforeEach(() => {
  jest.clearAllMocks()
  mockReadApi.mockReset()
})

afterEach(async () => {
  await act(async () => {
    registerCoreInjectionWidgets([])
    registerCoreInjectionTables([])
    registerEnabledModuleIds([])
  })
})

it('keeps contributor failure feedback visible when the real dispatcher continues the native save', async () => {
  const onLoad = jest.fn()
  const onSave = jest.fn(widget.eventHandlers?.onSave)
  const contribution = { ...widget, eventHandlers: { ...widget.eventHandlers, onLoad, onSave } }
  const entry = { moduleId: 'example', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'app' as const, loader: async () => contribution }
  registerCoreInjectionWidgets([entry])
  registerCoreInjectionTables([{ moduleId: 'example', table: { 'crud-form:customers.person:fields': widget.metadata.id } }], [entry])
  registerEnabledModuleIds(['example', 'customers'])
  mockReadApi.mockRejectedValue(new Error('[internal] priority service unavailable'))
  const onSubmit = jest.fn(() => { mockFlash('Person updated.', 'success') })
  const { container, getByLabelText } = renderWithProviders(<CrudForm
    entityId="customers.person"
    resourceKind="customers.person"
    injectionSpotId="crud-form:customers.person"
    fields={[{ id: 'name', label: 'Name', type: 'text' }]}
    groups={[{ id: 'details', fields: ['name'] }]}
    initialValues={{ id: 'person-1', name: 'Native', _example: { priority: 'normal', priorityId: 'priority-1', priorityUpdatedAt: '2026-10-01T10:00:00.000Z' } }}
    onSubmit={onSubmit}
  />, { dict: dictionary })
  await waitFor(() => expect(getByLabelText('Priority')).toBeInTheDocument())
  await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ '_example.priority': 'normal' }), expect.objectContaining({ operation: 'update' }))
  expect(onSubmit.mock.calls[0][0]).toEqual({ id: 'person-1', name: 'Native' })
  expect(mockReadApi).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(mockFlash).toHaveBeenLastCalledWith(dictionary['example.priority.detail.error.save'], 'error'))
})

it('deletes the native record without falling back to a priority write', async () => {
  const onLoad = jest.fn()
  const onAfterDelete = jest.fn(widget.eventHandlers?.onAfterDelete)
  const contribution = { ...widget, eventHandlers: { ...widget.eventHandlers, onLoad, onAfterDelete } }
  const entry = { moduleId: 'example', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'app' as const, loader: async () => contribution }
  registerCoreInjectionWidgets([entry])
  registerCoreInjectionTables([{ moduleId: 'example', table: { 'crud-form:customers.person:fields': widget.metadata.id } }], [entry])
  registerEnabledModuleIds(['example', 'customers'])
  const onDelete = jest.fn()
  const { getByLabelText, getAllByRole } = renderWithProviders(<CrudForm
    entityId="customers.person"
    resourceKind="customers.person"
    injectionSpotId="crud-form:customers.person"
    fields={[{ id: 'name', label: 'Name', type: 'text' }]}
    groups={[{ id: 'details', fields: ['name'] }]}
    initialValues={{ id: 'person-1', name: 'Native', _example: { priority: 'high', priorityId: 'priority-1', priorityUpdatedAt: '2026-10-01T10:00:00.000Z' } }}
    deleteVisible
    onDelete={onDelete}
  />, { dict: { ...dictionary, 'ui.forms.actions.delete': 'Delete' } })
  await waitFor(() => expect(getByLabelText('Priority')).toBeInTheDocument())
  await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
  fireEvent.click(getAllByRole('button', { name: 'Delete', exact: true })[0])
  await waitFor(() => expect(onAfterDelete).toHaveBeenCalledTimes(1))
  expect(onDelete).toHaveBeenCalledTimes(1)
  expect(mockReadApi).not.toHaveBeenCalled()
})
