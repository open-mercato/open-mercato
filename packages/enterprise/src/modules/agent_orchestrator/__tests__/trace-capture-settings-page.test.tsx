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
    retentionDays: 45,
    redactPii: true,
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
    expect(screen.getByText('Full capture stores prompts and responses')).toBeTruthy()
    expect(screen.queryByText(/record metadata only until|takes effect together with content capture/)).toBeNull()
    const retention = screen.getByLabelText('Retention (days)') as HTMLInputElement
    expect(retention.disabled).toBe(true)
    const redact = screen.getByRole('switch', { name: 'Redact personal data' })
    expect(redact.hasAttribute('disabled')).toBe(true)
  })

  it('lets a manager edit retention and redaction, keeping raw provider bodies disabled', async () => {
    grant(['agent_orchestrator.*'])
    renderWithProviders(<TraceCaptureSettingsPage />)
    const retention = (await screen.findByLabelText('Retention (days)')) as HTMLInputElement
    expect(retention.disabled).toBe(false)
    expect(retention.value).toBe('45')
    expect(screen.getByText('Stored prompts and responses are deleted after this many days.')).toBeTruthy()
    const redact = screen.getByRole('switch', { name: 'Redact personal data' })
    expect(redact.hasAttribute('disabled')).toBe(false)
    expect(screen.getByText(/Masks email addresses/)).toBeTruthy()
    const providerBody = screen.getAllByRole('switch').find((element) => element !== redact)
    expect(providerBody?.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText(/Content capture is not available yet/)).toBeNull()
  })

  it('saves edited retention and redaction', async () => {
    grant(['agent_orchestrator.*'])
    readApiResultMock.mockResolvedValue(SETTINGS)
    renderWithProviders(<TraceCaptureSettingsPage />)
    const retention = (await screen.findByLabelText('Retention (days)')) as HTMLInputElement
    fireEvent.change(retention, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Redact personal data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(readApiResultMock).toHaveBeenCalledTimes(1))
    const [, init] = readApiResultMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ retentionDays: 7, redactPii: false })
  })

  it('saves the edited policy with the optimistic-lock version from GET, keeping stored retention and redaction', async () => {
    grant(['agent_orchestrator.*'])
    readApiResultMock.mockResolvedValue({ ...SETTINGS, policy: { ...SETTINGS.policy, perAgent: {} } })
    const { withScopedApiRequestHeaders } = jest.requireMock('@open-mercato/ui/backend/utils/apiCall') as {
      withScopedApiRequestHeaders: jest.Mock
    }
    renderWithProviders(<TraceCaptureSettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove override' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(readApiResultMock).toHaveBeenCalledTimes(1))
    const [url, init] = readApiResultMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/agent_orchestrator/trace-capture/settings')
    expect(JSON.parse(String(init.body))).toEqual({ ...SETTINGS.policy, perAgent: {} })
    expect(withScopedApiRequestHeaders.mock.calls[0][0]).toEqual({
      'x-om-ext-optimistic-lock-expected-updated-at': '2026-10-27T10:00:00.000Z',
    })
  })
})
