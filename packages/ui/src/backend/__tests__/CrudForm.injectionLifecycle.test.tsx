/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { InjectionFieldWidget, InjectionWidgetModule, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import { registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import { CrudForm, type CrudFormProps } from '../CrudForm'

const mockChrome = { grantedFeatures: ['extension.*'] }
const mockFetchStructure = jest.fn(async (..._args: unknown[]) => ({ definitions: [], metadata: {} }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
jest.mock('../BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: mockChrome, isReady: true }) }))
jest.mock('../confirm-dialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }) }))
jest.mock('../fields/registry', () => ({ loadGeneratedFieldRegistrations: async () => {} }))
jest.mock('../utils/customFieldForms', () => ({ ...jest.requireActual('../utils/customFieldForms'), fetchCustomFieldFormStructure: (...args: unknown[]) => mockFetchStructure(...args) }))
jest.mock('../utils/customFieldDefs', () => ({ ...jest.requireActual('../utils/customFieldDefs'), fetchCustomFieldDefs: async () => [] }))

const SPOT = 'crud-form:test.person'
const LEGACY = 'crud-form:test.customer_entity'
type Values = Record<string, unknown>
type TestWidget = InjectionFieldWidget | InjectionWidgetModule<Record<string, unknown>, Values>

function register(widgets: TestWidget[], table: ModuleInjectionTable, enabled = ['test']) {
  const entries: ModuleInjectionWidgetEntry[] = widgets.map((widget) => ({ moduleId: 'test', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'package', loader: async () => widget }))
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'test', table }], entries)
  registerEnabledModuleIds(enabled)
}

function fieldWidget(id = 'test.priority', handlers: InjectionFieldWidget['eventHandlers'] = {}): InjectionFieldWidget {
  return {
    metadata: { id, features: ['extension.edit'] },
    fields: [{ id: '_extension.priority', type: 'text', label: 'Priority', group: 'details' }],
    eventHandlers: handlers,
  }
}

function renderForm(props: Partial<CrudFormProps<Values>> = {}) {
  return renderWithProviders(<CrudForm<Values>
    injectionSpotId={SPOT}
    fields={[{ id: 'name', label: 'Name', type: 'text' }]}
    groups={[{ id: 'main', title: 'Main', fields: ['name'] }, { id: 'fallback', title: 'Fallback', fields: [] }]}
    injectionGroupAliases={{ details: 'main' }}
    initialValues={{ id: 'record-1', name: 'Original', _extension: { priority: 'normal' } }}
    {...props}
  />)
}

beforeEach(() => {
  mockChrome.grantedFeatures = ['extension.*']
  mockFetchStructure.mockClear()
  register([], {})
})
afterEach(async () => { await act(async () => register([], {})) })

it('runs rendered then headless handlers once across canonical, legacy and wildcard registrations', async () => {
  const order: string[] = []
  const rootLoad = jest.fn()
  const fieldLoad = jest.fn()
  const nativeSubmit = jest.fn((values: Values) => { order.push('native'); expect(values).toEqual({ id: 'record-1', name: 'Changed' }) })
  const root: TestWidget = { metadata: { id: 'test.root', title: 'Root' }, Widget: () => <span>Root</span>, eventHandlers: { onLoad: rootLoad, onBeforeSave: async () => { order.push('root-before') }, onSave: async () => { order.push('root-save') }, onAfterSave: async () => { order.push('root-after') } } }
  const field = fieldWidget('test.priority', {
    onLoad: fieldLoad,
    onBeforeSave: async (data) => { order.push('field-before'); expect(data['_extension.priority']).toBe('high'); expect(data._extension).toEqual({ priority: 'high' }); return true },
    onSave: async () => { order.push('field-save') },
    onAfterSave: async () => { order.push('field-after') },
  })
  register([root, field], { [SPOT]: 'test.root', [LEGACY]: 'test.root', [`${SPOT}:fields`]: { widgetId: 'test.priority', priority: 20 }, [`${LEGACY}:fields`]: 'test.priority', 'crud-form:*:fields': { widgetId: 'test.priority', priority: 10 } })
  const { container, getByLabelText, getByText } = renderForm({ legacyInjectionSpotId: LEGACY, schema: z.object({ id: z.string(), name: z.string() }).passthrough(), onSubmit: nativeSubmit })
  await waitFor(() => expect(fieldLoad).toHaveBeenCalledTimes(1))
  expect(rootLoad).toHaveBeenCalledTimes(1)
  expect(container.querySelectorAll('input[id="_extension.priority"]')).toHaveLength(1)
  expect(getByText('Main').parentElement).toContainElement(getByLabelText('Priority'))
  expect(getByText('Fallback').parentElement).not.toContainElement(getByLabelText('Priority'))
  fireEvent.change(container.querySelector('[data-crud-field-id="name"] input')!, { target: { value: 'Changed' } })
  fireEvent.change(getByLabelText('Priority'), { target: { value: 'high' } })
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(nativeSubmit).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(order).toEqual(['root-before', 'field-before', 'root-save', 'field-save', 'native', 'root-after', 'field-after']))
  expect(fieldLoad.mock.calls[0][0]).toEqual(expect.objectContaining({ recordId: 'record-1', sharedState: expect.any(Object) }))
})

it('headless validation blocks save, then transformations and visible contributor values reach handlers only', async () => {
  const saved = jest.fn()
  const nativeSubmit = jest.fn()
  const field = fieldWidget('test.priority', {
    onBeforeSave: async (data) => data['_extension.priority'] === 'blocked' ? { ok: false, fieldErrors: { '_extension.priority': 'Invalid priority' } } : true,
    transformFormData: async (data) => ({ ...data, name: 'Transformed' }),
    onSave: saved,
  })
  field.fields.push({ id: '_extension.secret', label: 'Secret', type: 'text', group: 'details', visibleWhen: { field: 'name', operator: 'eq', value: 'Visible' } })
  register([field], { [`${SPOT}:fields`]: 'test.priority' })
  const { container, getByLabelText } = renderForm({ initialValues: { id: 'record-1', name: 'Original', _extension: { priority: 'blocked', secret: 'hidden' } }, onSubmit: nativeSubmit })
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('blocked'))
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(container.textContent).toContain('Invalid priority'))
  expect(nativeSubmit).not.toHaveBeenCalled()
  expect(saved).not.toHaveBeenCalled()
  fireEvent.change(getByLabelText('Priority'), { target: { value: 'high' } })
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(nativeSubmit).toHaveBeenCalledTimes(1))
  expect(nativeSubmit.mock.calls[0][0]).toEqual({ id: 'record-1', name: 'Transformed' })
  expect(saved.mock.calls[0][0]).toEqual({ id: 'record-1', name: 'Transformed', _extension: { priority: 'high' }, '_extension.priority': 'high' })
})

it('does not render or execute denied, disabled or dependency-disabled headless widgets', async () => {
  const denied = fieldWidget('test.denied', { onLoad: jest.fn(), onSave: jest.fn() })
  denied.metadata.features = ['denied.edit']
  const disabled = fieldWidget('test.disabled', { onLoad: jest.fn(), onSave: jest.fn() })
  disabled.metadata.enabled = false
  const dependency = fieldWidget('test.dependency', { onLoad: jest.fn(), onSave: jest.fn() })
  dependency.metadata.requiredModules = ['missing']
  register([denied, disabled, dependency], { [`${SPOT}:fields`]: ['test.denied', 'test.disabled', 'test.dependency'] })
  const nativeSubmit = jest.fn()
  const { container } = renderForm({ onSubmit: nativeSubmit })
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(nativeSubmit).toHaveBeenCalledTimes(1))
  expect(container.querySelector('[data-crud-field-id="_extension.priority"]')).toBeNull()
  for (const widget of [denied, disabled, dependency]) {
    expect(widget.eventHandlers?.onLoad).not.toHaveBeenCalled()
    expect(widget.eventHandlers?.onSave).not.toHaveBeenCalled()
  }
})

it('late registration hydrates fields without overwriting user edits and pristine reload updates them', async () => {
  const onLoad = jest.fn()
  const { container, getByLabelText, rerender } = renderForm()
  fireEvent.change(container.querySelector('[data-crud-field-id="name"] input')!, { target: { value: 'Typed before bootstrap' } })
  await act(async () => register([fieldWidget('test.priority', { onLoad })], { [`${SPOT}:fields`]: 'test.priority' }))
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('normal'))
  expect(container.querySelector('[data-crud-field-id="name"] input')!).toHaveValue('Typed before bootstrap')
  expect(onLoad).toHaveBeenCalledTimes(1)
  fireEvent.change(getByLabelText('Priority'), { target: { value: 'user-edit' } })
  rerender(<CrudForm<Values> injectionSpotId={SPOT} fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ id: 'record-1', name: 'Reloaded', _extension: { priority: 'remote' } }} />)
  await act(async () => {})
  expect(getByLabelText('Priority')).toHaveValue('user-edit')
  expect(container.querySelectorAll('form')).toHaveLength(1)
})

it('rehydrates untouched flat contributed values from a fresh namespace', async () => {
  register([fieldWidget()], { [`${SPOT}:fields`]: 'test.priority' })
  const { getByLabelText, rerender } = renderForm()
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('normal'))
  rerender(<CrudForm<Values> injectionSpotId={SPOT} fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ id: 'record-1', name: 'Reloaded', _extension: { priority: 'remote' } }} />)
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('remote'))
})

it('supplies injected-only controls to bare groups without duplicating native fields', async () => {
  register([fieldWidget()], { [`${SPOT}:fields`]: 'test.priority' })
  const { container, getByLabelText } = renderForm({ groups: [{ id: 'main', bare: true, fields: ['name'], component: ({ injectedFields }) => <section><span>Native custom layout</span>{injectedFields}</section> }] })
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('normal'))
  expect(container.querySelectorAll('form')).toHaveLength(1)
  expect(container.querySelectorAll('input[id="_extension.priority"]')).toHaveLength(1)
  expect(container.querySelector('[data-crud-field-id="name"]')).toBeNull()
})

it('dispatches supported headless delete hooks in existing order and blocks denied deletion', async () => {
  const order: string[] = []
  let allowed = false
  const beforeDelete = jest.fn(async () => { order.push('before'); return allowed })
  register([fieldWidget('test.priority', { onBeforeDelete: beforeDelete, onDelete: async () => { order.push('delete') }, onAfterDelete: async () => { order.push('after') } })], { [`${SPOT}:fields`]: 'test.priority' })
  const nativeDelete = jest.fn(async () => { order.push('native') })
  const { container, getByLabelText } = renderForm({ onDelete: nativeDelete, deleteVisible: true })
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('normal'))
  fireEvent.click(container.querySelector('button[type="button"]')!)
  await waitFor(() => expect(beforeDelete).toHaveBeenCalledTimes(1))
  expect(nativeDelete).not.toHaveBeenCalled()
  allowed = true
  fireEvent.click(container.querySelector('button[type="button"]')!)
  await waitFor(() => expect(nativeDelete).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(order).toEqual(['before', 'before', 'delete', 'native', 'after']))
})

it('routes headless display, field-change and validation transformations through the shared dispatcher', async () => {
  const fieldChange = jest.fn(async () => {})
  const display = jest.fn(async (data: Values) => ({ ...data, name: 'Displayed' }))
  const validation = jest.fn(async (errors: Record<string, string>) => ({ ...errors, name: 'Contributed validation' }))
  register([fieldWidget('test.priority', { transformDisplayData: display, transformValidation: validation, onFieldChange: fieldChange })], { [`${SPOT}:fields`]: 'test.priority' })
  const native = jest.fn()
  const { container } = renderForm({ schema: z.object({ id: z.string(), name: z.string().min(2) }), onSubmit: native })
  const nativeInput = () => container.querySelector('[data-crud-field-id="name"] input')!
  await waitFor(() => expect(nativeInput()).toHaveValue('Displayed'))
  fireEvent.change(nativeInput(), { target: { value: 'x' } })
  await waitFor(() => expect(fieldChange).toHaveBeenCalled())
  expect(fieldChange.mock.calls[0][0]).toBe('name')
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(container.textContent).toContain('Contributed validation'))
  expect(validation).toHaveBeenCalled()
  expect(native).not.toHaveBeenCalled()
})

it('delivers native delete failures to headless error handlers without after-delete success', async () => {
  const failed = jest.fn()
  const after = jest.fn()
  register([fieldWidget('test.priority', { onBeforeDelete: async () => true, onDeleteError: failed, onAfterDelete: after })], { [`${SPOT}:fields`]: 'test.priority' })
  const failure = new Error('Delete failure')
  const { container, getByLabelText } = renderForm({ onDelete: async () => { throw failure }, deleteVisible: true })
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('normal'))
  fireEvent.click(container.querySelector('button[type="button"]')!)
  await waitFor(() => expect(failed).toHaveBeenCalledTimes(1))
  expect(failed.mock.calls[0][2]).toBe(failure)
  expect(after).not.toHaveBeenCalled()
})

it('queues a late headless load until an earlier rendered load settles', async () => {
  const order: string[] = []
  let finishFirst: (() => void) | undefined
  const pendingFirst = new Promise<void>((resolve) => { finishFirst = resolve })
  const firstLoad = jest.fn(async () => { order.push('first-start'); await pendingFirst; order.push('first-finish') })
  const lateLoad = jest.fn(async () => { order.push('late') })
  const first: TestWidget = { metadata: { id: 'test.slow', title: 'Slow' }, Widget: () => <span>Slow root</span>, eventHandlers: { onLoad: firstLoad } }
  const late = fieldWidget('test.late', { onLoad: lateLoad })
  register([first], { [SPOT]: 'test.slow' })
  const { getByLabelText } = renderForm()
  await waitFor(() => expect(firstLoad).toHaveBeenCalledTimes(1))
  await act(async () => register([first, late], { [SPOT]: 'test.slow', [`${SPOT}:fields`]: 'test.late' }))
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('normal'))
  expect(lateLoad).not.toHaveBeenCalled()
  await act(async () => { finishFirst?.(); await pendingFirst })
  await waitFor(() => expect(lateLoad).toHaveBeenCalledTimes(1))
  expect(firstLoad).toHaveBeenCalledTimes(1)
  expect(order).toEqual(['first-start', 'first-finish', 'late'])
})

it('does not load a pending headless participant whose permission is revoked while another load waits', async () => {
  let finishFirst: (() => void) | undefined
  const pendingFirst = new Promise<void>((resolve) => { finishFirst = resolve })
  const firstLoad = jest.fn(async () => pendingFirst)
  const pendingLoad = jest.fn()
  const first: TestWidget = { metadata: { id: 'test.slow', title: 'Slow' }, Widget: () => <span>Slow root</span>, eventHandlers: { onLoad: firstLoad } }
  const pending = fieldWidget('test.pending', { onLoad: pendingLoad })
  register([first, pending], { [SPOT]: 'test.slow', [`${SPOT}:fields`]: 'test.pending' })
  const { getByLabelText, queryByLabelText, rerender } = renderForm()
  await waitFor(() => expect(firstLoad).toHaveBeenCalledTimes(1))
  expect(getByLabelText('Priority')).toHaveValue('normal')
  await act(async () => {
    mockChrome.grantedFeatures = []
    rerender(<CrudForm<Values> injectionSpotId={SPOT} fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ id: 'record-1', name: 'Original' }} />)
  })
  await waitFor(() => expect(queryByLabelText('Priority')).toBeNull())
  await act(async () => { finishFirst?.(); await pendingFirst })
  expect(firstLoad).toHaveBeenCalledTimes(1)
  expect(pendingLoad).not.toHaveBeenCalled()
})


it('keeps an untouched injected select hydrated from its namespace through the first mount and pristine reload', async () => {
  const onLoad = jest.fn()
  const onSave = jest.fn()
  const widget = fieldWidget('test.priority', { onLoad, onSave })
  widget.fields = [{ id: '_extension.priority', type: 'select', label: 'Priority', group: 'details', options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }] }]
  register([widget], { [`${SPOT}:fields`]: 'test.priority' })
  const nativeSubmit = jest.fn()
  const { container, getByLabelText, rerender } = renderForm({ onSubmit: nativeSubmit })
  await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
  expect(getByLabelText('Priority')).toHaveTextContent('Normal')
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ '_extension.priority': 'normal', _extension: { priority: 'normal' } }))
  await waitFor(() => expect(nativeSubmit).toHaveBeenCalledTimes(1))
  rerender(<CrudForm<Values> injectionSpotId={SPOT} fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ id: 'record-1', name: 'Reloaded', _extension: { priority: 'high' } }} onSubmit={nativeSubmit} />)
  await waitFor(() => expect(getByLabelText('Priority')).toHaveTextContent('High'))
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
  expect(onSave.mock.calls[1][0]).toEqual(expect.objectContaining({ '_extension.priority': 'high', _extension: { priority: 'high' } }))
})


it.each([undefined, null, ''])('preserves an explicit flat clear (%p) and edited injected select values over nested reload data', async (clearedValue) => {
  const onSave = jest.fn()
  const widget = fieldWidget('test.priority', { onSave })
  widget.fields = [{ id: '_extension.priority', type: 'select', label: 'Priority', group: 'details', options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }] }]
  register([widget], { [`${SPOT}:fields`]: 'test.priority' })
  const nativeSubmit = jest.fn()
  const { container, getByLabelText, rerender } = renderForm({ initialValues: { id: 'record-1', name: 'Original', '_extension.priority': clearedValue, _extension: { priority: 'normal' } }, onSubmit: nativeSubmit })
  await waitFor(() => expect(getByLabelText('Priority')).toBeInTheDocument())
  expect(getByLabelText('Priority')).not.toHaveTextContent('Normal')
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ '_extension.priority': clearedValue, _extension: { priority: clearedValue } }))
  await waitFor(() => expect(nativeSubmit).toHaveBeenCalledTimes(1))
  const select = container.querySelector('[data-crud-field-id="_extension.priority"] select')!
  fireEvent.change(select, { target: { value: 'high' } })
  await waitFor(() => expect(getByLabelText('Priority')).toHaveTextContent('High'))
  rerender(<CrudForm<Values> injectionSpotId={SPOT} fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ id: 'record-1', name: 'Reloaded', _extension: { priority: 'normal' } }} onSubmit={nativeSubmit} />)
  await waitFor(() => expect(getByLabelText('Priority')).toHaveTextContent('High'))
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
  expect(onSave.mock.calls[1][0]).toEqual(expect.objectContaining({ '_extension.priority': 'high', _extension: { priority: 'high' } }))
})


it('does not replace an intentionally cleared injected text field with reloaded namespace data', async () => {
  const onSave = jest.fn()
  register([fieldWidget('test.priority', { onSave })], { [`${SPOT}:fields`]: 'test.priority' })
  const { container, getByLabelText, rerender } = renderForm()
  await waitFor(() => expect(getByLabelText('Priority')).toHaveValue('normal'))
  fireEvent.change(getByLabelText('Priority'), { target: { value: '' } })
  rerender(<CrudForm<Values> injectionSpotId={SPOT} fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ id: 'record-1', name: 'Reloaded', _extension: { priority: 'high' } }} />)
  await act(async () => {})
  expect(getByLabelText('Priority')).toHaveValue('')
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  expect(onSave.mock.calls[0][0]).toEqual(expect.objectContaining({ '_extension.priority': '', _extension: { priority: '' } }))
})
