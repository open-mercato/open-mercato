/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CustomerTodosTable } from '../CustomerTodosTable'

const readApiResultOrThrowMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/backend/customer-tasks',
  useSearchParams: () => new URLSearchParams(''),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

type Column = {
  accessorKey?: string
  header?: React.ReactNode
  cell?: (input: { row: { original: Record<string, unknown> } }) => React.ReactNode
}

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { columns: Column[]; data?: Array<Record<string, unknown> & { id: string }> }) => (
    <table>
      <thead>
        <tr>{props.columns.map((column) => <th key={column.accessorKey}>{column.header}</th>)}</tr>
      </thead>
      <tbody>
        {(props.data ?? []).map((row) => (
          <tr key={row.id} data-testid={`row-${row.id}`}>
            {props.columns.map((column) => (
              <td key={column.accessorKey}>{column.cell ? column.cell({ row: { original: row } }) : null}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

function taskRow(id: string, owner: { id: string; name: string | null } | null) {
  return {
    id,
    todoId: id,
    todoSource: 'customers:interaction',
    todoTitle: `Task ${id}`,
    todoIsDone: false,
    todoOwnerUserId: owner?.id ?? null,
    todoOwnerName: owner?.name ?? null,
    todoOrganizationId: 'org-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    createdAt: '2026-11-28T09:00:00.000Z',
    customer: { id: 'customer-1', displayName: 'Acme', kind: 'company' },
  }
}

describe('CustomerTodosTable assignee column', () => {
  it('shows who each task is assigned to, between the task and its done state', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        taskRow('assigned', { id: 'user-1', name: 'Jane Doe' }),
        taskRow('unassigned', null),
      ],
      total: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })

    renderWithProviders(<CustomerTodosTable />)

    await waitFor(() => expect(screen.getByTestId('row-assigned')).toBeInTheDocument())
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
    const assigneeIndex = headers.indexOf('Assigned to')
    expect(assigneeIndex).toBeGreaterThan(-1)
    expect(assigneeIndex).toBe(headers.length - 2)

    const assignedCells = screen.getByTestId('row-assigned').querySelectorAll('td')
    expect(assignedCells[assigneeIndex]?.textContent).toBe('Jane Doe')
    const unassignedCells = screen.getByTestId('row-unassigned').querySelectorAll('td')
    expect(unassignedCells[assigneeIndex]?.textContent).toBe('—')
  })
})
