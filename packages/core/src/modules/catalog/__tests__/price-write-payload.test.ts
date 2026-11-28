import { parseScopedCommandInput, type ScopedContext } from '@open-mercato/shared/lib/api/scoped'
import { priceCreateSchema, priceUpdateSchema } from '../data/validators'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const recordId = '33333333-3333-4333-8333-333333333333'
const ctx = { auth: { tenantId, orgId: organizationId }, selectedOrganizationId: organizationId } as ScopedContext
const translate = (key: string, fallback?: string) => fallback ?? key

describe('price write aliases', () => {
  it.each([priceCreateSchema, priceUpdateSchema])('preserves nullable validity dates through scoped parsing', (schema) => {
    const parsed = parseScopedCommandInput(schema, {
      id: recordId, productId: recordId, currencyCode: 'EUR', priceKindId: recordId,
      unitPriceNet: '10.00', starts_at: null, ends_at: null,
    }, ctx, translate)
    expect(parsed).toMatchObject({ startsAt: null, endsAt: null, tenantId, organizationId })
  })

  it('still rejects reversed validity windows', () => {
    expect(() => parseScopedCommandInput(priceUpdateSchema, {
      id: recordId, starts_at: '2026-10-02', ends_at: '2026-10-01',
    }, ctx, translate)).toThrow()
  })
})
