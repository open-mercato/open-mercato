/**
 * @jest-environment jsdom
 */
// The "Time" tab's recent-entries list was migrated from a raw <table> to
// DataTable (issue #5647). This exercises the DataTable-rendered content —
// person-name resolution via `employeeNameById` and the non-billable badge —
// which no earlier test covered.
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

import TimesheetProjectDetailPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const STAFF_ID = '33333333-3333-4333-8333-333333333333'
const ENTRY_ID = '44444444-4444-4444-8444-444444444444'

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

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/i18n/context')
  return { ...actual, useT: () => mockTranslate, useLocale: () => 'en' }
})

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/staff/time-tracking/projects/project-1',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

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
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(
    async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/charts', () => ({
  KpiCard: ({ label }: { label: React.ReactNode }) => <div>{label}</div>,
  Sparkline: () => null,
}))

jest.mock('../../../../../../lib/time-tracking-ui/ProjectTeamDrawer', () => ({
  ProjectTeamDrawer: () => null,
}))

const apiCallMock = apiCall as unknown as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as unknown as jest.Mock

function renderWithQueryClient(children: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
}

beforeEach(() => {
  jest.clearAllMocks()

  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/auth/feature-check')) {
      return {
        ok: true,
        status: 200,
        result: { ok: true, granted: ['staff.timesheets.projects.manage'] },
        response: {},
      }
    }
    if (url.startsWith('/api/staff/team-members')) {
      return {
        ok: true,
        status: 200,
        result: { items: [{ id: STAFF_ID, display_name: 'Ada Lovelace' }] },
        response: {},
      }
    }
    if (url.startsWith('/api/staff/timesheets/time-projects?')) {
      return {
        ok: true,
        status: 200,
        result: { items: [{ id: PROJECT_ID, name: 'Apollo', code: 'APL', status: 'active' }] },
        response: {},
      }
    }
    if (url.startsWith('/api/staff/timesheets/time-entries?')) {
      return {
        ok: true,
        status: 200,
        result: {
          items: [
            {
              id: ENTRY_ID,
              date: '2026-08-05T00:00:00.000Z',
              staff_member_id: STAFF_ID,
              description: 'Sprint planning',
              duration_minutes: 90,
              is_billable: false,
            },
          ],
        },
        response: {},
      }
    }
    return { ok: true, status: 200, result: {}, response: {} }
  })

  readApiResultOrThrowMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/employees')) {
      return {
        items: [{ id: 'assignment-1', staff_member_id: STAFF_ID, status: 'active', assigned_start_date: '2026-01-01' }],
        total: 1,
      }
    }
    return { items: [], total: 0 }
  })
})

async function renderPage() {
  const view = renderWithQueryClient(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
  await screen.findByRole('heading', { name: 'Apollo' })
  return view
}

describe('project detail — Time tab', () => {
  it('renders recent entries in the DataTable with the resolved person name', async () => {
    await renderPage()

    fireEvent.click(screen.getByRole('tab', { name: 'Time' }))

    expect(await screen.findByText('Sprint planning')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument())
    expect(screen.getByText('non-billable')).toBeInTheDocument()
  })
})
