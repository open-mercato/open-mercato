/** @jest-environment node */

// `User.name` is settable through the admin user API (`/api/auth/users`) but the self-read profile
// endpoint did not return it, so a signed-in user's own chrome could only ever show their email
// address. These cases pin the field onto the GET contract, including the empty-string normalisation
// that keeps "set but blank" from surfacing as a name.

import { GET } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const USER_ID = '123e4567-e89b-12d3-a456-426614174010'

const mockGetAuthFromRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()

const mockEm = { find: jest.fn(), findOne: jest.fn() }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    locale: 'en',
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))

function profileRequest(): Request {
  return new Request('http://localhost/api/auth/profile', { method: 'GET' })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORG_ID,
    roles: ['admin'],
  })
})

describe('GET /api/auth/profile display name', () => {
  it('returns the stored display name alongside the email', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: USER_ID,
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    })

    const response = await GET(profileRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace', roles: ['admin'] })
  })

  it('returns null when the user has no display name', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: USER_ID, email: 'ada@example.com', name: null })

    const body = await (await GET(profileRequest())).json()

    expect(body.name).toBeNull()
    expect(body.email).toBe('ada@example.com')
  })

  it('normalises a blank display name to null rather than reporting an empty label', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: USER_ID, email: 'ada@example.com', name: '   ' })

    const body = await (await GET(profileRequest())).json()

    expect(body.name).toBeNull()
  })

  it('trims surrounding whitespace from the stored name', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: USER_ID, email: 'ada@example.com', name: '  Ada  ' })

    const body = await (await GET(profileRequest())).json()

    expect(body.name).toBe('Ada')
  })

  it('still requires authentication', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await GET(profileRequest())

    expect(response.status).toBe(401)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })
})
