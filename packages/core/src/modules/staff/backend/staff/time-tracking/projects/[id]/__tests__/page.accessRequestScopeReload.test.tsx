/**
 * @jest-environment jsdom
 */
// The organization switcher settles its scope shortly after mount, which bumps
// the scope version and reloads the project. When that reload lands after the
// user has requested access, it must not fall back to the full-page loader: that
// unmounts the guard state and resets "Request sent" to an enabled "Request
// access", inviting a second request for one already sent.
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import TimesheetProjectDetailPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

let mockScopeVersion = 1

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => `/backend/staff/time-tracking/projects/${PROJECT_ID}`,
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(
    async (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  ),
}))

jest.mock('@open-mercato/ui/backend/charts', () => ({
  KpiCard: ({ label }: { label: React.ReactNode }) => <div>{label}</div>,
  Sparkline: () => null,
}))

jest.mock('../../../../../../lib/time-tracking-ui/ProjectTeamDrawer', () => ({
  ProjectTeamDrawer: () => null,
}))

const apiCallMock = apiCall as unknown as jest.Mock
const apiCallOrThrowMock = apiCallOrThrow as unknown as jest.Mock

function projectRequests(): unknown[][] {
  return apiCallMock.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/timesheets/time-projects?'))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockScopeVersion = 1
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/staff/timesheets/time-projects?')) {
      return { ok: false, status: 404, result: { error: 'Not found', reason: 'no_project_access' }, response: {} }
    }
    return { ok: true, status: 200, result: { items: [], granted: [] }, response: {} }
  })
  apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true }, response: {} })
})

describe('project detail — access request survives a scope reload', () => {
  it('keeps "Request sent" after the organization scope settles', async () => {
    const view = render(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)

    const requestButton = await screen.findByRole('button', { name: 'Request access' })
    await act(async () => { fireEvent.click(requestButton) })
    expect((await screen.findByRole('button', { name: 'Request sent' })).hasAttribute('disabled')).toBe(true)
    expect(projectRequests()).toHaveLength(1)

    mockScopeVersion = 2
    view.rerender(<TimesheetProjectDetailPage params={{ id: PROJECT_ID }} />)

    await waitFor(() => expect(projectRequests()).toHaveLength(2))
    expect(screen.queryByText('Loading project...')).toBeNull()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Request sent' }).hasAttribute('disabled')).toBe(true)
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
  })
})
