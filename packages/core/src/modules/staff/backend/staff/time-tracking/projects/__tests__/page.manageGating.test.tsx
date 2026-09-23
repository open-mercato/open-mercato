/**
 * @jest-environment jsdom
 */
// Management affordances on the portfolio screen ("Add Project", the delete row
// action) belong to holders of `staff.timesheets.projects.manage`. They used to
// be derived from the `/projects/kpis` role instead, so a failed KPI request —
// which nulls the payload — silently stripped a legitimate manager of both.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import TimesheetProjectsPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
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

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items = [] }: { items?: Array<Record<string, unknown>> }) => (
    <div data-testid="row-actions">
      {items.map((item) => (
        <span key={String(item.id)} data-testid={`row-action-${String(item.id)}`}>
          {String(item.label)}
        </span>
      ))}
    </div>
  ),
}))

/**
 * Stand-in DataTable: renders the page's own `actions` slot and row actions so
 * the gating assertions run against the real declarations, without dragging in
 * virtualization, perspectives and injection spots.
 */
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: <T,>(mappedRow: T) => mappedRow,
  DataTable: ({
    data = [],
    rowActions,
    actions,
    emptyState,
  }: {
    data?: Array<Record<string, unknown>>
    rowActions?: (row: Record<string, unknown>) => React.ReactNode
    actions?: React.ReactNode
    emptyState?: React.ReactNode
  }) => (
    <div data-testid="data-table">
      <div data-testid="table-actions">{actions}</div>
      {data.length === 0 ? <div data-testid="table-empty">{emptyState}</div> : null}
      {data.map((row) => (
        <div key={String(row.id)} data-testid={`row-${String(row.id)}`}>
          {rowActions ? rowActions(row) : null}
        </div>
      ))}
    </div>
  ),
}))

const readApiResultOrThrowMock = readApiResultOrThrow as unknown as jest.Mock
const useBackendChromeMock = useBackendChrome as unknown as jest.Mock

function grantFeatures(features: string[]) {
  useBackendChromeMock.mockReturnValue({ payload: { grantedFeatures: features } })
}

beforeEach(() => {
  jest.clearAllMocks()
  // The KPI request is the one that fails; the project list still resolves.
  readApiResultOrThrowMock.mockImplementation(async (url: string) => {
    if (url.includes('/projects/kpis')) throw new Error('kpis unavailable')
    return {
      items: [{ id: PROJECT_ID, name: 'Apollo', code: 'APL', status: 'active' }],
      total: 1,
      totalPages: 1,
    }
  })
})

describe('projects portfolio management affordances', () => {
  it('keeps create and delete available to a manager whose KPI request failed', async () => {
    grantFeatures([MANAGE_FEATURE])

    render(<TimesheetProjectsPage />)

    await waitFor(() => {
      expect(screen.getByTestId(`row-${PROJECT_ID}`)).toBeTruthy()
    })
    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        expect.stringContaining('/projects/kpis'),
        undefined,
        expect.anything(),
      )
    })

    expect(screen.getByRole('link', { name: 'Add Project' })).toBeTruthy()
    expect(screen.getByTestId('row-action-delete')).toBeTruthy()
  })

  it('withholds create and delete from a viewer without the manage feature', async () => {
    grantFeatures(['staff.timesheets.projects.view'])

    render(<TimesheetProjectsPage />)

    await waitFor(() => {
      expect(screen.getByTestId(`row-${PROJECT_ID}`)).toBeTruthy()
    })

    expect(screen.queryByRole('link', { name: 'Add Project' })).toBeNull()
    expect(screen.queryByTestId('row-action-delete')).toBeNull()
  })
})
