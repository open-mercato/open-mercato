/**
 * @jest-environment jsdom
 */

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import OtelExportSettingsPage from '../backend/settings/otel-export/page'

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
  settings: { enabled: true, content: 'none', exportUserIds: false, agentAllowlist: ['claims.assess'] },
  source: 'tenant',
  updatedAt: '2026-10-27T10:00:00.000Z',
  deployment: {
    enabled: true,
    switchOn: true,
    endpointConfigured: true,
    protocol: 'http/json',
    protocolSupported: true,
    contentAllowed: false,
    traceLinkConfigured: true,
  },
  health: { lastSuccessAt: null, lastErrorAt: '2026-10-27T09:00:00.000Z', lastErrorCode: 'http_503' },
}

function respond(result: unknown, status = 200) {
  return { ok: status < 400, status, result, response: {}, cacheStatus: null }
}

function mockApi(testResponse: { result: unknown; status?: number }) {
  apiCallMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/agents')) return respond({ items: [{ id: 'claims.assess', label: 'Assess claims' }] })
    if (url.includes('/otel-export/test') && init?.method === 'POST') {
      return respond(testResponse.result, testResponse.status ?? 200)
    }
    return respond(SETTINGS)
  })
}

function grant(features: string[]) {
  useBackendChromeMock.mockReturnValue({ payload: { grantedFeatures: features } })
}

describe('OTel export settings page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApi({ result: { ok: true, httpStatus: 200, latencyMs: 42, errorCode: null } })
  })

  it('renders read-only without agent management', async () => {
    grant(['agent_orchestrator.trace.view'])
    renderWithProviders(<OtelExportSettingsPage />)
    expect(await screen.findByText(/You can see these settings but not change them/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send test span' })).toBeNull()
    expect(screen.getByText('Assess claims')).toBeTruthy()
    expect(screen.getByText('http/json')).toBeTruthy()
    expect(screen.getByText(/http_503/)).toBeTruthy()
    expect(screen.queryByText(/collector/)).toBeNull()
  })

  it('shows the test-span result inline', async () => {
    grant(['agent_orchestrator.*'])
    renderWithProviders(<OtelExportSettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send test span' }))
    expect(await screen.findByText(/HTTP 200, 42 ms/)).toBeTruthy()
    const postCall = apiCallMock.mock.calls.find(
      ([url, init]) => url === '/api/agent_orchestrator/otel-export/test' && (init as RequestInit)?.method === 'POST',
    )
    expect(postCall).toBeDefined()
  })

  it('shows the backend error code when the test span is rejected', async () => {
    mockApi({ result: { ok: false, httpStatus: 401, latencyMs: 9, errorCode: 'http_401' } })
    grant(['agent_orchestrator.*'])
    renderWithProviders(<OtelExportSettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send test span' }))
    expect(await screen.findByText(/did not accept the test span: http_401/)).toBeTruthy()
  })

  it('saves the edited settings with the optimistic-lock version from GET', async () => {
    grant(['agent_orchestrator.*'])
    readApiResultMock.mockResolvedValue({ ...SETTINGS, settings: { ...SETTINGS.settings, exportUserIds: true } })
    const { withScopedApiRequestHeaders } = jest.requireMock('@open-mercato/ui/backend/utils/apiCall') as {
      withScopedApiRequestHeaders: jest.Mock
    }
    renderWithProviders(<OtelExportSettingsPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Include user ids' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(readApiResultMock).toHaveBeenCalledTimes(1))
    const [url, init] = readApiResultMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/agent_orchestrator/otel-export/settings')
    expect(JSON.parse(String(init.body))).toEqual({ ...SETTINGS.settings, exportUserIds: true })
    expect(withScopedApiRequestHeaders.mock.calls[0][0]).toEqual({
      'x-om-ext-optimistic-lock-expected-updated-at': '2026-10-27T10:00:00.000Z',
    })
  })
})
