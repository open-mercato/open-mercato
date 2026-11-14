// Step 8.7 (QA F3): `RuleTreeBuilder.tsx`'s `handleSave` used to flash the same generic
// "Could not save the rule tree" message for every failed `PUT /api/promotions/[id]/tree`,
// silently dropping the 422 response's `issues[]` array (one entry per zod issue:
// `{ path, message }`). This pins the two pure helpers that now read that array off the
// caught error — `extractTreeValidationIssues` and `issueTouchesPath` — so a future
// refactor of the error shape (or of `handleSave`'s `Object.assign` call) cannot silently
// regress back to the generic-only flash.

import { extractTreeValidationIssues, issueTouchesPath } from '../RuleTreeBuilder'

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
