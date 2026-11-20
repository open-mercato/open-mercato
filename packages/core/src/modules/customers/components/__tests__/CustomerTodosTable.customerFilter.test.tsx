/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomerTodosTable } from '../CustomerTodosTable'

const CUSTOMER_ID = '3f0c9a52-6f1d-4c3e-9b8a-2d5e7f1a4b6c'
const OTHER_CUSTOMER_ID = '8b1e4d27-0c5a-4f9e-a3d6-7e2b9c4f1a08'

const readApiResultOrThrowMock = jest.fn()
const replaceMock = jest.fn()
const pushMock = jest.fn()
let activeQuery = ''

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  usePathname: () => '/backend/customer-tasks',
  useSearchParams: () => new URLSearchParams(activeQuery),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

type ExportSection = { prepare?: (format: string) => Promise<{ prepared: { rows: Array<Record<string, unknown>> } }> }
let latestExporter: { view?: ExportSection; full?: ExportSection } | false | undefined
let latestOnPageChange: ((page: number) => void) | undefined

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: {
    activeFilterChips?: React.ReactNode
    emptyState?: React.ReactNode
    data?: Array<{ id: string; customer?: { displayName?: string } }>
    exporter?: { view?: ExportSection; full?: ExportSection } | false
    pagination?: { onPageChange?: (page: number) => void }
  }) => {
    latestExporter = props.exporter
    latestOnPageChange = props.pagination?.onPageChange
    return (
      <div data-testid="data-table">
        {props.activeFilterChips}
        <ul data-testid="rendered-rows">
          {(props.data ?? []).map((row) => <li key={row.id}>{row.customer?.displayName}</li>)}
        </ul>
        {props.emptyState ? <p>{props.emptyState}</p> : null}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

function taskRow(customerId: string, displayName: string, id = 'task-1') {
  return {
    id,
    todoId: id,
    todoSource: 'customers:interaction',
    todoTitle: 'Call back',
    todoIsDone: false,
    todoOrganizationId: 'org-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    createdAt: '2026-01-01T10:00:00.000Z',
    customer: { id: customerId, displayName, kind: 'company' },
  }
}

function respondWith(items: unknown[]) {
  readApiResultOrThrowMock.mockResolvedValue({
    items,
    total: items.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
  })
}

function requestedUrl(): URL {
  const [url] = readApiResultOrThrowMock.mock.calls[readApiResultOrThrowMock.mock.calls.length - 1] as [string]
  return new URL(url, 'http://localhost')
}

describe('CustomerTodosTable customer filter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    activeQuery = ''
    latestExporter = undefined
    latestOnPageChange = undefined
  })

  it('lists every customer\'s tasks and shows no filter chip without a customerId parameter', async () => {
    respondWith([taskRow(CUSTOMER_ID, 'Acme Corp')])

    renderWithProviders(<CustomerTodosTable />)

    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalled())
    expect(requestedUrl().pathname).toBe('/api/customers/interactions/tasks')
    expect(requestedUrl().searchParams.has('entityId')).toBe(false)
    expect(screen.queryByTestId('customer-tasks-customer-filter')).not.toBeInTheDocument()
  })

  it('sends customerId to the API as entityId and names the customer in a removable chip', async () => {
    activeQuery = `customerId=${CUSTOMER_ID}`
    respondWith([taskRow(CUSTOMER_ID, 'Acme Corp')])

    renderWithProviders(<CustomerTodosTable />)

    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalled())
    expect(requestedUrl().searchParams.get('entityId')).toBe(CUSTOMER_ID)
    expect(await screen.findByText('Customer: Acme Corp')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove customer filter' }))

    expect(replaceMock).toHaveBeenCalledWith('/backend/customer-tasks')
  })

  it('keeps the chip with a generic label when the customer has no tasks', async () => {
    activeQuery = `customerId=${CUSTOMER_ID}`
    respondWith([])

    renderWithProviders(<CustomerTodosTable />)

    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalled())
    expect(requestedUrl().searchParams.get('entityId')).toBe(CUSTOMER_ID)
    expect(await screen.findByText('Customer: Selected customer')).toBeInTheDocument()
  })

  it('ignores a customerId that is not a UUID instead of sending an invalid filter', async () => {
    activeQuery = 'customerId=not-a-uuid'
    respondWith([])

    renderWithProviders(<CustomerTodosTable />)

    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalled())
    expect(requestedUrl().searchParams.has('entityId')).toBe(false)
    expect(screen.queryByTestId('customer-tasks-customer-filter')).not.toBeInTheDocument()
  })

  it('does not show or export the previous customer\'s rows while a new customer filter loads', async () => {
    activeQuery = `customerId=${CUSTOMER_ID}`
    respondWith([taskRow(CUSTOMER_ID, 'Acme Corp', 'task-acme')])

    const { rerender } = renderWithProviders(<CustomerTodosTable />)

    const rowsList = await screen.findByTestId('rendered-rows')
    await waitFor(() => expect(rowsList).toHaveTextContent('Acme Corp'))
    await waitFor(() => expect(latestExporter && latestExporter.view).toBeTruthy())

    let resolveDeferred: (value: unknown) => void = () => {}
    readApiResultOrThrowMock.mockImplementationOnce(() => new Promise((resolve) => { resolveDeferred = resolve }))
    activeQuery = `customerId=${OTHER_CUSTOMER_ID}`
    rerender(<CustomerTodosTable />)

    await waitFor(() => expect(requestedUrl().searchParams.get('entityId')).toBe(OTHER_CUSTOMER_ID))
    expect(screen.getByTestId('rendered-rows')).not.toHaveTextContent('Acme Corp')
    expect(latestExporter && latestExporter.view).toBeUndefined()

    await act(async () => {
      resolveDeferred({
        items: [taskRow(OTHER_CUSTOMER_ID, 'Globex', 'task-globex')],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })
    })

    await waitFor(() => expect(screen.getByTestId('rendered-rows')).toHaveTextContent('Globex'))
    expect(screen.getByTestId('rendered-rows')).not.toHaveTextContent('Acme Corp')
    const view = latestExporter && latestExporter.view
    expect(view?.prepare).toBeDefined()
    const exported = await view!.prepare!('csv')
    const exportedNames = exported.prepared.rows.map((row) => JSON.stringify(row))
    expect(exportedNames.join(' ')).toContain('Globex')
    expect(exportedNames.join(' ')).not.toContain('Acme Corp')
  })

  it('requests only the first page of the newly selected customer when the filter changes on a later page', async () => {
    activeQuery = `customerId=${CUSTOMER_ID}`
    respondWith([taskRow(CUSTOMER_ID, 'Acme Corp', 'task-acme')])

    const { rerender } = renderWithProviders(<CustomerTodosTable />)

    await waitFor(() => expect(latestOnPageChange).toBeDefined())
    act(() => latestOnPageChange!(3))
    await waitFor(() => expect(requestedUrl().searchParams.get('page')).toBe('3'))

    const callsBeforeSwitch = readApiResultOrThrowMock.mock.calls.length
    respondWith([taskRow(OTHER_CUSTOMER_ID, 'Globex', 'task-globex')])
    activeQuery = `customerId=${OTHER_CUSTOMER_ID}`
    rerender(<CustomerTodosTable />)

    await waitFor(() => expect(screen.getByTestId('rendered-rows')).toHaveTextContent('Globex'))
    const switchCalls = readApiResultOrThrowMock.mock.calls.slice(callsBeforeSwitch).map(([url]) => new URL(url as string, 'http://localhost').searchParams)
    expect(switchCalls).toHaveLength(1)
    expect(switchCalls[0].get('entityId')).toBe(OTHER_CUSTOMER_ID)
    expect(switchCalls[0].get('page')).toBe('1')
  })
})
