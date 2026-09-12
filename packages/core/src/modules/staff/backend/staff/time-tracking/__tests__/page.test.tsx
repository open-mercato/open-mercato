/**
 * @jest-environment jsdom
 */
// U4 — screen 2 ("no assignments") is what an empty payload looks like, so a failed
// `my-work` request must never fall through to it: a server fault reported as an empty
// account sends the caller to a Team Leader instead of to a retry.

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import TimeTrackingMyWorkPage from '../page'

const mockTranslate = (key: string, fallback?: string | Record<string, string | number>): string =>
  typeof fallback === 'string' ? fallback : key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

jest.mock('@open-mercato/ui/backend/charts', () => ({ KpiCard: () => null }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCall: jest.fn(), readApiResultOrThrow: jest.fn() }
})

jest.mock('@open-mercato/ui/backend/utils/crud', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/crud')
  return { ...actual, createCrud: jest.fn() }
})

jest.mock('../../../../lib/time-tracking-ui/TimeEntryDialog', () => ({ TimeEntryDialog: () => null }))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>
const readApiResultMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
const useBackendChromeMock = useBackendChrome as jest.MockedFunction<typeof useBackendChrome>

const LOAD_ERROR = 'Failed to load your work summary.'
const EMPTY_STATE_TITLE = 'You have no projects assigned yet'

type MyWorkResponse = {
  staffMember: { id: string; displayName: string } | null
  today: string
  entries: unknown[]
  projects: unknown[]
  recentTasks: unknown[]
}

const emptyResponse: MyWorkResponse = {
  staffMember: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' },
  today: '2026-08-20',
  entries: [],
  projects: [],
  recentTasks: [],
}

function resolveWith(payload: MyWorkResponse): void {
  readApiResultMock.mockResolvedValueOnce(payload as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  apiCallMock.mockResolvedValue({
    ok: true,
    status: 200,
    result: { items: [] },
    response: {},
    cacheStatus: null,
  } as unknown as Awaited<ReturnType<typeof apiCall>>)
  useBackendChromeMock.mockReturnValue({
    payload: { grantedFeatures: ['staff.timesheets.manage_own'] },
    isLoading: false,
    isReady: true,
    refresh: jest.fn(),
  } as unknown as ReturnType<typeof useBackendChrome>)
})

describe('my work — load failure', () => {
  it('renders the error state, not the no-assignments screen, when the load fails', async () => {
    readApiResultMock.mockRejectedValue(new Error('[internal] boom'))

    render(<TimeTrackingMyWorkPage />)

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_STATE_TITLE)).not.toBeInTheDocument()
  })

  it('reloads the summary when the retry action is used', async () => {
    readApiResultMock.mockRejectedValueOnce(new Error('[internal] boom'))
    resolveWith(emptyResponse)

    render(<TimeTrackingMyWorkPage />)
    await screen.findByText(LOAD_ERROR)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(EMPTY_STATE_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(LOAD_ERROR)).not.toBeInTheDocument()
    expect(readApiResultMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the no-assignments screen when the load succeeds with nothing to show', async () => {
    resolveWith(emptyResponse)

    render(<TimeTrackingMyWorkPage />)

    expect(await screen.findByText(EMPTY_STATE_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(LOAD_ERROR)).not.toBeInTheDocument()
  })
})
