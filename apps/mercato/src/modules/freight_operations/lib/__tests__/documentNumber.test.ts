/** @jest-environment node */
import { formatDocumentNumber, numberPrefix } from '../documentNumber'
import { FREIGHT_SETTINGS_DEFAULTS } from '../freightSettings'

describe('freight document numbers', () => {
  it('pads the sequence to five digits behind the per-kind prefix', () => {
    expect(formatDocumentNumber('order', 1, FREIGHT_SETTINGS_DEFAULTS)).toBe('FO-00001')
    expect(formatDocumentNumber('contract', 42, FREIGHT_SETTINGS_DEFAULTS)).toBe('FC-00042')
    expect(formatDocumentNumber('trip', 999, FREIGHT_SETTINGS_DEFAULTS)).toBe('FT-00999')
    expect(formatDocumentNumber('abstract', 12345, FREIGHT_SETTINGS_DEFAULTS)).toBe('FA-12345')
  })

  it('honours operator overrides and clamps nonsense sequences', () => {
    const settings = { ...FREIGHT_SETTINGS_DEFAULTS, orderNumberPrefix: 'ORD' }
    expect(numberPrefix('order', settings)).toBe('ORD')
    expect(formatDocumentNumber('order', 7, settings)).toBe('ORD-00007')
    expect(formatDocumentNumber('order', 0, settings)).toBe('ORD-00001')
    expect(formatDocumentNumber('order', -5, settings)).toBe('ORD-00001')
  })
})
