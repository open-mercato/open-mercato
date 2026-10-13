import { DEFAULT_CHART_OF_ACCOUNTS_PL } from '../defaultChartOfAccounts'
import { accountNumberFitsType, checkTypeNumber } from '../accountNumbering'

// The template is Polish, so it must satisfy the same numbering rules the
// commands enforce for every PL group (PR #6340 review): a type number is
// three digits starting with its group's code, and an account number starts
// with its type's number. Otherwise the import would create a chart that
// the edit commands then refuse to touch.
describe('DEFAULT_CHART_OF_ACCOUNTS_PL numbering', () => {
  it('every type number is three digits and starts with its group code', () => {
    for (const type of DEFAULT_CHART_OF_ACCOUNTS_PL) {
      const group = { jurisdiction: 'PL', code: type.accountGroupCode }
      expect({ number: type.number, violation: checkTypeNumber(type.number, group) }).toEqual({
        number: type.number,
        violation: null,
      })
    }
  })

  it('every account number starts with its type number', () => {
    for (const type of DEFAULT_CHART_OF_ACCOUNTS_PL) {
      const group = { jurisdiction: 'PL', code: type.accountGroupCode }
      for (const account of type.accounts) {
        expect({ number: account.number, fits: accountNumberFitsType(account.number, type.number, group) }).toEqual({
          number: account.number,
          fits: true,
        })
      }
    }
  })

  it('has no duplicate type or account numbers', () => {
    const typeNumbers = DEFAULT_CHART_OF_ACCOUNTS_PL.map((type) => type.number)
    const accountNumbers = DEFAULT_CHART_OF_ACCOUNTS_PL.flatMap((type) => type.accounts.map((account) => account.number))
    expect(new Set(typeNumbers).size).toBe(typeNumbers.length)
    expect(new Set(accountNumbers).size).toBe(accountNumbers.length)
  })
})
