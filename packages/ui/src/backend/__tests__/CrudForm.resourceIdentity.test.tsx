/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'
import { registerCoreInjectionWidgets, registerCoreInjectionTables, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import { CrudForm, type CrudFormProps } from '../CrudForm'

const mockFetchStructure = jest.fn(async (..._args: unknown[]) => ({ definitions: [], metadata: {} }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
jest.mock('../fields/registry', () => ({ loadGeneratedFieldRegistrations: async () => {} }))
jest.mock('../utils/customFieldForms', () => ({ ...jest.requireActual('../utils/customFieldForms'), fetchCustomFieldFormStructure: (...args: unknown[]) => mockFetchStructure(...args) }))
jest.mock('../utils/customFieldDefs', () => ({ ...jest.requireActual('../utils/customFieldDefs'), fetchCustomFieldDefs: async () => [] }))

const SPOT = 'crud-form:test.resource'
type Values = Record<string, unknown>
function register(handlers: InjectionFieldWidget['eventHandlers']) {
  const widget: InjectionFieldWidget = { metadata: { id: 'test.resource' }, fields: [], eventHandlers: handlers }
  const entries = [{ moduleId: 'test', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'package' as const, loader: async () => widget }]
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'test', table: { [`${SPOT}:fields`]: widget.metadata.id } }], entries)
  registerEnabledModuleIds(['test'])
}
function renderForm(props: Partial<CrudFormProps<Values>> = {}) {
  return renderWithProviders(<CrudForm<Values> injectionSpotId={SPOT} fields={[{ id: 'name', label: 'Name', type: 'text' }]} initialValues={{ name: 'Name' }} {...props} />)
}
beforeEach(() => { mockFetchStructure.mockClear() })
afterEach(() => { registerCoreInjectionWidgets([]); registerCoreInjectionTables([]) })

it('explicit semantic identity reaches callbacks independently of custom-field IDs and history visibility', async () => {
  const onLoad = jest.fn()
  const before = jest.fn(async () => true)
  register({ onLoad, onBeforeSave: before })
  const native = jest.fn()
  const { container } = renderForm({ entityId: 'customers.person', entityIds: ['customers:customer_entity', 'customers:customer_person_profile'], resourceKind: 'customers.person', resourceId: 'person-1', onSubmit: native, onDelete: async () => {} })
  await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
  expect(onLoad.mock.calls[0][0]).toEqual(expect.objectContaining({ entityId: 'customers.person', resourceKind: 'customers.person', resourceId: 'person-1', recordId: 'person-1', operation: 'update' }))
  await waitFor(() => expect(mockFetchStructure).toHaveBeenCalled())
  expect(mockFetchStructure.mock.calls[0][0]).toEqual(['customers:customer_entity', 'customers:customer_person_profile'])
  expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.includes('ui.forms.actions.delete'))).toBe(true)
  expect(container.querySelector('[data-component-handle]')?.getAttribute('data-component-handle')).toBe('crud-form:customers.customer_entity')
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(native).toHaveBeenCalledTimes(1))
  expect(before.mock.calls[0][1]).toEqual(expect.objectContaining({ operation: 'update', resourceId: 'person-1' }))
})

it('exposes a newly created ID only after native create and awaits contributor completion before success', async () => {
  const order: string[] = []
  const saved = jest.fn(async (_data, context) => { order.push('save'); expect(context.resourceId).toBeUndefined() })
  let finishAfter: (() => void) | undefined
  const after = jest.fn(async (_data, context) => { order.push('after-start'); expect(context.recordId).toBe('new-1'); expect(context.resourceId).toBe('new-1'); await new Promise<void>((resolve) => { finishAfter = resolve }); order.push('after-finish') })
  register({ onSave: saved, onAfterSave: after })
  const native = jest.fn(async () => { order.push('native'); return { resourceId: 'new-1' } })
  const success = jest.fn(async (values, result) => { order.push('success'); expect(values).toEqual({ name: 'Name' }); expect(result).toEqual({ resourceId: 'new-1' }) })
  const { container } = renderForm({ entityId: 'customers.person', resourceKind: 'customers.person', onSubmit: native, onSubmitSuccess: success })
  await waitFor(() => expect(container.querySelector('form')).not.toBeNull())
  await waitFor(() => expect(mockFetchStructure).toHaveBeenCalled())
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(after).toHaveBeenCalledTimes(1))
  expect(saved).toHaveBeenCalledTimes(1)
  expect(success).not.toHaveBeenCalled()
  finishAfter?.()
  await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
  expect(order).toEqual(['save', 'native', 'after-start', 'after-finish', 'success'])
})

it('preserves update identity when a host returns a different result ID', async () => {
  const onLoad = jest.fn()
  const after = jest.fn()
  register({ onLoad, onAfterSave: after })
  const { container } = renderForm({ initialValues: { id: 'existing-1', name: 'Name' }, resourceKind: 'customers.person', onSubmit: () => ({ resourceId: 'unexpected' }) })
  await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(after).toHaveBeenCalledTimes(1))
  expect(after.mock.calls[0][1]).toEqual(expect.objectContaining({ recordId: 'existing-1', resourceId: 'existing-1', operation: 'update' }))
})

it('advances contributor baseline synchronously across native failure and retry without forwarding it', async () => {
  const writes: unknown[] = []
  const onLoad = jest.fn()
  register({
    onLoad,
    onSave: async (data, context) => {
      const namespace = data._extension as Record<string, unknown>
      writes.push(namespace.version)
      const setFormValue = context.setFormValue as (id: string, value: unknown) => void
      setFormValue('_extension', { ...namespace, version: 'v2' })
      expect(typeof context.t).toBe('function')
    },
  })
  const native = jest.fn().mockRejectedValueOnce(new Error('Native failure')).mockResolvedValueOnce(undefined)
  const { container } = renderForm({ initialValues: { id: 'existing-1', name: 'Name', _extension: { version: 'v1' } }, onSubmit: native })
  await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(container.textContent).toContain('Native failure'))
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(native).toHaveBeenCalledTimes(2))
  expect(writes).toEqual(['v1', 'v2'])
  expect(native.mock.calls.map(([values]) => values)).toEqual([{ id: 'existing-1', name: 'Name' }, { id: 'existing-1', name: 'Name' }])
})
