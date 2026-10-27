/**
 * @jest-environment jsdom
 */

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import TraceCaptureSettingsPage from '../backend/settings/trace-capture/page'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((headers: Record<string, string>, operation: () => Promise<unknown>) =>
    operation(),
  ),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

const apiCallMock = apiCall as jest.Mock
const readApiResultMock = readApiResultOrThrow as jest.Mock
const useBackendChromeMock = useBackendChrome as jest.Mock

const SETTINGS = {
  policy: {
    level: 'metadata',
    perAgent: { 'claims.assess': { level: 'full' } },
    retentionDays: 30,
    redactPii: false,
    includeProviderBody: false,
  },
  source: 'tenant',
  deploymentDefault: 'metadata',
  deploymentCeiling: 'full',
  updatedAt: '2026-10-27T10:00:00.000Z',
}

function respond(result: unknown) {
  return { ok: true, status: 200, result, response: {}, cacheStatus: null }
}

function mockApi() {
  apiCallMock.mockImplementation(async (url: string) =>
    url.includes('/agents')
      ? respond({ items: [{ id: 'claims.assess', label: 'Assess claims' }] })
      : respond(SETTINGS),
  )
}

function grant(features: string[]) {
  useBackendChromeMock.mockReturnValue({ payload: { grantedFeatures: features } })
}

describe('trace capture settings page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApi()
  })

  it('renders read-only for a caller without trace content access', async () => {
    grant(['agent_orchestrator.trace.view', 'agent_orchestrator.agents.manage'])
    renderWithProviders(<TraceCaptureSettingsPage />)
    expect(await screen.findByText(/You can see this policy but not change it/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getByText('Content capture is not available yet')).toBeTruthy()
  })

  it('saves the edited policy with the optimistic-lock version from GET', async () => {
    grant(['agent_orchestrator.*'])
    readApiResultMock.mockResolvedValue({ ...SETTINGS, policy: { ...SETTINGS.policy, retentionDays: 45 } })
    const { withScopedApiRequestHeaders } = jest.requireMock('@open-mercato/ui/backend/utils/apiCall') as {
      withScopedApiRequestHeaders: jest.Mock
    }
    renderWithProviders(<TraceCaptureSettingsPage />)
    const retention = await screen.findByLabelText('Retention (days)')
    fireEvent.change(retention, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(readApiResultMock).toHaveBeenCalledTimes(1))
    const [url, init] = readApiResultMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/agent_orchestrator/trace-capture/settings')
    expect(JSON.parse(String(init.body))).toEqual({ ...SETTINGS.policy, retentionDays: 45 })
    expect(withScopedApiRequestHeaders.mock.calls[0][0]).toEqual({
      'x-om-ext-optimistic-lock-expected-updated-at': '2026-10-27T10:00:00.000Z',
    })
  })
})
