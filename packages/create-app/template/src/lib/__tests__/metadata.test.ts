/**
 * @jest-environment node
 */

import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveLocalizedAppMetadata, resolveLocalizedTitleMetadata } from '../metadata'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(),
}))

type TranslationContext = Awaited<ReturnType<typeof resolveTranslations>>
type Translator = TranslationContext['t']

describe('metadata helpers', () => {
  const mockResolveTranslations = jest.mocked(resolveTranslations)
  let mockTranslate: jest.MockedFunction<Translator>

  beforeEach(() => {
    jest.clearAllMocks()
    mockTranslate = jest.fn<ReturnType<Translator>, Parameters<Translator>>((key, fallbackOrParams) => {
      const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : undefined
      return fallback ? `translated:${key}:${fallback}` : `translated:${key}`
    })

    const translations: TranslationContext = {
      locale: 'en',
      dict: {},
      t: mockTranslate,
      translate: (key, fallback) => fallback ?? key,
    }

    mockResolveTranslations.mockResolvedValue(translations)
  })

  it('resolves app metadata with translated defaults', async () => {
    await expect(resolveLocalizedAppMetadata()).resolves.toEqual({
      title: 'translated:app.metadata.title:Open Mercato',
      description: 'translated:app.metadata.description:AI-supportive, modular ERP foundation for product & service companies',
    })

    expect(mockResolveTranslations).toHaveBeenCalledTimes(1)
    expect(mockTranslate).toHaveBeenNthCalledWith(1, 'app.metadata.title', 'Open Mercato')
    expect(mockTranslate).toHaveBeenNthCalledWith(
      2,
      'app.metadata.description',
      'AI-supportive, modular ERP foundation for product & service companies',
    )
  })

  it('translates a page title when a translation key is provided', async () => {
    await expect(
      resolveLocalizedTitleMetadata({
        title: 'Customers',
        titleKey: 'customers.page.title',
      }),
    ).resolves.toEqual({
      title: 'translated:customers.page.title:Customers',
    })

    expect(mockTranslate).toHaveBeenCalledWith('customers.page.title', 'Customers')
  })

  it('returns the fallback title directly when no translation key is provided', async () => {
    await expect(
      resolveLocalizedTitleMetadata({
        fallback: 'Dashboard',
      }),
    ).resolves.toEqual({
      title: 'Dashboard',
    })

    expect(mockTranslate).not.toHaveBeenCalled()
  })

  it('uses the app title as the translation fallback when no title input is provided', async () => {
    await expect(
      resolveLocalizedTitleMetadata({
        titleKey: 'backend.section.title',
      }),
    ).resolves.toEqual({
      title: 'translated:backend.section.title:Open Mercato',
    })

    expect(mockTranslate).toHaveBeenCalledWith('backend.section.title', 'Open Mercato')
  })
})
