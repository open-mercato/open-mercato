import {
  GENERIC_COUNTRY_CODE,
  isGenericFinancialCountryPlugin,
  listRegisteredFinancialCountryCodes,
  registerFinancialCountryPlugin,
  resetFinancialCountryPlugins,
  resolveFinancialCountryPlugin,
  resolveGenericFinancialCountryPlugin,
} from '../registries'

describe('financial country plugin registry', () => {
  beforeEach(() => {
    resetFinancialCountryPlugins()
  })

  afterAll(() => {
    resetFinancialCountryPlugins()
  })

  it('resolves the generic plugin for an unknown, absent or empty country code', () => {
    const generic = resolveGenericFinancialCountryPlugin()
    for (const code of [null, undefined, '', '   ', 'XX', 'NOT-A-COUNTRY']) {
      const resolved = resolveFinancialCountryPlugin(code)
      expect(resolved.countryCode).toBe(GENERIC_COUNTRY_CODE)
      expect(resolved.tax).toBe(generic.tax)
    }
  })

  it('never throws for a malformed code — a bad country is not an outage', () => {
    expect(() => resolveFinancialCountryPlugin('!!!')).not.toThrow()
    expect(isGenericFinancialCountryPlugin(resolveFinancialCountryPlugin('!!!'))).toBe(true)
  })

  it('normalizes a lower-case or padded code to the registered plugin', () => {
    registerFinancialCountryPlugin({ ...resolveGenericFinancialCountryPlugin(), countryCode: 'SA' })

    expect(resolveFinancialCountryPlugin('sa').countryCode).toBe('SA')
    expect(resolveFinancialCountryPlugin('  Sa  ').countryCode).toBe('SA')
    expect(resolveFinancialCountryPlugin('SA').countryCode).toBe('SA')
    expect(listRegisteredFinancialCountryCodes()).toEqual(['SA'])
  })

  it('refuses a plugin with no country code rather than registering an unreachable one', () => {
    expect(() =>
      registerFinancialCountryPlugin({ ...resolveGenericFinancialCountryPlugin(), countryCode: '  ' }),
    ).toThrow(/country code/)
  })

  it('lets a higher-priority registration replace a lower-priority one and not the reverse', () => {
    const low = { ...resolveGenericFinancialCountryPlugin(), countryCode: 'SA', tax: { ...resolveGenericFinancialCountryPlugin().tax, currencyCode: 'LOW' } }
    const high = { ...resolveGenericFinancialCountryPlugin(), countryCode: 'SA', tax: { ...resolveGenericFinancialCountryPlugin().tax, currencyCode: 'HIGH' } }

    registerFinancialCountryPlugin(low, { priority: 1 })
    registerFinancialCountryPlugin(high, { priority: 5 })
    expect(resolveFinancialCountryPlugin('SA').tax.currencyCode).toBe('HIGH')

    registerFinancialCountryPlugin(low, { priority: 1 })
    expect(resolveFinancialCountryPlugin('SA').tax.currencyCode).toBe('HIGH')
  })

  it('gives the generic jurisdiction no tax rules and no e-invoicing', () => {
    const generic = resolveGenericFinancialCountryPlugin()

    expect(generic.tax.listRates()).toEqual([])
    expect(generic.tax.findRate('anything')).toBeNull()
    // "No rule here" is not the same claim as "zero-rated".
    expect(generic.tax.classify('SA-VAT-S')).toBe('O')
    expect(generic.invoice.capabilities()).toEqual({
      qrCode: false,
      realtimeClearance: false,
      signedDocuments: false,
      subtypes: ['standard'],
      hashChain: false,
    })
    expect(generic.chartOfAccounts?.listAccounts()).toEqual([])
    // A jurisdiction we know nothing about cannot certify an invoice.
    expect(generic.compliance?.checkInvoicePrerequisites({ legalName: 'Acme' })).toEqual({
      ok: false,
      issues: [{ code: 'no_localization_configured', field: null }],
    })
    expect(generic.taxReporting).toBeUndefined()
    expect(generic.tax.compute({ net: '100', taxCode: 'x' })).toEqual({
      taxCode: 'x',
      category: 'O',
      rate: 0,
      net: '100.00',
      tax: '0.00',
      gross: '100.00',
    })
  })

  it('builds the generic fiscal calendar as Gregorian months with an annual filing default', () => {
    const calendar = resolveGenericFinancialCountryPlugin().fiscalCalendar

    expect(calendar.fiscalYearFor('2026-07-04')).toBe(2026)
    expect(calendar.periodNumberFor('2026-07-04')).toBe(7)
    expect(calendar.buildPeriods(2026)).toHaveLength(12)
    // February in a leap year: the period end is a calendar fact, not a constant.
    expect(calendar.buildPeriods(2028)[1]).toEqual({
      fiscalYear: 2028,
      periodNumber: 2,
      periodName: '2028-02',
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    })
    expect(calendar.filingPeriodFor('2026-05-20', 'quarterly')).toEqual({
      frequency: 'quarterly',
      fiscalYear: 2026,
      periodNumber: 2,
      label: '2026-Q2',
      startDate: '2026-04-01',
      endDate: '2026-06-30',
    })
    expect(calendar.defaultFilingFrequency()).toBe('annual')
  })

  it('keeps the generic machine form canonical while display stays localized', () => {
    const numberFormat = resolveGenericFinancialCountryPlugin().numberFormat

    expect(numberFormat.formatMachine('1234.5')).toBe('1234.50')
    expect(numberFormat.formatDisplay('1234.5', 'en-US')).toBe('1,234.50')
    // A locale the runtime rejects must degrade to the machine form, never throw
    // on a rendering path.
    expect(numberFormat.formatDisplay('1234.5', 'not a locale')).toBe('1234.50')
  })
})
