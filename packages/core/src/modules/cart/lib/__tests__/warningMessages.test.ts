import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import english from '../../i18n/en.json'
import polish from '../../i18n/pl.json'
import { resolveCartWarningMessage, type CartWarningMessageKey } from '../warningMessages'

describe('Polish cart warnings', () => {
  const cases: Array<[CartWarningMessageKey, string]> = [
    ['out_of_stock', 'Ten produkt jest niedostępny w magazynie'],
    ['line_unavailable', 'Ten produkt nie jest już dostępny'],
    ['product_unavailable', 'Ten produkt jest niedostępny'],
    ['promotion_no_longer_valid', 'Wcześniej zastosowany kod nie jest już ważny'],
    ['quantity_capped', 'Żądana ilość została ograniczona do maksymalnej dozwolonej'],
  ]

  it.each(cases)('translates %s for the buyer', (messageKey, expected) => {
    const message = resolveCartWarningMessage(messageKey, createFallbackTranslator(polish))

    expect(message).toBe(expected)
    expect(message).not.toMatch(/assortment|scope|\[internal\]/i)
    expect(message).not.toBe(resolveCartWarningMessage(messageKey, createFallbackTranslator(english)))
  })

  it('preserves the English warning', () => {
    expect(resolveCartWarningMessage('quantity_capped', createFallbackTranslator(english)))
      .toBe('The requested quantity was capped at the maximum allowed')
  })
})
