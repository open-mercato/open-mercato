/** @jest-environment jsdom */

import * as React from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import type { InjectionWidgetComponentProps, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import {
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { SalesDocumentExtensionSpot, type SalesDocumentExtensionContext } from '../SalesDocumentExtensionSpot'

let mockGrantedFeatures = ['sales.view', 'approvals.view']
let mockChromeReady = true

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: mockGrantedFeatures },
    isReady: mockChromeReady,
  }),
}))

type Document = {
  id: string
  organizationId: string
  tenantId: string
  status: string
  comment: string
  updatedAt: string
}

type Context = SalesDocumentExtensionContext<Document>
type WidgetProps = InjectionWidgetComponentProps<Context, Document>

const document: Document = {
  id: 'document-1',
  organizationId: 'organization-1',
  tenantId: 'tenant-1',
  status: 'draft',
  comment: '',
  updatedAt: '2026-10-22T10:00:00.000Z',
}

const retryLastMutation = jest.fn<Promise<boolean>, []>().mockResolvedValue(true)

function contextFor(kind: 'order' | 'quote', record = document): Context {
  return {
    kind,
    documentId: record.id,
    record,
    formId: `sales-document:${kind}:${record.id}`,
    resourceKind: `sales.${kind}`,
    resourceId: record.id,
    retryLastMutation,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
  }
}

function registerWidgets(features = ['approvals.view']) {
  const received = new Map<string, WidgetProps>()
  const onLoad = jest.fn()
  const entries: ModuleInjectionWidgetEntry[] = []
  const table: ModuleInjectionTable = {}

  for (const kind of ['order', 'quote'] as const) {
    for (const surface of ['stage-bar', 'closure'] as const) {
      const spotId = `detail:sales.${kind}:${surface}`
      const widgetId = `test.${kind}.${surface}`
      function Widget(props: WidgetProps) {
        const [count, setCount] = React.useState(0)
        received.set(spotId, props)
        return (
          <div data-testid={spotId}>
            <span>{props.data?.comment}</span>
            <button type="button" onClick={() => setCount((value) => value + 1)}>{count}</button>
            <button type="button" onClick={() => props.data && props.onDataChange?.({ ...props.data, comment: 'Reviewed' })}>
              Review
            </button>
          </div>
        )
      }
      entries.push({
        moduleId: 'test_extensions',
        key: widgetId,
        widgetId,
        source: 'app',
        loader: async () => ({
          metadata: { id: widgetId, title: widgetId, features, requiredModules: ['sales'] },
          Widget,
          eventHandlers: { onLoad },
        }),
      })
      table[spotId] = { widgetId }
    }
  }

  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'test_extensions', table }])
  return { received, onLoad }
}

function Regions({ kind, record = document, onDataChange = jest.fn() }: {
  kind: 'order' | 'quote'
  record?: Document
  onDataChange?: (record: Document) => void
}) {
  const context = contextFor(kind, record)
  return (
    <>
      <SalesDocumentExtensionSpot surface="stage-bar" context={context} data={record} onDataChange={onDataChange} />
      <SalesDocumentExtensionSpot surface="closure" context={context} data={record} onDataChange={onDataChange} />
    </>
  )
}

beforeEach(() => {
  mockGrantedFeatures = ['sales.view', 'approvals.view']
  mockChromeReady = true
  registerEnabledModuleIds(['sales', 'test_extensions'])
  registerCoreInjectionWidgets([])
  registerCoreInjectionTables([])
  retryLastMutation.mockClear()
})

afterEach(() => {
  cleanup()
  registerCoreInjectionWidgets([])
  registerCoreInjectionTables([])
})

describe.each(['order', 'quote'] as const)('sales %s extension regions', (kind) => {
  it('loads exact registered spots and passes current data, scope and guarded mutation context', async () => {
    const { received, onLoad } = registerWidgets()
    const onDataChange = jest.fn()
    const { findByTestId, queryByTestId } = render(<Regions kind={kind} onDataChange={onDataChange} />)

    for (const surface of ['stage-bar', 'closure']) {
      const spotId = `detail:sales.${kind}:${surface}`
      await findByTestId(spotId)
      expect(received.get(spotId)?.data).toBe(document)
      expect(received.get(spotId)?.context).toMatchObject(contextFor(kind))
      expect(received.get(spotId)?.context.retryLastMutation).toBe(retryLastMutation)
      expect(received.get(spotId)?.onDataChange).toBe(onDataChange)
      const otherKind = kind === 'order' ? 'quote' : 'order'
      expect(queryByTestId(`detail:sales.${otherKind}:${surface}`)).toBeNull()
    }
    expect(onLoad).toHaveBeenCalledTimes(2)

    const stage = await findByTestId(`detail:sales.${kind}:stage-bar`)
    fireEvent.click(stage.querySelectorAll('button')[1])
    expect(onDataChange).toHaveBeenCalledWith({ ...document, comment: 'Reviewed' })
    await received.get(`detail:sales.${kind}:stage-bar`)?.context.retryLastMutation()
    expect(retryLastMutation).toHaveBeenCalledTimes(1)
  })

  it('updates document props without remounting widget state or replaying onLoad', async () => {
    const { received, onLoad } = registerWidgets()
    const { findByTestId, rerender } = render(<Regions kind={kind} />)
    const spotId = `detail:sales.${kind}:stage-bar`
    const stage = await findByTestId(spotId)
    fireEvent.click(stage.querySelectorAll('button')[0])

    const updated = { ...document, comment: 'Updated', updatedAt: '2026-10-22T10:01:00.000Z' }
    rerender(<Regions kind={kind} record={updated} />)

    await waitFor(() => expect(received.get(spotId)?.data).toBe(updated))
    expect(stage.querySelectorAll('button')[0]).toHaveTextContent('1')
    expect(stage).toHaveTextContent('Updated')
    expect(onLoad).toHaveBeenCalledTimes(2)
  })

  it('renders no container or placeholder without registered widgets', async () => {
    const { container } = render(<Regions kind={kind} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('honors widget features, including wildcard grants', async () => {
    const { onLoad } = registerWidgets()
    mockGrantedFeatures = ['sales.view']
    const { container, findByTestId, rerender } = render(<Regions kind={kind} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
    expect(onLoad).not.toHaveBeenCalled()

    mockGrantedFeatures = ['sales.view', 'approvals.*']
    rerender(<Regions kind={kind} />)
    await findByTestId(`detail:sales.${kind}:stage-bar`)
    await findByTestId(`detail:sales.${kind}:closure`)
    expect(onLoad).toHaveBeenCalledTimes(2)
  })

  it('waits for backend authorization before rendering or firing onLoad', async () => {
    const { onLoad } = registerWidgets()
    mockChromeReady = false
    const { container, findByTestId, rerender } = render(<Regions kind={kind} />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
    expect(onLoad).not.toHaveBeenCalled()

    mockChromeReady = true
    rerender(<Regions kind={kind} />)
    await findByTestId(`detail:sales.${kind}:stage-bar`)
    await findByTestId(`detail:sales.${kind}:closure`)
    expect(onLoad).toHaveBeenCalledTimes(2)
  })
})
