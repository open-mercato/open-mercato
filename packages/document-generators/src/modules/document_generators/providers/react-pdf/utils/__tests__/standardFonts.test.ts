import { hasCharactersOutsideStandardFonts, usesStandardFontsOnly } from '../standardFonts'

describe('usesStandardFontsOnly', () => {
  it('is true only when every family is a standard PDF font', () => {
    expect(usesStandardFontsOnly('Helvetica')).toBe(true)
    expect(usesStandardFontsOnly(['Times-Roman', 'Courier'])).toBe(true)
    expect(usesStandardFontsOnly(['Brand', 'Helvetica'])).toBe(false)
    expect(usesStandardFontsOnly('Brand')).toBe(false)
  })
})

describe('hasCharactersOutsideStandardFonts', () => {
  it('accepts Western European text the standard fonts can render', () => {
    expect(hasCharactersOutsideStandardFonts({ label: 'Gesamtbetrag – Größe, Pequeño €' })).toBe(false)
    expect(hasCharactersOutsideStandardFonts(undefined)).toBe(false)
  })

  it('detects Polish and Korean letters anywhere in the data', () => {
    expect(hasCharactersOutsideStandardFonts({ label: 'Suma częściowa' })).toBe(true)
    expect(hasCharactersOutsideStandardFonts({ lines: [{ name: '청구 금액' }] })).toBe(true)
  })
})
