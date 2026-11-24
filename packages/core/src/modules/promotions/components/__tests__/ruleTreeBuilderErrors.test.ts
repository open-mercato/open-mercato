// Step 8.7 (QA F3): `RuleTreeBuilder.tsx`'s `handleSave` used to flash the same generic
// "Could not save the rule tree" message for every failed `PUT /api/promotions/[id]/tree`,
// silently dropping the 422 response's `issues[]` array (one entry per zod issue:
// `{ path, message }`). This pins the two pure helpers that now read that array off the
// caught error — `extractTreeValidationIssues` and `issueTouchesPath` — so a future
// refactor of the error shape (or of `handleSave`'s `Object.assign` call) cannot silently
// regress back to the generic-only flash.

import { extractTreeValidationIssues, issueTouchesPath } from '../RuleTreeBuilder'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { benefitInputSchema } from '../../data/validators'
import polish from '../../i18n/pl.json'
import cartPolish from '../../../cart/i18n/pl.json'

describe('extractTreeValidationIssues', () => {
  it('returns an empty array when the error carries no issues', () => {
    expect(extractTreeValidationIssues(new Error('boom'))).toEqual([])
  })

  it('returns an empty array for a non-object error', () => {
    expect(extractTreeValidationIssues('boom')).toEqual([])
    expect(extractTreeValidationIssues(null)).toEqual([])
  })

  it('reads the issues array off an Object.assign-decorated error', () => {
    const error = Object.assign(new Error('[internal] promotions.tree.put failed'), {
      status: 422,
      error: '[internal] rule tree validation failed',
      issues: [{ path: ['eligibleCurrencies'], message: 'A promotion ... must set exactly one eligible currency' }],
    })
    const issues = extractTreeValidationIssues(error)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('eligible currency')
  })

  it('ignores a non-array issues field', () => {
    const error = Object.assign(new Error('boom'), { issues: 'not-an-array' })
    expect(extractTreeValidationIssues(error)).toEqual([])
  })

  it.each([
    ['-10', 'Must be a non-negative decimal string', 'Wpisz liczbę nieujemną'],
    ['150', 'A percentage discount value cannot exceed 100', 'Rabat procentowy nie może przekraczać 100'],
  ])('localizes the validator feedback for a discount of %s', (value, originalMessage, expected) => {
    const parsed = benefitInputSchema.safeParse({
      benefitType: 'cart_discount',
      appliesTo: 'order',
      config: { discountType: 'percentage', value, labels: { pl: 'Rabat' } },
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return

    expect(parsed.error.issues.some((issue) => issue.message === originalMessage)).toBe(true)
    const translated = extractTreeValidationIssues({ issues: parsed.error.issues }, createTranslator(polish))
    expect(translated.some((issue) => issue.message === expected)).toBe(true)
    expect(translated.some((issue) => issue.message === originalMessage)).toBe(false)
    expect(parsed.error.issues.some((issue) => issue.message === originalMessage)).toBe(true)
  })

  it('keeps unrecognized validation messages intact', () => {
    const issue = { path: ['root'], message: 'Other validation error' }
    expect(extractTreeValidationIssues({ issues: [issue] }, createTranslator(polish))).toEqual([issue])
  })
})

describe('Polish promotion copy', () => {
  const translate = createTranslator({ ...cartPolish, ...polish })

  it('names the permission groups in Polish', () => {
    expect(translate('auth.acl.modules.cart', 'Cart')).toBe('Koszyk')
    expect(translate('auth.acl.modules.promotions', 'Promotions')).toBe('Promocje')
  })

  it('explains the currency requirement without internal references', () => {
    expect(translate('promotions.form.fields.eligibleCurrencies.description')).not.toContain('D-R4-27')
    expect(translate('promotions.tree.errors.eligibleCurrencyRequired'))
      .toBe('Dodaj odpowiednią walutę w ustawieniach promocji przed zapisaniem reguły lub korzyści, która jej wymaga')
  })
})

describe('issueTouchesPath', () => {
  it('matches when the segment is present anywhere in the path', () => {
    expect(issueTouchesPath({ path: ['eligibleCurrencies'] }, 'eligibleCurrencies')).toBe(true)
    expect(issueTouchesPath({ path: [0, 'config', 'eligibleCurrencies'] }, 'eligibleCurrencies')).toBe(true)
  })

  it('does not match an unrelated path', () => {
    expect(issueTouchesPath({ path: ['budgetCurrency'] }, 'eligibleCurrencies')).toBe(false)
  })

  it('treats a missing or malformed path as no match', () => {
    expect(issueTouchesPath({}, 'eligibleCurrencies')).toBe(false)
    expect(issueTouchesPath({ path: 'eligibleCurrencies' }, 'eligibleCurrencies')).toBe(false)
  })
})
