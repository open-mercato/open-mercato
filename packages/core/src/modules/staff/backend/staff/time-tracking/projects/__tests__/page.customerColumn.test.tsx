/**
 * @jest-environment jsdom
 */
// The customer column used to render the "Assign a customer" call to action for
// every row without a resolved name — including rows that DO have a customer and
// merely lack a readable snapshot. That misstated the record. The affordance now
// belongs to projects that genuinely carry no customer id.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import TimesheetProjectsPage from '../page'

const NAMED_PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const UNREADABLE_PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMERLESS_PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666'
const MANAGE_FEATURE = 'staff.timesheets.projects.manage'

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    params[key] === undefined ? match : String(params[key]),
  )
}

const mockTranslate = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
): string => {
  if (typeof fallbackOrParams === 'string') return interpolate(fallbackOrParams, params)
  return interpolate(key, fallbackOrParams)
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(
    async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('../../../../../lib/timesheets-projects-ui/ProjectsKpiStrip', () => ({
  ProjectsKpiStrip: () => null,
}))

jest.mock('../../../../../lib/timesheets-projects-ui/AssignMembersDialog', () => ({
  AssignMembersDialog: () => null,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))

/**
 * Stand-in DataTable that renders the page's own customer column definition for
 * every row, so the assertions run against the real cell.
 */
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: <T,>(mappedRow: T) => mappedRow,
  DataTable: ({
    data = [],
    columns = [],
  }: {
    data?: Array<Record<string, unknown>>
    columns?: Array<ColumnDef<Record<string, unknown>>>
  }) => {
    const customerColumn = columns.find(
      (column) => column.id === 'customerName' || (column as { accessorKey?: string }).accessorKey === 'customerName',
    )
    const renderCell = customerColumn?.cell
    return (
      <div data-testid="data-table">
        {data.map((row) => (
          <div key={String(row.id)} data-testid={`customer-cell-${String(row.id)}`}>
            {typeof renderCell === 'function'
              ? (renderCell as (ctx: unknown) => React.ReactNode)({ row: { original: row } })
              : null}
          </div>
        ))}
      </div>
    )
  },
}))

const readApiResultOrThrowMock = readApiResultOrThrow as unknown as jest.Mock
const useBackendChromeMock = useBackendChrome as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  useBackendChromeMock.mockReturnValue({ payload: { grantedFeatures: [MANAGE_FEATURE] } })
  readApiResultOrThrowMock.mockImplementation(async (url: string) => {
    if (url.includes('/projects/kpis')) throw new Error('kpis unavailable')
    return {
      items: [
        {
          id: NAMED_PROJECT_ID,
          name: 'Alpha',
          code: 'ALPHA',
          status: 'active',
          customerId: CUSTOMER_ID,
          // Written without a snapshot; the enricher resolved the name live.
          _staff: { customerName: 'Alpha Customer' },
        },
        {
          id: UNREADABLE_PROJECT_ID,
          name: 'Beta',
          code: 'BETA',
          status: 'active',
          customerId: CUSTOMER_ID,
        },
        {
          id: CUSTOMERLESS_PROJECT_ID,
          name: 'Gamma',
          code: 'GAMMA',
          status: 'active',
          customerId: null,
        },
      ],
      total: 3,
      totalPages: 1,
    }
  })
})

describe('projects portfolio customer column', () => {
  it('renders the customer name for a project stored without a snapshot', async () => {
    render(<TimesheetProjectsPage />)

    await waitFor(() => {
      expect(screen.getByTestId(`customer-cell-${NAMED_PROJECT_ID}`).textContent).toBe('Alpha Customer')
    })
  })

  it('renders an em dash instead of the assign affordance when the name is merely unreadable', async () => {
    render(<TimesheetProjectsPage />)

    await waitFor(() => {
      expect(screen.getByTestId(`customer-cell-${UNREADABLE_PROJECT_ID}`)).toBeTruthy()
    })
    const cell = screen.getByTestId(`customer-cell-${UNREADABLE_PROJECT_ID}`)
    expect(cell.textContent).toBe('—')
    expect(cell.querySelector('a')).toBeNull()
  })

  it('keeps the assign affordance for a project that genuinely has no customer', async () => {
    render(<TimesheetProjectsPage />)

    await waitFor(() => {
      expect(screen.getByTestId(`customer-cell-${CUSTOMERLESS_PROJECT_ID}`).textContent).toBe('Assign a customer')
    })
    expect(
      screen.getByTestId(`customer-cell-${CUSTOMERLESS_PROJECT_ID}`).querySelector('a')?.getAttribute('href'),
    ).toBe(`/backend/staff/time-tracking/projects/${CUSTOMERLESS_PROJECT_ID}/edit`)
  })
})
