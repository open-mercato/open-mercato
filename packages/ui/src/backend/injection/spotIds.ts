import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'

export const BACKEND_RECORD_CURRENT_INJECTION_SPOT_ID: InjectionSpotId = 'backend:record:current'
export const BACKEND_LAYOUT_TOP_INJECTION_SPOT_ID: InjectionSpotId = 'backend:layout:top'
export const BACKEND_LAYOUT_FOOTER_INJECTION_SPOT_ID: InjectionSpotId = 'backend:layout:footer'
export const BACKEND_SIDEBAR_TOP_INJECTION_SPOT_ID: InjectionSpotId = 'backend:sidebar:top'
export const BACKEND_SIDEBAR_FOOTER_INJECTION_SPOT_ID: InjectionSpotId = 'backend:sidebar:footer'

// Standardized backend chrome spot ids
export const BACKEND_TOPBAR_PROFILE_MENU_INJECTION_SPOT_ID: InjectionSpotId = 'backend:topbar:profile-menu'
export const BACKEND_TOPBAR_ACTIONS_INJECTION_SPOT_ID: InjectionSpotId = 'backend:topbar:actions'
export const BACKEND_SIDEBAR_NAV_INJECTION_SPOT_ID: InjectionSpotId = 'backend:sidebar:nav'
export const BACKEND_SIDEBAR_NAV_FOOTER_INJECTION_SPOT_ID: InjectionSpotId = 'backend:sidebar:nav:footer'

// Standardized global status spot ids
export const GLOBAL_SIDEBAR_STATUS_BADGES_INJECTION_SPOT_ID: InjectionSpotId = 'global:sidebar:status-badges'
export const GLOBAL_HEADER_STATUS_INDICATORS_INJECTION_SPOT_ID: InjectionSpotId = 'global:header:status-indicators'

// Standardized pattern helpers
export const CrudFormInjectionSpots = {
  base: (entityId: string): InjectionSpotId => `crud-form:${entityId}`,
  beforeFields: (entityId: string): InjectionSpotId => `crud-form:${entityId}:before-fields`,
  afterFields: (entityId: string): InjectionSpotId => `crud-form:${entityId}:after-fields`,
  header: (entityId: string): InjectionSpotId => `crud-form:${entityId}:header`,
  footer: (entityId: string): InjectionSpotId => `crud-form:${entityId}:footer`,
  sidebar: (entityId: string): InjectionSpotId => `crud-form:${entityId}:sidebar`,
  group: (entityId: string, groupId: string): InjectionSpotId => `crud-form:${entityId}:group:${groupId}`,
  fieldBefore: (entityId: string, fieldId: string): InjectionSpotId => `crud-form:${entityId}:field:${fieldId}:before`,
  fieldAfter: (entityId: string, fieldId: string): InjectionSpotId => `crud-form:${entityId}:field:${fieldId}:after`,
} as const

export const DataTableInjectionSpots = {
  header: (tableId: string): InjectionSpotId => `data-table:${tableId}:header`,
  footer: (tableId: string): InjectionSpotId => `data-table:${tableId}:footer`,
  toolbar: (tableId: string): InjectionSpotId => `data-table:${tableId}:toolbar`,
  emptyState: (tableId: string): InjectionSpotId => `data-table:${tableId}:empty-state`,
  columns: (tableId: string): InjectionSpotId => `data-table:${tableId}:columns`,
  rowActions: (tableId: string): InjectionSpotId => `data-table:${tableId}:row-actions`,
  bulkActions: (tableId: string): InjectionSpotId => `data-table:${tableId}:bulk-actions`,
  filters: (tableId: string): InjectionSpotId => `data-table:${tableId}:filters`,
} as const

export const DetailInjectionSpots = {
  header: (entityId: string): InjectionSpotId => `detail:${entityId}:header`,
  tabs: (entityId: string): InjectionSpotId => `detail:${entityId}:tabs`,
  sidebar: (entityId: string): InjectionSpotId => `detail:${entityId}:sidebar`,
  footer: (entityId: string): InjectionSpotId => `detail:${entityId}:footer`,
  statusBadges: (entityId: string): InjectionSpotId => `detail:${entityId}:status-badges`,
} as const
