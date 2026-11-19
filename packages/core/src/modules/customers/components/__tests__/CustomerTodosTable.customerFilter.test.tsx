/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomerTodosTable } from '../CustomerTodosTable'

const CUSTOMER_ID = '3f0c9a52-6f1d-4c3e-9b8a-2d5e7f1a4b6c'

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

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { activeFilterChips?: React.ReactNode; emptyState?: React.ReactNode }) => (
    <div data-testid="data-table">
      {props.activeFilterChips}
      {props.emptyState ? <p>{props.emptyState}</p> : null}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

function taskRow(customerId: string, displayName: string) {
  return {
    id: 'task-1',
    todoId: 'task-1',
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
})
