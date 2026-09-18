import { firstTranslatableIssueKey } from '../api/return-label/route'
import { claimSetReturnLabelSchema } from '../data/validators'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'

describe('firstTranslatableIssueKey — return-label route surfaces the keyed message (#5287)', () => {
  it('selects the keyed return-label URL message when the URL is invalid', () => {
    const result = claimSetReturnLabelSchema.safeParse({ ...scope, id: CLAIM_ID, labelUrl: 'not a url' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(firstTranslatableIssueKey(result.error)).toBe('warranty_claims.errors.returnLabelUrlInvalid')
    }
  })

  it('falls back to the generic invalidInput key when no issue carries a translation key', () => {
    // No label fields at all -> the (intentionally unkeyed) "at least one field" refine is the sole issue.
    const result = claimSetReturnLabelSchema.safeParse({ ...scope, id: CLAIM_ID })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(firstTranslatableIssueKey(result.error)).toBe('warranty_claims.errors.invalidInput')
    }
  })
})
