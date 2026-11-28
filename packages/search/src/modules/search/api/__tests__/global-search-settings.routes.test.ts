const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockTranslate = jest.fn()
const mockReportSearchError = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: () => mockGetAuthFromRequest(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => mockCreateRequestContainer(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: mockTranslate }),
}))
jest.mock('../../../../lib/debug', () => ({
  reportSearchError: mockReportSearchError,
  searchError: jest.fn(),
}))

import { POST } from '../settings/global-search/route'

test('reports unexpected save failures and returns only the localized internal error', async () => {
  const saveFailure = new Error('[internal] Mock settings storage failure')
  const setValue = jest.fn().mockRejectedValue(saveFailure)
  const dispose = jest.fn()
  mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1' })
  mockCreateRequestContainer.mockResolvedValue({
    resolve: () => ({ setValue }),
    dispose,
  })
  mockTranslate.mockReturnValue('Wewnętrzny błąd serwera')

  const response = await POST(new Request('http://localhost/api/search/settings/global-search', {
    method: 'POST',
    body: JSON.stringify({ enabledStrategies: ['tokens'] }),
  }))

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Wewnętrzny błąd serwera' })
  expect(mockTranslate).toHaveBeenCalledWith('api.errors.internal', 'Internal error')
  expect(setValue).toHaveBeenCalledWith('search', 'global_search_strategies', ['tokens'], { tenantId: 'tenant-1' })
  expect(mockReportSearchError).toHaveBeenCalledWith(
    'search.global_search_settings.update',
    saveFailure,
    'search.global_search_settings_update_failed',
  )
  expect(dispose).toHaveBeenCalledTimes(1)
})
