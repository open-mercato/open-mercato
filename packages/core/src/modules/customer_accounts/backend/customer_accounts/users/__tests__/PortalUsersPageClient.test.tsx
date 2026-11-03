/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import { PortalUsersPageClient } from '../PortalUsersPageClient'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/link', () => ({ children, href }: any) => <a href={href}>{children}</a>)

jest.mock('lucide-react', () => ({
  Globe: () => null,
  Settings: () => null,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data }: any) => (
    <table>
      <thead>
        <tr>
          {columns.map((column: any, index: number) => (
            <th key={column.accessorKey ?? index} data-testid={`header-${column.accessorKey}`}>
              {typeof column.header === 'string' ? column.header : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row: any) => (
          <tr key={row.id}>
            {columns.map((column: any, index: number) => (
              <td key={column.accessorKey ?? index} data-testid={`cell-${column.accessorKey}-${row.id}`}>
                {column.cell ? column.cell({ row: { original: row } }) : String(row[column.accessorKey] ?? '')}
              </td>
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

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(({ operation }: { operation: () => unknown }) => operation()),
    retryLastMutation: jest.fn(),
  }),
}))

const readApiResultOrThrowMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>

function makeRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: `User ${id}`,
    email: `${id}@example.com`,
    emailVerified: true,
    isActive: true,
    lastLoginAt: null,
    roles: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    personEntityId: null,
    customerEntityId: null,
    organizationId: null,
    organizationName: null,
    ...overrides,
  }
}

describe('PortalUsersPageClient — organization column (#5575)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders an Organization column with each user organization name', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        makeRow('u1', { organizationId: 'org-1', organizationName: 'Alpha Org' }),
        makeRow('u2', { organizationId: 'org-2', organizationName: 'Beta Org' }),
      ],
      total: 2,
      totalPages: 1,
    } as never)

    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" />)

    await waitFor(() => {
      expect(screen.getByTestId('cell-organizationName-u1')).toHaveTextContent('Alpha Org')
    })
    expect(screen.getByTestId('header-organizationName')).toHaveTextContent('Organization')
    expect(screen.getByTestId('cell-organizationName-u2')).toHaveTextContent('Beta Org')
  })

  it('falls back to the organization id, then to a placeholder, when the name is missing', async () => {
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        makeRow('u1', { organizationId: 'org-1', organizationName: null }),
        makeRow('u2'),
      ],
      total: 2,
      totalPages: 1,
    } as never)

    render(<PortalUsersPageClient portalOrigin="https://shop.example.com" />)

    await waitFor(() => {
      expect(screen.getByTestId('cell-organizationName-u1')).toHaveTextContent('org-1')
    })
    expect(screen.getByTestId('cell-organizationName-u2')).toHaveTextContent('-')
  })
})
