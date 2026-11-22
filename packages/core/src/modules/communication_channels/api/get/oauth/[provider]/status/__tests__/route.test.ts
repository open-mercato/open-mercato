import { GET, metadata } from '../route'

const mockGetAuth = jest.fn()
const mockResolveCredentials = jest.fn()
const mockBuildOAuthUrl = jest.fn()
const mockGetAdapter = jest.fn()
const mockResolveService = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => mockGetAuth(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolveService }),
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
    mockResolveService.mockReturnValue({ resolve: mockResolveCredentials })
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
    mockResolveService.mockReturnValue(undefined)
    expect(await (await requestStatus()).json()).toEqual({ configured: false })
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
