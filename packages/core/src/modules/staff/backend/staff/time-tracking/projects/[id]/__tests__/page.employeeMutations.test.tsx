/**
 * @jest-environment jsdom
 */
// The project team roster is a non-CrudForm write surface: adding and removing a
// member goes through `createCrud`/`deleteCrud` directly. Both must therefore run
// inside `useGuardedMutation(...).runMutation(...)` — otherwise the global mutation
// injections (record locks, the unified conflict bar) never see the write — and a
// 409 must reach `surfaceRecordConflict` instead of collapsing into the generic
// "Failed to add/remove employee." flash.
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import TimesheetProjectDetailPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222'
const STAFF_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_STAFF_ID = '44444444-4444-4444-8444-444444444444'

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

const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const mockRetryLastMutation = jest.fn(async () => true)

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
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

jest.mock('@open-mercato/ui/backend/inputs/LookupSelect', () => ({
  LookupSelect: ({ onChange }: { onChange: (value: string | null) => void }) => (
    <button type="button" data-testid="pick-staff-member" onClick={() => onChange('44444444-4444-4444-8444-444444444444')}>
      pick
    </button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, onKeyDown }: { children?: React.ReactNode; onKeyDown?: (event: React.KeyboardEvent) => void }) => (
    <div onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

const apiCallMock = apiCall as unknown as jest.Mock
const readApiResultOrThrowMock = readApiResultOrThrow as unknown as jest.Mock
const createCrudMock = createCrud as unknown as jest.Mock
const deleteCrudMock = deleteCrud as unknown as jest.Mock
const surfaceRecordConflictMock = surfaceRecordConflict as unknown as jest.Mock
const flashMock = flash as unknown as jest.Mock

function conflictError(): Error {
  return Object.assign(new Error('Conflict'), {
    status: 409,
    body: { error: 'Conflict', code: 'optimistic_lock_conflict' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  surfaceRecordConflictMock.mockReturnValue(false)
  mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/auth/feature-check')) {
      return {
        ok: true,
        status: 200,
        result: { ok: true, granted: ['staff.timesheets.projects.manage'] },
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
    if (url.startsWith('/api/staff/team-members')) {
      return {
        ok: true,
        status: 200,
        result: { items: [{ id: STAFF_ID, display_name: 'Ada Lovelace' }] },
        response: {},
      }
    }
    return { ok: true, status: 200, result: {}, response: {} }
  })

  readApiResultOrThrowMock.mockImplementation(async (url: string) => {
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

async function renderPageWithRoster() {
  render(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)
  await screen.findByRole('button', { name: /Ada Lovelace/ })
}

describe('project detail team roster writes', () => {
  it('removes a member through the guarded mutation and surfaces a 409 on the conflict bar instead of the generic error', async () => {
    deleteCrudMock.mockRejectedValue(conflictError())
    surfaceRecordConflictMock.mockReturnValue(true)

    await renderPageWithRoster()
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    })
    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    const removeCall = mockRunMutation.mock.calls[0][0] as {
      context: { retryLastMutation: () => Promise<boolean>; resourceId: string }
    }
    expect(removeCall.context.resourceId).toBe(ASSIGNMENT_ID)
    expect(removeCall.context.retryLastMutation).toBe(mockRetryLastMutation)
    expect(surfaceRecordConflictMock.mock.calls[0][0]).toMatchObject({ status: 409 })
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('adds a member through the guarded mutation and surfaces a 409 on the conflict bar instead of the generic error', async () => {
    createCrudMock.mockRejectedValue(conflictError())
    surfaceRecordConflictMock.mockReturnValue(true)

    await renderPageWithRoster()
    fireEvent.click(screen.getByRole('button', { name: 'Add Employee' }))
    fireEvent.click(screen.getByTestId('pick-staff-member'))

    const addButtons = screen.getAllByRole('button', { name: 'Add Employee' })
    fireEvent.click(addButtons[addButtons.length - 1])

    await waitFor(() => {
      expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    })
    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    const addCall = mockRunMutation.mock.calls[0][0] as {
      context: { retryLastMutation: () => Promise<boolean>; resourceId: string }
      mutationPayload: Record<string, unknown>
    }
    expect(addCall.context.resourceId).toBe(OTHER_STAFF_ID)
    expect(addCall.context.retryLastMutation).toBe(mockRetryLastMutation)
    expect(addCall.mutationPayload).toMatchObject({ staffMemberId: OTHER_STAFF_ID, timeProjectId: PROJECT_ID })
    expect(flashMock).not.toHaveBeenCalled()
  })
})
