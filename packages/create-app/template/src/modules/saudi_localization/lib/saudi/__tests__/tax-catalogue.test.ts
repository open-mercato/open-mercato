/**
 * The claims a filing rests on: what each tax code means, that the accounts it
 * names exist, and that the invoice prerequisites are checked where they are
 * claimed to be.
 */
import { SAUDI_CHART_OF_ACCOUNTS, buildSaudiChartOfAccounts, SAUDI_COUNTRY_CODE } from '../coa'
import {
  SAUDI_DEFAULT_VAT_CATEGORY,
  SAUDI_EXEMPT_VAT_CODE,
  SAUDI_INPUT_VAT_ACCOUNT,
  SAUDI_OUT_OF_SCOPE_VAT_CODE,
  SAUDI_OUTPUT_VAT_ACCOUNT,
  SAUDI_STANDARD_VAT_CODE,
  SAUDI_VAT_TAX_CODES,
  SAUDI_WHT_PAYABLE_ACCOUNT,
  SAUDI_WITHHOLDING_CATEGORIES,
  SAUDI_ZERO_RATED_VAT_CODE,
  classifySaudiTaxCode,
  findSaudiVatTaxCode,
  findSaudiWithholdingCategory,
  saudiAccountForTaxCode,
} from '../tax-codes'
import { buildSaudiCompliance, checkSaudiInvoicePrerequisites, isValidSaudiCrNumber } from '../compliance'

describe('Saudi tax-code catalogue', () => {
  it('carries the four ZATCA categories at the published rate', () => {
    const byCode = Object.fromEntries(SAUDI_VAT_TAX_CODES.map((entry) => [entry.code, entry]))

    expect(byCode[SAUDI_STANDARD_VAT_CODE]).toMatchObject({ category: 'S', rate: 0.15 })
    expect(byCode[SAUDI_ZERO_RATED_VAT_CODE]).toMatchObject({ category: 'Z', rate: 0 })
    expect(byCode[SAUDI_EXEMPT_VAT_CODE]).toMatchObject({ category: 'E', rate: 0 })
    expect(byCode[SAUDI_OUT_OF_SCOPE_VAT_CODE]).toMatchObject({ category: 'O', rate: 0 })
    expect(SAUDI_VAT_TAX_CODES.map((entry) => entry.category).sort()).toEqual(['E', 'O', 'S', 'Z'])
  })

  it('only the standard code produces tax, and only it names VAT accounts', () => {
    for (const entry of SAUDI_VAT_TAX_CODES) {
      if (entry.code === SAUDI_STANDARD_VAT_CODE) continue
      expect(entry.rate).toBe(0)
      expect(entry.salesAccountCode).toBeNull()
      expect(entry.purchaseAccountCode).toBeNull()
    }
  })

  it('classifies the catalogue codes and reads an unknown code as out of scope', () => {
    expect(classifySaudiTaxCode(SAUDI_STANDARD_VAT_CODE)).toBe('S')
    expect(classifySaudiTaxCode(SAUDI_ZERO_RATED_VAT_CODE)).toBe('Z')
    expect(classifySaudiTaxCode(SAUDI_EXEMPT_VAT_CODE)).toBe('E')
    expect(classifySaudiTaxCode(SAUDI_OUT_OF_SCOPE_VAT_CODE)).toBe('O')
    // An untaxed line nobody explained is never assumed zero-rated.
    expect(classifySaudiTaxCode('LEGACY-CODE')).toBe(SAUDI_DEFAULT_VAT_CATEGORY)
    expect(classifySaudiTaxCode(null)).toBe(SAUDI_DEFAULT_VAT_CATEGORY)
    expect(classifySaudiTaxCode(undefined)).toBe(SAUDI_DEFAULT_VAT_CATEGORY)
  })

  it('tolerates case and padding around a stored code', () => {
    expect(findSaudiVatTaxCode(' sa-vat-s ')).toMatchObject({ category: 'S' })
    expect(findSaudiWithholdingCategory('sa-wht-services')).toMatchObject({ rate: 0.05 })
  })

  it('resolves the posting account per side', () => {
    expect(saudiAccountForTaxCode(SAUDI_STANDARD_VAT_CODE, 'sales')).toBe(SAUDI_OUTPUT_VAT_ACCOUNT)
    expect(saudiAccountForTaxCode(SAUDI_STANDARD_VAT_CODE, 'purchase')).toBe(SAUDI_INPUT_VAT_ACCOUNT)
    expect(saudiAccountForTaxCode(SAUDI_ZERO_RATED_VAT_CODE, 'sales')).toBeNull()
    expect(saudiAccountForTaxCode('SA-WHT-ROYALTIES', 'purchase')).toBe(SAUDI_WHT_PAYABLE_ACCOUNT)
    expect(saudiAccountForTaxCode('nonsense', 'sales')).toBeNull()
  })

  it('publishes the withholding schedule with a payable account on every entry', () => {
    expect(SAUDI_WITHHOLDING_CATEGORIES.length).toBeGreaterThan(0)
    for (const category of SAUDI_WITHHOLDING_CATEGORIES) {
      expect(category.rate).toBeGreaterThan(0)
      expect(category.rate).toBeLessThan(1)
      expect(category.payableAccountCode).toBe(SAUDI_WHT_PAYABLE_ACCOUNT)
      expect(category.code.startsWith('SA-WHT-')).toBe(true)
    }
    expect(findSaudiWithholdingCategory('SA-WHT-ROYALTIES')).toMatchObject({ rate: 0.15 })
  })
})

describe('Saudi chart of accounts', () => {
  it('has unique codes, so seeding is idempotent by construction', () => {
    const codes = SAUDI_CHART_OF_ACCOUNTS.map((entry) => entry.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('defines every account the tax catalogue references', () => {
    const defined = new Set(SAUDI_CHART_OF_ACCOUNTS.map((entry) => entry.code))
    const referenced = new Set<string>()
    for (const entry of SAUDI_VAT_TAX_CODES) {
      if (entry.salesAccountCode) referenced.add(entry.salesAccountCode)
      if (entry.purchaseAccountCode) referenced.add(entry.purchaseAccountCode)
    }
    for (const category of SAUDI_WITHHOLDING_CATEGORIES) referenced.add(category.payableAccountCode)

    expect(referenced.size).toBeGreaterThan(0)
    for (const code of referenced) {
      expect(defined.has(code)).toBe(true)
    }
  })

  it('keeps the two VAT sides in separate accounts, because a return reports them apart', () => {
    expect(SAUDI_INPUT_VAT_ACCOUNT).not.toBe(SAUDI_OUTPUT_VAT_ACCOUNT)
    const input = SAUDI_CHART_OF_ACCOUNTS.find((entry) => entry.code === SAUDI_INPUT_VAT_ACCOUNT)
    const output = SAUDI_CHART_OF_ACCOUNTS.find((entry) => entry.code === SAUDI_OUTPUT_VAT_ACCOUNT)
    expect(input).toMatchObject({ accountClass: 'asset', normalBalance: 'debit' })
    expect(output).toMatchObject({ accountClass: 'liability', normalBalance: 'credit' })
  })

  it('balances every account class against its normal balance', () => {
    for (const entry of SAUDI_CHART_OF_ACCOUNTS) {
      const expected = entry.accountClass === 'asset' || entry.accountClass === 'expense' ? 'debit' : 'credit'
      expect({ code: entry.code, normalBalance: entry.normalBalance }).toEqual({
        code: entry.code,
        normalBalance: expected,
      })
    }
  })

  it('exposes the template through the contract, including the tax-code lookup', () => {
    const template = buildSaudiChartOfAccounts()
    expect(template.countryCode).toBe(SAUDI_COUNTRY_CODE)
    expect(template.listAccounts()).toBe(SAUDI_CHART_OF_ACCOUNTS)
    expect(template.accountCodeForTaxCode(SAUDI_STANDARD_VAT_CODE, 'sales')).toBe(SAUDI_OUTPUT_VAT_ACCOUNT)
  })
})

describe('Saudi compliance checks', () => {
  it('names the field a missing prerequisite belongs to', () => {
    expect(checkSaudiInvoicePrerequisites({ legalName: '', taxRegistrationNumber: '' })).toEqual({
      ok: false,
      issues: [
        { code: 'seller_name_missing', field: 'sellerName' },
        { code: 'vat_number_missing', field: 'vatRegistrationNumber' },
      ],
    })
    expect(checkSaudiInvoicePrerequisites({ legalName: 'Apex', taxRegistrationNumber: '123' })).toEqual({
      ok: false,
      issues: [{ code: 'vat_number_invalid', field: 'vatRegistrationNumber' }],
    })
  })

  it('passes a complete identity and uses the pinned VAT-number rule', () => {
    expect(
      checkSaudiInvoicePrerequisites({ legalName: 'Apex Trading Est.', taxRegistrationNumber: '300000000000003' }),
    ).toEqual({ ok: true, issues: [] })
    const compliance = buildSaudiCompliance()
    expect(compliance.isValidTaxRegistrationNumber('300000000000003')).toBe(true)
    expect(compliance.isValidTaxRegistrationNumber(' 300000000000003 ')).toBe(true)
    expect(compliance.isValidTaxRegistrationNumber('200000000000003')).toBe(false)
    expect(compliance.isValidTaxRegistrationNumber(null)).toBe(false)
  })

  it('treats an absent commercial registration as acceptable and a malformed one as not', () => {
    expect(isValidSaudiCrNumber('1010101010')).toBe(true)
    expect(isValidSaudiCrNumber('10101010')).toBe(false)
    expect(isValidSaudiCrNumber('101010101a')).toBe(false)
    const compliance = buildSaudiCompliance()
    expect(compliance.isValidRegistrationNumber(null)).toBe(true)
    expect(compliance.isValidRegistrationNumber('')).toBe(true)
    expect(compliance.isValidRegistrationNumber('101')).toBe(false)
  })
})
