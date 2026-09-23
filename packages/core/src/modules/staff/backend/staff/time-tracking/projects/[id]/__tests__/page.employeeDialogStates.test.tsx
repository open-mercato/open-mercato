/**
 * @jest-environment jsdom
 */
// Two failure modes of the Add Employee dialog: a broken team-member lookup used
// to be swallowed into an empty result list, so the picker claimed "No team
// members found" for what was actually a failed request; and the confirm button
// only went `disabled` while saving, so a slow POST read as a frozen dialog.
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'

import TimesheetProjectDetailPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_STAFF_ID = '44444444-4444-4444-8444-444444444444'
const LOOKUP_ERROR = 'Could not load team members. Check your connection and try again.'
const NO_RESULTS = 'No team members found'

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

/**
 * The picker stand-in drives the page's own `fetchItems` callback and mirrors
 * the real LookupSelect's "no results" copy, so the assertions below run against
 * the page's error handling rather than against LookupSelect internals.
 */
jest.mock('@open-mercato/ui/backend/inputs/LookupSelect', () => ({
  LookupSelect: ({
    fetchItems,
    onChange,
    emptyLabel,
  }: {
    fetchItems?: (query: string) => Promise<Array<{ id: string; title: string }>>
    onChange: (value: string | null) => void
    emptyLabel?: string
  }) => {
    const [items, setItems] = React.useState<Array<{ id: string; title: string }>>([])
    return (
      <div>
        <button
          type="button"
          data-testid="run-lookup"
          onClick={() => {
            void fetchItems?.('ada')
              .then(setItems)
              .catch(() => setItems([]))
          }}
        >
          search
        </button>
        <button type="button" data-testid="pick-staff-member" onClick={() => onChange(OTHER_STAFF_ID)}>
          pick
        </button>
        {items.length === 0 && emptyLabel ? <p>{emptyLabel}</p> : null}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({
    children,
    onKeyDown,
  }: {
    children?: React.ReactNode
    onKeyDown?: (event: React.KeyboardEvent) => void
  }) => <div onKeyDown={onKeyDown}>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

const apiCallMock = apiCall as unknown as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as unknown as jest.Mock
const createCrudMock = createCrud as unknown as jest.Mock
const deleteCrudMock = deleteCrud as unknown as jest.Mock

let teamMemberLookupFails = false

beforeEach(() => {
  jest.clearAllMocks()
  teamMemberLookupFails = false
  createCrudMock.mockResolvedValue({})
  deleteCrudMock.mockResolvedValue({})

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
    return { ok: true, status: 200, result: {}, response: {} }
  })

  readApiResultOrThrowMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/staff/team-members')) {
      if (teamMemberLookupFails) throw new Error('team member lookup failed')
      return { items: [{ id: STAFF_ID, display_name: 'Ada Lovelace' }] }
    }
    if (url.includes('/employees')) {
      return {
        items: [
          {
            id: ASSIGNMENT_ID,
            staff_member_id: STAFF_ID,
            role: 'Developer',
            status: 'active',
            assigned_start_date: '2026-06-01',
          },
        ],
        total: 1,
      }
    }
    return { items: [] }
  })
})

async function openAddEmployeeDialog() {
  render(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
  await screen.findByRole('button', { name: /Ada Lovelace/ })
  fireEvent.click(screen.getByRole('button', { name: 'Add Employee' }))
  await screen.findByTestId('dialog')
}

describe('add employee dialog — team member lookup', () => {
  it('reports a failed lookup instead of leaving the picker claiming there are no team members', async () => {
    teamMemberLookupFails = true
    await openAddEmployeeDialog()

    fireEvent.click(screen.getByTestId('run-lookup'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(LOOKUP_ERROR)
  })

  it('shows no error banner when the lookup succeeds', async () => {
    await openAddEmployeeDialog()

    fireEvent.click(screen.getByTestId('run-lookup'))

    await waitFor(() => {
      expect(screen.queryByText(NO_RESULTS)).toBeNull()
    })
    expect(screen.queryByText(LOOKUP_ERROR)).toBeNull()
  })
})

describe('add employee dialog — pending affordance', () => {
  it('shows a pending indicator on the confirm button while the assignment is in flight', async () => {
    let releaseCreate: (() => void) | null = null
    createCrudMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCreate = () => resolve()
        }),
    )

    await openAddEmployeeDialog()
    fireEvent.click(screen.getByTestId('pick-staff-member'))

    const confirmButtons = screen.getAllByRole('button', { name: /Add Employee/ })
    const confirmButton = confirmButtons[confirmButtons.length - 1]
    expect(within(confirmButton).queryByRole('status')).toBeNull()

    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(within(confirmButton).getByRole('status')).toBeTruthy()
    })
    expect(confirmButton.hasAttribute('disabled')).toBe(true)

    releaseCreate?.()
    await waitFor(() => {
      expect(screen.queryByTestId('dialog')).toBeNull()
    })
  })
})
