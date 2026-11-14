import { normalizePriceFormAmounts } from '../priceFormAmounts'
import pl from '../../../i18n/pl.json'

const t = (key: string) => pl[key as keyof typeof pl] ?? key

describe('flat price-rule monetary input', () => {
  it.each(['pl', 'en', 'de', 'es', 'ko'])('normalizes comma and dot decimals under %s without shifting digits', (locale) => {
    expect(normalizePriceFormAmounts({ unitPriceNet: '12,50', unitPriceGross: '15.38' }, locale, t))
      .toEqual({ unitPriceNet: '12.5', unitPriceGross: '15.38' })
    expect(normalizePriceFormAmounts({ unitPriceNet: '1.500', unitPriceGross: '1,500' }, locale, t))
      .toEqual({ unitPriceNet: '1.5', unitPriceGross: '1.5' })
  })

  it('keeps zero and omits blank optional amounts without mutating form values', () => {
    const values = { unitPriceNet: ' 0,00 ', unitPriceGross: ' ' }
    expect(normalizePriceFormAmounts(values, 'pl', t)).toEqual({ unitPriceNet: '0' })
    expect(values).toEqual({ unitPriceNet: ' 0,00 ', unitPriceGross: ' ' })
    expect(normalizePriceFormAmounts({}, 'pl', t)).toEqual({})
  })

  it.each(['12,3,4', '1 2', 'abc', 'NaN', 'Infinity', '1e999', '-1', '−0,01', '1000000000000', '1,23456'])('refuses %s with localized errors on both fields', (raw) => {
    expect(() => normalizePriceFormAmounts({ unitPriceNet: raw, unitPriceGross: raw }, 'pl', t))
      .toThrow(expect.objectContaining({
        message: 'Podaj poprawną, nieujemną cenę.',
        fieldErrors: { unitPriceNet: 'Podaj poprawną, nieujemną cenę.', unitPriceGross: 'Podaj poprawną, nieujemną cenę.' },
      }))
  })
})
