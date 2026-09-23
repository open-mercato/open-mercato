/**
 * @jest-environment jsdom
 */
// U4 — a failed projects call must not be reported as "no project to show". That
// empty state tells the caller to ask a Team Leader for access, which is the wrong
// advice for a network error or a 500, so the query errors and the screen offers a
// retry instead. The genuine empty case keeps the genuine empty state.

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import TimeTrackingBoardPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

const mockTranslate = (key: string, fallback?: string | Record<string, string | number>): string =>
  typeof fallback === 'string' ? fallback : key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCall: jest.fn() }
})

jest.mock('../../../../../lib/time-tracking-ui/TaskBoardScreen', () => ({
  TaskBoardScreen: ({ projectName }: { projectName: string }) => (
    <div data-testid="task-board-screen">{projectName}</div>
  ),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

type ApiCallResult = Awaited<ReturnType<typeof apiCall>>

function listResult(items: Array<Record<string, unknown>>): ApiCallResult {
  return { ok: true, status: 200, result: { items }, response: {}, cacheStatus: null } as unknown as ApiCallResult
}

function failedResult(status: number): ApiCallResult {
  return { ok: false, status, result: null, response: {}, cacheStatus: null } as unknown as ApiCallResult
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TimeTrackingBoardPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('time tracking board — projects load failure', () => {
  it('renders the error state, not the empty state, when the projects call fails', async () => {
    apiCallMock.mockResolvedValue(failedResult(500))

    renderPage()

    expect(await screen.findByText('Could not load your projects.')).toBeInTheDocument()
    expect(screen.queryByText('No project to show')).not.toBeInTheDocument()
  })

  it('renders the error state when the request itself throws', async () => {
    apiCallMock.mockRejectedValue(new Error('[internal] network down'))

    renderPage()

    expect(await screen.findByText('Could not load your projects.')).toBeInTheDocument()
    expect(screen.queryByText('No project to show')).not.toBeInTheDocument()
  })

  it('refetches the projects when the retry action is used', async () => {
    apiCallMock.mockResolvedValueOnce(failedResult(500))
    apiCallMock.mockResolvedValueOnce(listResult([{ id: PROJECT_ID, name: 'Nordvik' }]))

    renderPage()
    await screen.findByText('Could not load your projects.')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('task-board-screen')).toHaveTextContent('Nordvik')
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the empty state when the call succeeds with no projects', async () => {
    apiCallMock.mockResolvedValue(listResult([]))

    renderPage()

    expect(await screen.findByText('No project to show')).toBeInTheDocument()
    expect(screen.queryByText('Could not load your projects.')).not.toBeInTheDocument()
  })
})
