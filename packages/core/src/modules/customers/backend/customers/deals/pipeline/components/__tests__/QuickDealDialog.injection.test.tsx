/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'
import { registerCoreInjectionWidgets, registerCoreInjectionTables, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import { QuickDealDialog } from '../QuickDealDialog'

const mockCreateCrud = jest.fn(async () => ({ result: { id: 'new-deal' } }))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: (...args: unknown[]) => mockCreateCrud(...args) }))
jest.mock('@open-mercato/ui/backend/fields/registry', () => ({ ...jest.requireActual('@open-mercato/ui/backend/fields/registry'), loadGeneratedFieldRegistrations: async () => {} }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }), usePathname: () => '/backend/customers/deals/pipeline', useSearchParams: () => new URLSearchParams() }))

beforeEach(() => {
  mockCreateCrud.mockClear()
  registerCoreInjectionWidgets([])
  registerCoreInjectionTables([])
  registerEnabledModuleIds(['customers', 'extension'])
})
afterEach(() => { registerCoreInjectionWidgets([]); registerCoreInjectionTables([]) })

it('publishes the canonical headless host without an initial record ID and closes after contributed create persistence', async () => {
  let finish: () => void = () => {}
  const contribution = new Promise<void>((resolve) => { finish = resolve })
  const afterSave = jest.fn(async (values: Record<string, unknown>, context: Record<string, unknown>) => {
    expect(values['_extension.rating']).toBe('high')
    expect(context.resourceId).toBe('new-deal')
    await contribution
  })
  const onLoad = jest.fn()
  const widget: InjectionFieldWidget = {
    metadata: { id: 'extension.deal-rating' },
    fields: [{ id: '_extension.rating', type: 'text', label: 'Extension rating', group: 'details' }],
    eventHandlers: { onLoad, onAfterSave: afterSave },
  }
  const entries = [{ moduleId: 'extension', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'package' as const, loader: async () => widget }]
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'extension', table: { 'crud-form:customers.deal:fields': widget.metadata.id } }], entries)
  const onClose = jest.fn()
  const onCreated = jest.fn()
  const view = renderWithProviders(<QuickDealDialog open context={{ pipelineId: 'pipeline-1', pipelineName: 'Sales', pipelineStageId: 'stage-1', pipelineStageLabel: 'Qualified' }} onClose={onClose} onCreated={onCreated} currencies={[{ code: 'USD', isBase: true }]} />)
  const rating = await view.findByLabelText('Extension rating')
  await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
  expect(onLoad.mock.calls[0][0]).toEqual(expect.objectContaining({ entityId: 'customers.deal', resourceKind: 'customers.deal', operation: 'create' }))
  expect(onLoad.mock.calls[0][0].recordId).toBeUndefined()
  expect(rating).toBeVisible()
  fireEvent.change(view.getByPlaceholderText('e.g. Q3 Expansion — Lighting Package'), { target: { value: 'Native opportunity' } })
  fireEvent.change(rating, { target: { value: 'high' } })
  fireEvent.submit(document.querySelector('form')!)
  await waitFor(() => expect(afterSave).toHaveBeenCalledTimes(1))
  expect(mockCreateCrud).toHaveBeenCalledTimes(1)
  expect(mockCreateCrud.mock.calls[0][1]).not.toHaveProperty('_extension.rating')
  expect(onClose).not.toHaveBeenCalled()
  expect(onCreated).not.toHaveBeenCalled()
  await act(async () => finish())
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(onCreated).toHaveBeenCalledTimes(1)
})
