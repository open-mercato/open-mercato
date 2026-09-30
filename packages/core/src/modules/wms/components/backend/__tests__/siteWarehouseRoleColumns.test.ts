import { sortSiteWarehouseRoleRows } from '../siteWarehouseRoleColumns'
import type { SiteWarehouseRoleRow } from '../SiteWarehouseRoleDialog'

function row(
  id: string,
  role: SiteWarehouseRoleRow['role'],
  isDefault: boolean,
  warehouse: Partial<SiteWarehouseRoleRow['warehouse']>,
): SiteWarehouseRoleRow {
  return {
    id,
    siteId: 'site-1',
    warehouseId: warehouse.id ?? id,
    role,
    isDefault,
    warehouse: {
      id: warehouse.id ?? id,
      code: warehouse.code ?? null,
      name: warehouse.name ?? null,
      isActive: true,
    },
    updatedAt: '2026-09-11T10:00:00.000Z',
  }
}

describe('sortSiteWarehouseRoleRows', () => {
  it('sorts a copied page by role, default status, displayed warehouse label, and stable ids', () => {
    const input = [
      row('4', 'shipping', false, { id: 'warehouse-4', name: 'Zulu' }),
      row('3', 'raw_material', false, { id: 'warehouse-3', code: 'BETA' }),
      row('2', 'raw_material', true, { id: 'warehouse-2', name: 'Zulu' }),
      row('1', 'raw_material', true, { id: 'warehouse-1', name: 'Alpha' }),
    ]

    expect(sortSiteWarehouseRoleRows(input).map((item) => item.id)).toEqual(['1', '2', '3', '4'])
    expect(input.map((item) => item.id)).toEqual(['4', '3', '2', '1'])
  })
})
