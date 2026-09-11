export const SITE_WAREHOUSE_ROLES = [
  'raw_material',
  'line_side',
  'wip',
  'finished_goods',
  'quarantine',
  'shipping',
] as const

export type SiteWarehouseRoleType = (typeof SITE_WAREHOUSE_ROLES)[number]
