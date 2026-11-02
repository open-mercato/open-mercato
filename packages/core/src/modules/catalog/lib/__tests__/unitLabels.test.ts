import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { CATALOG_UNIT_DEFAULTS, translateCatalogUnitLabel } from '../unitLabels'
import en from '../../i18n/en.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'
import pl from '../../i18n/pl.json'

const dictionaries: Record<string, Record<string, string>> = { en, de, es, ko, pl }

describe('Catalog unit labels', () => {
  it.each(CATALOG_UNIT_DEFAULTS)('translates the shipped $value label into Polish', (unit) => {
    expect(translateCatalogUnitLabel(unit.value, unit.label, createTranslator(pl)))
      .toBe(pl[unit.labelKey as keyof typeof pl])
    expect(translateCatalogUnitLabel(unit.value, unit.label, createTranslator(pl)))
      .not.toBe(unit.label)
  })

  it.each(Object.entries(dictionaries))('provides every built-in unit label in %s', (_locale, dictionary) => {
    for (const unit of CATALOG_UNIT_DEFAULTS) {
      expect(dictionary[unit.labelKey]).toEqual(expect.any(String))
      expect(dictionary[unit.labelKey].trim()).not.toBe('')
    }
  })

  it('keeps the original English labels', () => {
    for (const unit of CATALOG_UNIT_DEFAULTS) {
      expect(translateCatalogUnitLabel(unit.value, unit.label, createTranslator(en))).toBe(unit.label)
    }
  })

  it('preserves renamed built-in units and unknown codes', () => {
    const translate = createTranslator(pl)
    expect(translateCatalogUnitLabel('pc', 'Individual item', translate)).toBe('Individual item')
    expect(translateCatalogUnitLabel('pallet', 'Shipping pallet', translate)).toBe('Shipping pallet')
    expect(translateCatalogUnitLabel('custom', 'Piece (piece)', translate)).toBe('Piece (piece)')
    expect(translateCatalogUnitLabel('pc', 'pc', translate)).toBe('pc')
  })

  it('falls back to the stored label when the translation is missing', () => {
    expect(translateCatalogUnitLabel('km', 'Kilometer (length)', createTranslator({})))
      .toBe('Kilometer (length)')
  })

  it('recognizes case-insensitive unit codes', () => {
    expect(translateCatalogUnitLabel('KM', 'Kilometer (length)', createTranslator(pl)))
      .toBe('Kilometr (długość)')
  })
})
