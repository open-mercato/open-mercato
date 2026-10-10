/**
 * The plugin boundary: that the Kingdom registers, that it is *reached* rather
 * than assumed, and — the part that matters most — that the adapter's arithmetic
 * is the primitives' arithmetic.
 *
 * The parity block is the guard the whole country-plugin design rests on. A
 * ledger that computes its own 15% and its own two-decimal rounding would drift
 * from the ZATCA payload builder by a halala on some invoice, and a drifted
 * e-invoice is a rejected one. So every amount the plugin reports is compared to
 * the pinned primitive it delegates to, over amounts chosen to hit the rounding
 * boundaries.
 */
import { computeVatFromNet, formatSaudDecimal } from '../lib/saudi/vat'
import { buildSaudiFinancialPlugin } from '../financial-plugin'

const PARITY_AMOUNTS = [
  '0',
  '0.004',
  '0.005',
  '0.01',
  '0.1',
  '1',
  '1.005',
  '9.995',
  '99.99',
  '1000',
  '1234.567',
  '115000.55',
  '999999999.99',
]

describe('the Saudi financial country plugin', () => {
  it('registers itself when the module root is imported', () => {
    // The bootstrap the module performs for its side effect. Importing the root
    // is what the app does at boot; nothing else calls the register function.
    jest.isolateModules(() => {
      const registries = require('@/modules/financial/lib/registries')
      registries.resetFinancialCountryPlugins()
      expect(registries.resolveFinancialCountryPlugin('SA').countryCode).toBe('ZZ')

      require('../index')

      expect(registries.resolveFinancialCountryPlugin('SA').countryCode).toBe('SA')
      // And an unrelated country still falls back, so registering SA changed
      // nothing for anybody else.
      expect(registries.resolveFinancialCountryPlugin('PL').countryCode).toBe('ZZ')
    })
  })

  it('answers the engine with every contract the plugin type allows', () => {
    const plugin = buildSaudiFinancialPlugin()

    expect(plugin.countryCode).toBe('SA')
    expect(plugin.tax.currencyCode).toBe('SAR')
    expect(plugin.tax.minorUnitScale).toBe(2)
    expect(plugin.numberFormat.currencyCode).toBe('SAR')
    expect(plugin.fiscalCalendar.defaultFilingFrequency()).toBe('quarterly')
    expect(plugin.chartOfAccounts).toBeDefined()
    expect(plugin.compliance).toBeDefined()
    expect(plugin.taxReporting).toBeDefined()
  })

  it('reports the e-invoicing capabilities honestly rather than all-true', () => {
    const capabilities = buildSaudiFinancialPlugin().invoice.capabilities()

    // Shipped and pinned.
    expect(capabilities.qrCode).toBe(true)
    expect(capabilities.hashChain).toBe(true)
    // Not shipped: no CSID, so no signature and nothing sent to ZATCA.
    expect(capabilities.signedDocuments).toBe(false)
    expect(capabilities.realtimeClearance).toBe(false)
    expect(buildSaudiFinancialPlugin().invoice.defaultSubtype()).toBe('simplified')
  })

  it('computes tax identically to the pinned primitives, to the halala', () => {
    const plugin = buildSaudiFinancialPlugin()

    for (const net of PARITY_AMOUNTS) {
      const expected = computeVatFromNet(Number(net), 0.15)
      const actual = plugin.tax.compute({ net, taxCode: 'SA-VAT-S' })

      expect({ net, ...actual }).toMatchObject({
        net: formatSaudDecimal(expected.net),
        tax: formatSaudDecimal(expected.vat),
        gross: formatSaudDecimal(expected.gross),
        rate: 0.15,
        category: 'S',
      })
    }
  })

  it('rounds money and formats machine output identically to the primitives', () => {
    const plugin = buildSaudiFinancialPlugin()

    for (const amount of PARITY_AMOUNTS) {
      expect(plugin.tax.roundMoney(amount)).toBe(formatSaudDecimal(amount))
      expect(plugin.numberFormat.formatMachine(amount)).toBe(formatSaudDecimal(amount))
    }
  })

  it('charges nothing for a zero-rated or exempt code while keeping its category', () => {
    const plugin = buildSaudiFinancialPlugin()

    const zeroRated = plugin.tax.compute({ net: '1000.00', taxCode: 'SA-VAT-Z' })
    expect(zeroRated).toMatchObject({ category: 'Z', rate: 0, tax: '0.00', gross: '1000.00' })

    const exempt = plugin.tax.compute({ net: '1000.00', taxCode: 'SA-VAT-E' })
    expect(exempt).toMatchObject({ category: 'E', rate: 0, tax: '0.00' })
  })

  it('honours a stated category over the code, and rejects a negative base', () => {
    const plugin = buildSaudiFinancialPlugin()

    // The source said which exemption applies; the code stays the caller's.
    expect(plugin.tax.compute({ net: '10', taxCode: 'SA-VAT-S', statedCategory: 'Z' }).category).toBe('Z')
    expect(() => plugin.tax.compute({ net: '-5', taxCode: 'SA-VAT-S' })).toThrow()
  })

  it('builds a fiscal year the same way whichever entry point is used', () => {
    const calendar = buildSaudiFinancialPlugin().fiscalCalendar

    expect(calendar.buildPeriods(2026)).toHaveLength(12)
    expect(calendar.periodNumberFor('2026-12-31')).toBe(12)
    expect(calendar.filingPeriodFor('2026-12-31', 'monthly')).toEqual({
      frequency: 'monthly',
      fiscalYear: 2026,
      periodNumber: 12,
      label: '2026-12',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    })
    expect(calendar.filingPeriodFor('2026-01-01', 'annual')).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
  })

  it('renders display amounts in the requested locale without changing the machine value', () => {
    const numberFormat = buildSaudiFinancialPlugin().numberFormat

    expect(numberFormat.formatMachine('1234.5')).toBe('1234.50')
    expect(numberFormat.formatDisplay('1234.5', 'en-US')).toBe('1,234.50')
    // Display-only: the stored/QR value is unchanged by how it is shown.
    expect(numberFormat.formatMachine('1234.5')).toBe('1234.50')
  })
})
