const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const getValueMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') return { getValue: (...args: unknown[]) => getValueMock(...args) }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const context = {
  container,
  auth: { tenantId, sub: userId },
  organizationId,
  tenantId,
}

jest.mock('@open-mercato/core/modules/translations/api/context', () => ({
  resolveTranslationsRouteContext: jest.fn(async () => context),
}))

import GET from '../locales'

const makeRequest = () =>
  new Request('http://localhost/api/translations/locales', {
    method: 'GET',
  })

describe('translations locales route scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getValueMock.mockResolvedValue(['en', 'pl'])
  })

  it('reads supported locales from the caller tenant with global fallback defaults', async () => {
    const response = await GET(makeRequest())

    expect(response.status).toBe(200)
    expect(getValueMock).toHaveBeenCalledWith(
      'translations',
      'supported_locales',
      expect.objectContaining({
        defaultValue: expect.any(Array),
        scope: { tenantId },
      }),
    )
    await expect(response.json()).resolves.toEqual({ locales: ['en', 'pl'] })
  })
})
