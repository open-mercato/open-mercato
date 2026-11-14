import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { customerPurchaseApprovalWithdrawnReasonSchema } from '../data/validators'

const APPROVAL_ROUTES = [
  'api/portal/approvals/route.ts',
  'api/portal/approvals/[id]/route.ts',
  'api/customer-groups/approvals/route.ts',
  'api/customer-groups/approvals/[id]/route.ts',
]

describe('customer purchase approval withdrawn reason contract', () => {
  it('accepts every reason the service and entity can emit, including cart_converted_as_quote', () => {
    for (const reason of ['requester', 'cart_merged', 'cart_expired', 'cart_purged', 'cart_converted_as_quote']) {
      expect(customerPurchaseApprovalWithdrawnReasonSchema.safeParse(reason).success).toBe(true)
    }
    expect(customerPurchaseApprovalWithdrawnReasonSchema.safeParse('unknown').success).toBe(false)
  })

  it.each(APPROVAL_ROUTES)('%s derives its response withdrawnReason from the shared schema', (route) => {
    const source = readFileSync(join(__dirname, '..', route), 'utf8')
    expect(source).toContain('withdrawnReason: customerPurchaseApprovalWithdrawnReasonSchema.nullable()')
    expect(source).not.toContain("z.enum(['requester'")
  })
})
