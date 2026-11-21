import { parseScopedCommandInput, type ScopedContext } from '@open-mercato/shared/lib/api/scoped'
import { inventoryLotCreateSchema, inventoryLotUpdateSchema } from '../data/validators'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const lotId = '33333333-3333-4333-8333-333333333333'
const ctx = { auth: { tenantId, orgId: organizationId }, selectedOrganizationId: organizationId } as ScopedContext
const translate = (key: string, fallback?: string) => fallback ?? key

describe('lot write aliases', () => {
  it.each([inventoryLotCreateSchema, inventoryLotUpdateSchema])('preserves null lot dates through scoped parsing', (schema) => {
    const parsed = parseScopedCommandInput(schema, {
      id: lotId,
      catalogVariantId: lotId,
      sku: 'NULL-DATES',
      lotNumber: 'NULL-DATES',
      manufactured_at: null,
      best_before_at: null,
      expires_at: null,
      tenant_id: 'foreign-tenant',
      organization_id: 'foreign-org',
    }, ctx, translate)
    expect(parsed).toMatchObject({ manufacturedAt: null, bestBeforeAt: null, expiresAt: null, tenantId, organizationId })
  })

  it('still validates date ordering for non-null dates', () => {
    expect(() => parseScopedCommandInput(inventoryLotUpdateSchema, {
      id: lotId, manufactured_at: '2026-10-02', expires_at: '2026-10-01',
    }, ctx, translate)).toThrow()
  })
})
