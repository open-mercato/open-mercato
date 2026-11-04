/**
 * @jest-environment jsdom
 */
// The board keys its project query on the scope version, so the organization
// switcher settling the scope (version 0 → 1) re-keys it. For a caller without
// access the previous answer is `null`, and the guard state only survives the
// re-key because react-query treats `null` placeholder data as data: were the
// placeholder dropped (or the denial answered with `undefined`), the board would
// fall back to its loader and reset "Request sent" to an enabled "Request access".
// A switch between two known scopes must still go through the loader.
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import ProjectBoardPage from '../page'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

let mockScopeVersion = 0

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))

jest.mock('../../../../../../../lib/time-tracking-ui/TaskBoardScreen', () => ({
  TaskBoardScreen: () => <div data-testid="task-board-screen" />,
}))

const apiCallMock = apiCall as unknown as jest.Mock
const apiCallOrThrowMock = apiCallOrThrow as unknown as jest.Mock

function projectRequests(): unknown[][] {
  return apiCallMock.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/timesheets/time-projects?'))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockScopeVersion = 0
  apiCallMock.mockResolvedValue({
    ok: false,
    status: 404,
    result: { error: 'Not found', reason: 'no_project_access' },
    response: {},
  })
  apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true }, response: {} })
})

async function renderAndRequestAccess() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const page = () => (
    <QueryClientProvider client={queryClient}>
      <ProjectBoardPage params={{ id: PROJECT_ID }} />
    </QueryClientProvider>
  )
  const view = render(page())
  const requestButton = await screen.findByRole('button', { name: 'Request access' })
  await act(async () => { fireEvent.click(requestButton) })
  expect((await screen.findByRole('button', { name: 'Request sent' })).hasAttribute('disabled')).toBe(true)
  expect(projectRequests()).toHaveLength(1)
  return { rerender: () => view.rerender(page()) }
}

describe('project board — access request survives a scope reload', () => {
  it('keeps "Request sent" after the organization scope settles', async () => {
    const view = await renderAndRequestAccess()

    mockScopeVersion = 1
    view.rerender()

    expect(screen.queryByText('Loading the board…')).toBeNull()
    await waitFor(() => expect(projectRequests()).toHaveLength(2))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Request sent' }).hasAttribute('disabled')).toBe(true)
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
  })

  it('reloads through the loader when switching between two known scopes', async () => {
    mockScopeVersion = 1
    const view = await renderAndRequestAccess()

    mockScopeVersion = 2
    view.rerender()

    expect(screen.getByText('Loading the board…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Request sent' })).toBeNull()
    await waitFor(() => expect(projectRequests()).toHaveLength(2))
    expect(await screen.findByRole('button', { name: 'Request access' })).toBeTruthy()
  })
})
