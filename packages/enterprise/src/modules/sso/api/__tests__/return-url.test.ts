const mockInitiateLogin = jest.fn()
const mockHandleOidcCallback = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: () => ({ initiateLogin: mockInitiateLogin, handleOidcCallback: mockHandleOidcCallback }),
  }),
}))
jest.mock('../../services/ssoService', () => ({ SsoService: class {} }))
jest.mock('../../events', () => ({ emitSsoEvent: jest.fn(async () => undefined) }))

import { GET as initiate } from '../initiate/route'
import { GET as callbackGet, POST as callbackPost } from '../callback/oidc/route'

const configId = '33333333-3333-4333-8333-333333333333'
const unsafeReturnUrls = ['/.//outside.example', '/..//outside.example', '/x/..//outside.example']

describe('SSO redirect boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockInitiateLogin.mockResolvedValue({ redirectUrl: 'https://idp.example/authorize', stateCookie: 'encrypted-state' })
    mockHandleOidcCallback.mockResolvedValue({
      redirectUrl: '/backend', token: 'auth-token', sessionToken: 'session-token',
      sessionExpiresAt: new Date('2030-01-01T00:00:00Z'),
    })
  })

  it.each(unsafeReturnUrls)('sanitizes the return path before initiating login: %s', async (returnUrl) => {
    const query = new URLSearchParams({ configId, returnUrl })
    const response = await initiate(new Request(`https://app.example/api/sso/initiate?${query}`))

    expect(mockInitiateLogin).toHaveBeenCalledWith(configId, '/backend', 'https://app.example/api/sso/callback/oidc')
    expect(response.headers.get('location')).toBe('https://idp.example/authorize')
    expect(response.cookies.get('sso_state')?.value).toBe('encrypted-state')
  })

  it('preserves the safe return path during initiation', async () => {
    const returnUrl = '/backend//orders?next=//reference#details'
    const query = new URLSearchParams({ configId, returnUrl })
    await initiate(new Request(`https://app.example/api/sso/initiate?${query}`))
    expect(mockInitiateLogin).toHaveBeenCalledWith(configId, returnUrl, 'https://app.example/api/sso/callback/oidc')
  })

  describe.each([['GET', callbackGet], ['POST', callbackPost]] as const)('%s callback', (method, callback) => {
    it.each([...unsafeReturnUrls, '//outside.example', 'https://outside.example'])('sanitizes previously stored redirect %s', async (redirectUrl) => {
      mockHandleOidcCallback.mockResolvedValueOnce({
        redirectUrl, token: 'auth-token', sessionToken: 'session-token',
        sessionExpiresAt: new Date('2030-01-01T00:00:00Z'),
      })
      const response = await callback(new Request('https://app.example/api/sso/callback/oidc?code=code&state=state', {
        method, headers: { cookie: 'sso_state=encrypted-state' },
      }))

      expect(mockHandleOidcCallback).toHaveBeenCalledWith({ code: 'code', state: 'state' }, 'encrypted-state', 'https://app.example/api/sso/callback/oidc')
      expect(response.headers.get('location')).toBe('https://app.example/backend')
      expect(response.cookies.get('auth_token')?.value).toBe('auth-token')
      expect(response.cookies.get('session_token')?.value).toBe('session-token')
      expect(response.cookies.get('sso_state')?.value).toBe('')
    })

    it('preserves safe redirect paths, queries and fragments', async () => {
      mockHandleOidcCallback.mockResolvedValueOnce({
        redirectUrl: '/backend//orders?next=//reference#details', token: 'auth-token',
        sessionToken: 'session-token', sessionExpiresAt: new Date('2030-01-01T00:00:00Z'),
      })
      const response = await callback(new Request('https://app.example/api/sso/callback/oidc?code=code&state=state', {
        method, headers: { cookie: 'sso_state=encrypted-state' },
      }))
      expect(response.headers.get('location')).toBe('https://app.example/backend//orders?next=//reference#details')
    })
  })
})
