/**
 * @jest-environment jsdom
 */

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
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
const flashMock = flash as jest.Mock

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

function mockApi(testResponse: { result: unknown; status?: number }, settings: unknown = SETTINGS) {
  apiCallMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/agents')) return respond({ items: [{ id: 'claims.assess', label: 'Assess claims' }] })
    if (url.includes('/otel-export/test') && init?.method === 'POST') {
      return respond(testResponse.result, testResponse.status ?? 200)
    }
    return respond(settings)
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

  it('labels settings inherited from the installation row', async () => {
    mockApi({ result: { ok: true, httpStatus: 200, latencyMs: 42, errorCode: null } }, { ...SETTINGS, source: 'instance', updatedAt: null })
    grant(['agent_orchestrator.trace.view'])
    renderWithProviders(<OtelExportSettingsPage />)
    expect(await screen.findByText('Inherited from the installation')).toBeTruthy()
    expect(screen.queryByText('Saved for this tenant')).toBeNull()
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

  function withContent(content: 'none' | 'full', contentAllowed: boolean) {
    return {
      ...SETTINGS,
      settings: { ...SETTINGS.settings, content },
      deployment: { ...SETTINGS.deployment, contentAllowed },
    }
  }

  async function contentSelect() {
    return screen.findByRole('combobox', { name: 'Content' })
  }

  it.each([
    ['manager with content access on an allowing deployment', ['agent_orchestrator.*'], true, false],
    ['manager without content access', ['agent_orchestrator.agents.manage', 'agent_orchestrator.trace.view'], true, true],
    ['content access without management', ['agent_orchestrator.trace.view', 'agent_orchestrator.trace.view_content'], true, true],
    ['full access on a denying deployment', ['agent_orchestrator.*'], false, true],
  ])('content select for %s', async (_label, features, contentAllowed, disabled) => {
    mockApi({ result: { ok: true, httpStatus: 200, latencyMs: 42, errorCode: null } }, withContent('none', contentAllowed))
    grant(features)
    renderWithProviders(<OtelExportSettingsPage />)
    const select = await contentSelect()
    expect(select.hasAttribute('disabled')).toBe(disabled)
  })

  it('explains that content access is missing when the deployment allows content', async () => {
    mockApi({ result: { ok: true, httpStatus: 200, latencyMs: 42, errorCode: null } }, withContent('none', true))
    grant(['agent_orchestrator.agents.manage', 'agent_orchestrator.trace.view'])
    renderWithProviders(<OtelExportSettingsPage />)
    expect(await screen.findByText('Exporting prompts and responses needs access to trace content.')).toBeTruthy()
  })

  it('warns about the three locks and the collector when content is exported', async () => {
    mockApi({ result: { ok: true, httpStatus: 200, latencyMs: 42, errorCode: null } }, withContent('full', true))
    grant(['agent_orchestrator.*'])
    renderWithProviders(<OtelExportSettingsPage />)
    expect(await screen.findByText('Prompts and responses leave this system')).toBeTruthy()
    expect(screen.getByText(/sent to the collector configured for this installation/)).toBeTruthy()
    expect(screen.getByText('The operator allows content export for this installation.')).toBeTruthy()
    expect(screen.getByText('This tenant exports metadata and content.')).toBeTruthy()
    expect(screen.getByText('The run was captured at the full trace level.')).toBeTruthy()
  })

  it('shows no content warning for metadata-only export', async () => {
    mockApi({ result: { ok: true, httpStatus: 200, latencyMs: 42, errorCode: null } }, withContent('none', true))
    grant(['agent_orchestrator.*'])
    renderWithProviders(<OtelExportSettingsPage />)
    await contentSelect()
    expect(screen.queryByText('Prompts and responses leave this system')).toBeNull()
  })

  it.each([
    [422, 'This installation does not allow exporting prompts and responses.'],
    [403, 'Exporting prompts and responses needs access to trace content.'],
  ])('surfaces a %i content save error', async (status, message) => {
    mockApi({ result: { ok: true, httpStatus: 200, latencyMs: 42, errorCode: null } }, withContent('full', true))
    grant(['agent_orchestrator.*'])
    readApiResultMock.mockRejectedValue(Object.assign(new Error('rejected'), { status }))
    renderWithProviders(<OtelExportSettingsPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Include user ids' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(message, 'error'))
    const [, init] = readApiResultMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).content).toBe('full')
  })
})
