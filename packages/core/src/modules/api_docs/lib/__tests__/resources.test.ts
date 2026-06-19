import { resolveApiDocsBaseUrl } from '../resources'

describe('resolveApiDocsBaseUrl', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.NEXT_PUBLIC_API_BASE_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_URL
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('derives the API base URL from APP_URL by appending /api', () => {
    process.env.APP_URL = 'http://localhost:3000'

    expect(resolveApiDocsBaseUrl()).toBe('http://localhost:3000/api')
  })

  it('preserves an explicit API base URL override', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3000/api'
    process.env.APP_URL = 'http://localhost:3000'

    expect(resolveApiDocsBaseUrl()).toBe('http://localhost:3000/api')
  })

  it('appends /api to a nested public app URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/admin'

    expect(resolveApiDocsBaseUrl()).toBe('https://example.com/admin/api')
  })

  it('does not duplicate /api when the app URL already includes it', () => {
    process.env.APP_URL = 'https://example.com/api'

    expect(resolveApiDocsBaseUrl()).toBe('https://example.com/api')
  })
})
