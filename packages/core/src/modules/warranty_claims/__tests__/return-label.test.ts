import type { WarrantyClaim, WarrantyClaimLine } from '../data/entities'
import { claimSetReturnLabelSchema } from '../data/validators'
import { createWarrantyReturnLabelProvider } from '../services/returnLabelProvider'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'

describe('warranty return labels', () => {
  test('default provider returns notConfigured', async () => {
    const provider = createWarrantyReturnLabelProvider()
    const container = {
      resolve: <R = unknown>(_name: string): R => {
        throw new Error('missing service')
      },
    }

    await expect(provider.createReturnLabel(
      { claim: {} as WarrantyClaim, lines: [] as WarrantyClaimLine[] },
      { tenantId: TENANT_ID, organizationId: ORG_ID },
      container,
    )).resolves.toEqual({ status: 'notConfigured' })
  })

  test('set_return_label schema requires at least one label field', () => {
    const scoped = { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

    expect(claimSetReturnLabelSchema.safeParse(scoped).success).toBe(false)
    expect(claimSetReturnLabelSchema.safeParse({
      ...scoped,
      trackingNumber: 'RMA-TRACK-1',
    }).success).toBe(true)
    expect(claimSetReturnLabelSchema.safeParse({
      ...scoped,
      labelUrl: '   ',
    }).success).toBe(false)
  })

  test('set_return_label schema only accepts http(s) label URLs', () => {
    const scoped = { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID }

    expect(claimSetReturnLabelSchema.safeParse({
      ...scoped,
      labelUrl: 'https://labels.example.com/label.pdf',
    }).success).toBe(true)
    expect(claimSetReturnLabelSchema.safeParse({
      ...scoped,
      labelUrl: 'javascript:alert(1)',
    }).success).toBe(false)
    expect(claimSetReturnLabelSchema.safeParse({
      ...scoped,
      labelUrl: 'data:text/html;base64,PGgxPjwvaDE+',
    }).success).toBe(false)
    expect(claimSetReturnLabelSchema.safeParse({
      ...scoped,
      labelUrl: 'labels.example.com/label.pdf',
    }).success).toBe(false)
  })
})
