/**
 * @jest-environment node
 */
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { POST as verifyMagicLink } from '@open-mercato/core/modules/customer_accounts/api/magic-link/verify'
import { POST as acceptInvitation } from '@open-mercato/core/modules/customer_accounts/api/invitations/accept'

const mockVerifyEmailToken = jest.fn()
const mockAcceptInvitation = jest.fn()
const mockCreateSession = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerTokenService') return { verifyEmailToken: mockVerifyEmailToken }
    if (token === 'customerInvitationService') return { acceptInvitation: mockAcceptInvitation }
    if (token === 'customerSessionService') return { createSession: mockCreateSession }
    if (token === 'customerUserService') return {}
    if (token === 'customerRbacService') return { getEffectiveFeatures: jest.fn(async () => []) }
    if (token === 'em') return {}
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn(async () => undefined),
}))

const ORIGINAL_ENV = {
  APP_URL: process.env.APP_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  APP_ALLOWED_ORIGINS: process.env.APP_ALLOWED_ORIGINS,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

type RouteCase = {
  name: string
  path: string
  handler: (req: Request) => Promise<Response>
  payload: Record<string, string>
  serviceMock: jest.Mock
}

const routes: RouteCase[] = [
  {
    name: 'magic-link/verify',
    path: '/api/customer_accounts/magic-link/verify',
    handler: verifyMagicLink,
    payload: { token: 'raw-magic-token' },
    serviceMock: mockVerifyEmailToken,
  },
  {
    name: 'invitations/accept',
    path: '/api/customer_accounts/invitations/accept',
    handler: acceptInvitation,
    payload: { token: 'raw-invite-token', password: 'Attacker-Secret-1!', displayName: 'Attacker' },
    serviceMock: mockAcceptInvitation,
  },
]

function textPlainFormBody(payload: Record<string, string>): string {
  const prefix = JSON.stringify(payload).slice(0, -1)
  return `${prefix},"padding":"=x"}`
}

function buildRequest(path: string, headers: Record<string, string>, body: string): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { host: 'localhost:3000', ...headers },
    body,
  })
}

describe.each(routes)('POST $name — cross-site browser submissions (#7239)', ({ path, handler, payload, serviceMock }) => {
  beforeEach(() => {
    jest.clearAllMocks()
    restoreEnv()
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_ALLOWED_ORIGINS
    mockVerifyEmailToken.mockResolvedValue(null)
    mockAcceptInvitation.mockResolvedValue(null)
  })

  afterAll(() => {
    restoreEnv()
  })

  test('rejects a text/plain cross-site form whose body parses as JSON', async () => {
    const res = await handler(buildRequest(path, {
      'content-type': 'text/plain',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
    }, textPlainFormBody(payload)))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).not.toContain('customer_auth_token=')
    expect(setCookie).not.toContain('customer_session_token=')
    expect(createRequestContainer).not.toHaveBeenCalled()
    expect(mockContainer.resolve).not.toHaveBeenCalled()
    expect(serviceMock).not.toHaveBeenCalled()
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  test('rejects a foreign Origin from a browser that does not send Fetch Metadata', async () => {
    const res = await handler(buildRequest(path, {
      'content-type': 'application/json',
      origin: 'https://evil.example',
    }, JSON.stringify(payload)))

    expect(res.status).toBe(403)
    expect(serviceMock).not.toHaveBeenCalled()
  })

  test('lets a non-browser client without Origin or Sec-Fetch-Site through', async () => {
    const res = await handler(buildRequest(path, { 'content-type': 'application/json' }, JSON.stringify(payload)))

    expect(res.status).not.toBe(403)
    expect(serviceMock).toHaveBeenCalledTimes(1)
  })

  test('lets a same-origin browser request through', async () => {
    const res = await handler(buildRequest(path, {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
    }, JSON.stringify(payload)))

    expect(res.status).not.toBe(403)
    expect(serviceMock).toHaveBeenCalledTimes(1)
  })
})
