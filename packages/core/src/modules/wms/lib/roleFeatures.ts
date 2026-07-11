/**
 * Reserved tenant role names seeded by WMS `setup.ts` via `ensureRoles`.
 * Other modules MUST NOT reuse `operator` or `supervisor` without coordinating ACL grants and i18n labels.
 */
export const WMS_OPERATOR_ROLE = 'operator' as const
export const WMS_SUPERVISOR_ROLE = 'supervisor' as const

export const WMS_CUSTOM_ROLE_NAMES = [WMS_OPERATOR_ROLE, WMS_SUPERVISOR_ROLE] as const

export const WMS_OPERATOR_FEATURES = [
  'wms.view',
  'wms.adjust_inventory',
  'wms.receive_inventory',
  'wms.cycle_count',
] as const

export const WMS_MANAGE_FEATURES = [
  'wms.manage_warehouses',
  'wms.manage_zones',
  'wms.manage_locations',
  'wms.manage_inventory',
  'wms.manage_reservations',
] as const

export const WMS_SUPERVISOR_FEATURES = [
  ...WMS_OPERATOR_FEATURES,
  'wms.import',
  ...WMS_MANAGE_FEATURES,
] as const

export type WmsOperatorFeature = (typeof WMS_OPERATOR_FEATURES)[number]
export type WmsSupervisorFeature = (typeof WMS_SUPERVISOR_FEATURES)[number]
