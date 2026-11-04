const resolveTranslationsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: (...args: unknown[]) => resolveTranslationsMock(...args),
}))

import { ecommerceInternalErrorBody, translateEcommerceError } from '../crudSupport'

describe('ecommerce error translation', () => {
  beforeEach(() => resolveTranslationsMock.mockReset())

  it('translates the message through the ecommerce.errors catalogue', async () => {
    resolveTranslationsMock.mockResolvedValue({ translate: (key: string) => `translated:${key}` })
    await expect(translateEcommerceError('ecommerce.errors.unauthorized', 'Sign in to continue.')).resolves.toBe(
      'translated:ecommerce.errors.unauthorized',
    )
    await expect(ecommerceInternalErrorBody()).resolves.toEqual({ error: 'translated:ecommerce.errors.internal' })
  })

  it('falls back to the default message when translations cannot be loaded', async () => {
    resolveTranslationsMock.mockRejectedValue(new Error('[internal] dictionary unavailable'))
    await expect(ecommerceInternalErrorBody()).resolves.toEqual({ error: 'Something went wrong. Try again.' })
  })
})
