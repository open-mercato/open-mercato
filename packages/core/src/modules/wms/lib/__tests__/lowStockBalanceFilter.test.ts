/** @jest-environment node */

import { resolveLowStockVariantIds } from '../lowStockBalanceFilter'

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const warehouseId = '11111111-1111-4111-8111-111111111111'

function makeEm(rows: Array<{ catalog_variant_id: string }> = []) {
  const execute = jest.fn().mockResolvedValue(rows)
  const em = { getConnection: () => ({ execute }) } as never
  return { em, execute }
}

describe('resolveLowStockVariantIds', () => {
  it('resolves the effective profile per variant with a product-level fallback', async () => {
    const { em, execute } = makeEm([{ catalog_variant_id: '44444444-4444-4444-8444-444444444444' }])

    const variantIds = await resolveLowStockVariantIds(em, { organizationId, tenantId }, 'belowReorder')

    expect(variantIds).toEqual(['44444444-4444-4444-8444-444444444444'])
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('p.catalog_variant_id is not null')
    expect(sql).toContain('join catalog_product_variants v')
    expect(sql).toContain('profile.catalog_variant_id = availability.catalog_variant_id')
    expect(sql).toContain('profile.catalog_variant_id is null and profile.catalog_product_id = v.product_id')
    expect(sql).toContain('order by (profile.catalog_variant_id is null) asc')
    expect(sql).toContain('availability.available <= coalesce(p.reorder_point, 0)')
    expect(params).toEqual([organizationId, tenantId, organizationId, tenantId, organizationId, tenantId])
  })

  it('binds the warehouse filter before the variant and profile scope parameters', async () => {
    const { em, execute } = makeEm()

    const variantIds = await resolveLowStockVariantIds(
      em,
      { organizationId, tenantId, warehouseId },
      'belowSafety',
    )

    expect(variantIds).toEqual([])
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('and b.warehouse_id = ?')
    expect(sql).toContain('availability.available <= coalesce(p.safety_stock, 0)')
    expect(params).toEqual([
      organizationId,
      tenantId,
      warehouseId,
      organizationId,
      tenantId,
      organizationId,
      tenantId,
    ])
  })
})
