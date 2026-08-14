/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProjectTeamDrawer } from '../ProjectTeamDrawer'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'

const mockConfirm = jest.fn(async () => true)
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (
    params[key] === undefined ? match : String(params[key])
  ))
}

// The real `useT()` returns the memoized translator from context; keep the mock
// stable too so effects depending on `t` do not re-run on every render.
const mockTranslate = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
): string => {
  if (typeof fallbackOrParams === 'string') return interpolate(fallbackOrParams, params)
  return interpolate(key, fallbackOrParams)
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({
  useCurrentUserId: () => 'user-tl',
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(async (_headers: unknown, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(async () => ({ ok: true, result: { id: 'created' } })),
  updateCrud: jest.fn(async () => ({ ok: true, result: { id: 'updated' } })),
  deleteCrud: jest.fn(async () => ({ ok: true, result: { ok: true } })),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockCreateCrud = createCrud as jest.MockedFunction<typeof createCrud>
const mockUpdateCrud = updateCrud as jest.MockedFunction<typeof updateCrud>
const mockDeleteCrud = deleteCrud as jest.MockedFunction<typeof deleteCrud>

const PROJECT_ID = 'project-1'

const memberships = [
  {
    id: 'membership-anna',
    staff_member_id: 'anna',
    role: null,
    status: 'active',
    assigned_start_date: '2026-01-05',
    assigned_end_date: null,
  },
  {
    id: 'membership-paulina',
    staff_member_id: 'paulina',
    role: null,
    status: 'active',
    assigned_start_date: '2026-01-05',
    assigned_end_date: '2026-01-31',
  },
  {
    id: 'membership-marek',
    staff_member_id: 'marek',
    role: null,
    status: 'active',
    assigned_start_date: '2026-01-05',
    assigned_end_date: null,
  },
]

const directory = [
  { id: 'anna', display_name: 'Anna Nowak', user_id: 'user-anna' },
  { id: 'paulina', display_name: 'Paulina Zych', user_id: 'user-paulina' },
  { id: 'marek', display_name: 'Marek Wójcik', user_id: 'user-tl' },
  { id: 'tomasz', display_name: 'Tomasz Iwan', user_id: 'user-tomasz' },
]

const entries = [
  { id: 'entry-1', staff_member_id: 'anna', duration_minutes: 4700 },
  { id: 'entry-2', staff_member_id: 'paulina', duration_minutes: 735 },
]

function installApiRoutes() {
  mockApiCall.mockImplementation(async (url: string) => {
    if (url.includes('/employees')) return { ok: true, result: { items: memberships } } as never
    if (url.includes('/team-members/self')) {
      return {
        ok: true,
        result: { member: { id: 'marek', displayName: 'Marek Wójcik', userId: 'user-tl' } },
      } as never
    }
    if (url.includes('/timesheets/settings')) {
      return { ok: true, result: { access: { assignmentGraceDays: 14 } } } as never
    }
    if (url.includes('/team-members?')) {
      return { ok: true, result: { items: directory, total: directory.length } } as never
    }
    if (url.includes('/time-entries?')) {
      return { ok: true, result: { items: entries, total: entries.length } } as never
    }
    return { ok: true, result: {} } as never
  })
}

function renderDrawer(overrides: Partial<React.ComponentProps<typeof ProjectTeamDrawer>> = {}) {
  return render(
    <ProjectTeamDrawer
      projectId={PROJECT_ID}
      projectName="Nordvik — migracja B2B"
      open
      onOpenChange={jest.fn()}
      onSaved={jest.fn()}
      {...overrides}
    />,
  )
}

describe('ProjectTeamDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockConfirm.mockResolvedValue(true)
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    installApiRoutes()
  })

  it('renders the assigned group with per-member hours logged in this project', async () => {
    renderDrawer()
    expect(await screen.findByText('Anna Nowak')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Team Member · 78:20 in this project')).toBeInTheDocument()
    })
    expect(screen.getByText('Assigned (3)')).toBeInTheDocument()
    expect(screen.getByText('Tomasz Iwan')).toBeInTheDocument()
  })

  it('locks the Team Leader row instead of letting it be unchecked', async () => {
    renderDrawer()
    const leaderCheckbox = await screen.findByRole('checkbox', { name: /Assign Marek Wójcik/ })
    expect(leaderCheckbox).toBeDisabled()
    expect(leaderCheckbox).toBeChecked()
    expect(screen.getByText('always')).toBeInTheDocument()
    expect(screen.getByText('Team Leader · access from role')).toBeInTheDocument()
  })

  it('marks an assignment whose window has expired', async () => {
    renderDrawer()
    expect(await screen.findByText('expired 2026-01-31')).toBeInTheDocument()
    expect(
      screen.getByText('The assignment expired — this person no longer has access to the project.'),
    ).toBeInTheDocument()
  })

  it('asks for confirmation naming the logged hours before unchecking someone', async () => {
    renderDrawer()
    const annaCheckbox = await screen.findByRole('checkbox', { name: /Assign Anna Nowak/ })
    await waitFor(() => {
      expect(screen.getByText('Team Member · 78:20 in this project')).toBeInTheDocument()
    })
    fireEvent.click(annaCheckbox)
    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Anna Nowak has 78:20 in this project — revoke access?',
          variant: 'destructive',
        }),
      )
    })
  })

  it('keeps the row checked when the removal confirmation is declined', async () => {
    mockConfirm.mockResolvedValue(false)
    renderDrawer()
    const annaCheckbox = await screen.findByRole('checkbox', { name: /Assign Anna Nowak/ })
    await waitFor(() => {
      expect(screen.getByText('Team Member · 78:20 in this project')).toBeInTheDocument()
    })
    fireEvent.click(annaCheckbox)
    await waitFor(() => { expect(mockConfirm).toHaveBeenCalled() })
    expect(annaCheckbox).toBeChecked()
  })

  it('saves additions and removals through the guarded mutation', async () => {
    const onOpenChange = jest.fn()
    const onSaved = jest.fn()
    renderDrawer({ onOpenChange, onSaved })

    const tomaszCheckbox = await screen.findByRole('checkbox', { name: /Assign Tomasz Iwan/ })
    fireEvent.click(tomaszCheckbox)
    await waitFor(() => { expect(screen.getByText('being added')).toBeInTheDocument() })

    const paulinaCheckbox = screen.getByRole('checkbox', { name: /Assign Paulina Zych/ })
    fireEvent.click(paulinaCheckbox)
    await waitFor(() => { expect(screen.getByText('being removed')).toBeInTheDocument() })

    expect(screen.getByText('2 changes to save')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(mockRunMutation).toHaveBeenCalledTimes(1) })
    expect(mockCreateCrud).toHaveBeenCalledWith(
      `staff/timesheets/time-projects/${PROJECT_ID}/employees`,
      expect.objectContaining({ staffMemberId: 'tomasz', timeProjectId: PROJECT_ID }),
      expect.anything(),
    )
    expect(mockDeleteCrud).toHaveBeenCalledWith(
      `staff/timesheets/time-projects/${PROJECT_ID}/employees`,
      'membership-paulina',
      expect.anything(),
    )
    await waitFor(() => { expect(onSaved).toHaveBeenCalled() })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // T2.12: re-dating updates the membership row in place. The create+delete pair
  // it replaced was functionally correct but wrote "member removed, member added"
  // into the audit trail — a history that misstates what happened.
  it('re-dates an assignment with a single update and saves on Cmd+Enter', async () => {
    renderDrawer()
    const endDateInput = await screen.findByLabelText('Assignment end', { selector: '#team-end-date-anna' })
    fireEvent.change(endDateInput, { target: { value: '2026-12-31' } })

    await waitFor(() => { expect(screen.getByText('1 change to save')).toBeInTheDocument() })
    expect(mockConfirm).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true })

    await waitFor(() => { expect(mockUpdateCrud).toHaveBeenCalled() })
    expect(mockUpdateCrud).toHaveBeenCalledTimes(1)
    expect(mockUpdateCrud).toHaveBeenCalledWith(
      `staff/timesheets/time-projects/${PROJECT_ID}/employees`,
      { id: 'membership-anna', assignedEndDate: '2026-12-31' },
      expect.anything(),
    )
    // No replacement row, no unassign — the row keeps its identity.
    expect(mockCreateCrud).not.toHaveBeenCalled()
    expect(mockDeleteCrud).not.toHaveBeenCalled()
  })

  it('clears an assignment end date through the same update path', async () => {
    renderDrawer()
    const endDateInput = await screen.findByLabelText('Assignment end', { selector: '#team-end-date-paulina' })
    fireEvent.change(endDateInput, { target: { value: '' } })

    await waitFor(() => { expect(screen.getByText('1 change to save')).toBeInTheDocument() })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => { expect(mockUpdateCrud).toHaveBeenCalled() })
    expect(mockUpdateCrud).toHaveBeenCalledWith(
      `staff/timesheets/time-projects/${PROJECT_ID}/employees`,
      { id: 'membership-paulina', assignedEndDate: null },
      expect.anything(),
    )
    expect(mockDeleteCrud).not.toHaveBeenCalled()
  })

  it('pre-selects the requester from an access-request deep link', async () => {
    renderDrawer({ preselectUserId: 'user-tomasz' })
    const tomaszCheckbox = await screen.findByRole('checkbox', { name: /Assign Tomasz Iwan/ })
    await waitFor(() => { expect(tomaszCheckbox).toBeChecked() })
    expect(screen.getByText('being added')).toBeInTheDocument()
  })
})
