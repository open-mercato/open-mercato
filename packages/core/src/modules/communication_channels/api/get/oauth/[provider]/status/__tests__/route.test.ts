import { GET, metadata } from '../route'

const mockGetAuth = jest.fn()
const mockResolveCredentials = jest.fn()
const mockBuildOAuthUrl = jest.fn()
const mockGetAdapter = jest.fn()
const mockResolveService = jest.fn()
const mockReportError = jest.fn()
const mockUserHasAllFeatures = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => mockGetAuth(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolveService }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: () => ({ credentials: { fields: [{ key: 'clientSecret', required: true }] } }),
}))

jest.mock('../../../../../../lib/adapter-registry-singleton', () => ({
  getChannelAdapter: (provider: string) => mockGetAdapter(provider),
}))

const tenantId = 'tenant-1'
const organizationId = 'org-1'

function requestStatus(provider = 'gmail') {
  const req = new Request('https://app.example.test/api/communication_channels/oauth/gmail/status')
  return GET(req, { params: Promise.resolve({ provider }) })
}

describe('GET OAuth provider setup status', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockGetAuth.mockResolvedValue({ sub: 'user-1', tenantId, orgId: organizationId })
    mockResolveCredentials.mockResolvedValue(null)
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockResolveService.mockImplementation((token: string) => token === 'rbacService'
      ? { userHasAllFeatures: mockUserHasAllFeatures }
      : { resolve: mockResolveCredentials })
    mockGetAdapter.mockImplementation((provider) =>
      provider === 'gmail' ? { buildOAuthAuthorizeUrl: mockBuildOAuthUrl } : undefined,
    )
  })

  it('returns only readiness and never starts OAuth with stored credentials', async () => {
    mockResolveCredentials.mockResolvedValue({ clientId: 'test-id', clientSecret: 'test-secret' })

    const response = await requestStatus()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ configured: true })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockBuildOAuthUrl).not.toHaveBeenCalled()
    expect(mockResolveCredentials).toHaveBeenCalledTimes(1)
    expect(mockResolveCredentials).toHaveBeenCalledWith('channel_gmail', {
      tenantId, organizationId, userId: null,
    })
  })

  it('uses organization-agnostic credentials within the same tenant as a fallback', async () => {
    mockResolveCredentials.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ clientId: 'test-id', clientSecret: 'test-secret' })

    const response = await requestStatus()

    expect(await response.json()).toEqual({ configured: true })
    expect(mockResolveCredentials).toHaveBeenNthCalledWith(2, 'channel_gmail', {
      tenantId, organizationId: null, userId: null,
    })
  })

  it.each([null, { clientId: 'test-id' }, { clientId: 'test-id', clientSecret: ' ' }])(
    'reports false for missing or incomplete OAuth client configuration (%j)',
    async (credentials) => {
      mockResolveCredentials.mockResolvedValue(credentials)

      const response = await requestStatus()

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ configured: false })
    },
  )

  it('reports false when the integrations service is disabled', async () => {
    mockResolveService.mockImplementation((token: string) => token === 'rbacService'
      ? { userHasAllFeatures: mockUserHasAllFeatures }
      : undefined)
    expect(await (await requestStatus()).json()).toEqual({ configured: false })
  })

  it('does not switch to a tenant client when the selected organization client lacks its secret', async () => {
    mockResolveCredentials.mockResolvedValueOnce({ clientId: 'org-id' })
      .mockResolvedValueOnce({ clientId: 'tenant-id', clientSecret: 'tenant-secret' })

    expect(await (await requestStatus()).json()).toEqual({ configured: false })
    expect(mockResolveCredentials).toHaveBeenCalledTimes(1)
  })

  it('checks access in the same organization from which it would read credentials', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)

    const response = await requestStatus()

    expect(response.status).toBe(403)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      'user-1', ['communication_channels.connect_user_channel'], { tenantId, organizationId },
    )
    expect(mockResolveCredentials).not.toHaveBeenCalled()
  })

  it('uses the authentication context supplied by the dispatcher', async () => {
    const response = await GET(new Request('https://app.example.test'), {
      params: { provider: 'gmail' },
      auth: { sub: 'dispatcher-user', tenantId, orgId: organizationId },
    })

    expect(response.status).toBe(200)
    expect(mockGetAuth).not.toHaveBeenCalled()
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(
      'dispatcher-user', ['communication_channels.connect_user_channel'], { tenantId, organizationId },
    )
  })

  it('returns a retryable error when credentials cannot be read in either scope', async () => {
    const error = new Error('Credentials temporarily unavailable')
    mockResolveCredentials.mockRejectedValueOnce(error).mockResolvedValueOnce(null)

    const response = await requestStatus()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'OAuth client status unavailable' })
    expect(mockReportError).toHaveBeenCalledWith(error, expect.objectContaining({
      code: 'communication_channels.oauth_client_status_unavailable',
    }))
  })

  it('reports readiness when tenant credentials are available after an organization read fails', async () => {
    mockResolveCredentials.mockRejectedValueOnce(new Error('Credentials temporarily unavailable'))
      .mockResolvedValueOnce({ clientId: 'test-id', clientSecret: 'test-secret' })

    const response = await requestStatus()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ configured: true })
  })

  it('requires mailbox connection access and does not look up credentials for an anonymous caller', async () => {
    mockGetAuth.mockResolvedValue(null)

    expect(metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['communication_channels.connect_user_channel'],
    })
    expect((await requestStatus()).status).toBe(401)
    expect(mockGetAdapter).not.toHaveBeenCalled()
    expect(mockResolveService).not.toHaveBeenCalled()
  })

  it.each([['../gmail', 400], ['missing', 404], ['imap', 404]])(
    'rejects malformed and unsupported provider keys (%s)',
    async (provider, status) => {
      if (provider === 'imap') mockGetAdapter.mockReturnValue({})
      expect((await requestStatus(provider)).status).toBe(status)
      expect(mockResolveService).not.toHaveBeenCalled()
    },
  )
})
