import type { EntityManager } from '@mikro-orm/postgresql'
import { WarrantyClaimSettings } from '../data/entities'
import {
  externalClaimIntakeSchema,
  externalClaimLookupQuerySchema,
  portalIntakeInputSchema,
} from '../data/validators'
import { resolveEffectiveWarrantyClaimSettings } from '../lib/settings'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const ORDER_LINE_ID = '44444444-4444-4444-8444-444444444444'

function makeEntityManager(settings: WarrantyClaimSettings | null): EntityManager {
  const findOne = jest.fn<Promise<WarrantyClaimSettings | null>, [unknown, unknown]>()
  findOne.mockResolvedValue(settings)
  return { findOne } as unknown as EntityManager
}

function makeSettings(defaultWarrantyMonths: number | null): WarrantyClaimSettings {
  const settings = new WarrantyClaimSettings()
  settings.id = '55555555-5555-4555-8555-555555555555'
  settings.tenantId = TENANT_ID
  settings.organizationId = ORG_ID
  settings.defaultWarrantyMonths = defaultWarrantyMonths
  return settings
}

describe('warranty claims settings resolution and intake validation', () => {
  test('external claim intake accepts a valid order-number payload', () => {
    const parsed = externalClaimIntakeSchema.safeParse({
      externalRef: 'EXT-1001',
      orderNumber: 'SO-1001',
      lines: [
        {
          sku: 'PUMP-1',
          productName: 'Pump',
          faultDescription: 'Pump will not start',
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })

  test('external claim intake rejects missing external reference, empty lines, and unknown keys', () => {
    const validBase = {
      externalRef: 'EXT-1001',
      orderNumber: 'SO-1001',
      lines: [{ faultDescription: 'Pump will not start' }],
    }

    expect(externalClaimIntakeSchema.safeParse({ orderNumber: 'SO-1001', lines: validBase.lines }).success).toBe(false)
    expect(externalClaimIntakeSchema.safeParse({ ...validBase, lines: [] }).success).toBe(false)
    expect(externalClaimIntakeSchema.safeParse({ ...validBase, unexpected: true }).success).toBe(false)
  })

  test('external claim lookup requires at least one lookup key and accepts each single-key variant', () => {
    expect(externalClaimLookupQuerySchema.safeParse({}).success).toBe(false)
    expect(externalClaimLookupQuerySchema.safeParse({ id: CLAIM_ID }).success).toBe(true)
    expect(externalClaimLookupQuerySchema.safeParse({ claimNumber: 'WTY-000123' }).success).toBe(true)
    expect(externalClaimLookupQuerySchema.safeParse({ externalRef: 'EXT-1001' }).success).toBe(true)
  })

  test('effective settings default warranty months fall back to null without a row', async () => {
    const em = makeEntityManager(null)

    await expect(resolveEffectiveWarrantyClaimSettings(em, { tenantId: TENANT_ID, organizationId: ORG_ID }))
      .resolves
      .toMatchObject({ defaultWarrantyMonths: null })
  })

  test('effective settings return stored default warranty months', async () => {
    const em = makeEntityManager(makeSettings(24))

    await expect(resolveEffectiveWarrantyClaimSettings(em, { tenantId: TENANT_ID, organizationId: ORG_ID }))
      .resolves
      .toMatchObject({ defaultWarrantyMonths: 24 })
  })

  test('portal intake accepts product name snapshots with order line ids', () => {
    const parsed = portalIntakeInputSchema.safeParse({
      reasonCode: 'defective',
      lines: [
        {
          orderLineId: ORDER_LINE_ID,
          productName: 'Pump',
          faultDescription: 'Pump will not start',
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })
})
