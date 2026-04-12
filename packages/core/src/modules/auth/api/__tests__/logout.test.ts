/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/auth/api/logout'

const deleteSessionByToken = jest.fn()
const originalAppUrl = process.env.APP_URL

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_name: string) => ({
      deleteSessionByToken: (...args: unknown[]) => deleteSessionByToken(...args),
    }),
  }),
}))

describe('/api/auth/logout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.APP_URL = 'https://demo.openmercato.com'
  })

  afterAll(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL
      return
    }
    process.env.APP_URL = originalAppUrl
  })

  it('redirects to the request host login page and clears auth cookies', async () => {
    const response = await POST(new Request('https://develop.openmercato.com/api/auth/logout', {
      method: 'POST',
    }))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://develop.openmercato.com/login')

    const setCookie = response.headers.get('set-cookie') || ''
    expect(setCookie).toContain('auth_token=;')
    expect(setCookie).toContain('session_token=;')
    expect(deleteSessionByToken).not.toHaveBeenCalled()
  })
})
