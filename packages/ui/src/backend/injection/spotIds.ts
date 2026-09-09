import type { InjectionSpotId } from '@open-mercato/shared/modules/widgets/injection'
import {
  crudFormExtensionSpotId,
  dataTableExtensionSpotId,
} from '@open-mercato/shared/modules/widgets/extension-points'

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
  base: (entityId: string): InjectionSpotId => crudFormExtensionSpotId(entityId),
  beforeFields: (entityId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, 'before-fields'),
  afterFields: (entityId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, 'after-fields'),
  header: (entityId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, 'header'),
  fields: (entityId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, 'fields'),
  footer: (entityId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, 'footer'),
  sidebar: (entityId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, 'sidebar'),
  group: (entityId: string, groupId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, `group:${groupId}`),
  fieldBefore: (entityId: string, fieldId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, `field:${fieldId}:before`),
  fieldAfter: (entityId: string, fieldId: string): InjectionSpotId => crudFormExtensionSpotId(entityId, `field:${fieldId}:after`),
} as const

export const DataTableInjectionSpots = {
  header: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'header'),
  footer: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'footer'),
  toolbar: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'toolbar'),
  // Slot rendered immediately after the search input on the same row as the
  // FilterBar — intended for compact, icon-sized triggers (AI assistants,
  // saved view shortcuts, etc.). Hosts pass the resolved spot ID through to
  // FilterBar's `searchTrailing` prop. Stays empty when the table has no
  // search input.
  searchTrailing: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'search-trailing'),
  emptyState: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'empty-state'),
  columns: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'columns'),
  rowActions: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'row-actions'),
  bulkActions: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'bulk-actions'),
  filters: (tableId: string): InjectionSpotId => dataTableExtensionSpotId(tableId, 'filters'),
} as const

// Portal chrome spot IDs (FROZEN once shipped)
export const PORTAL_SIDEBAR_MAIN_INJECTION_SPOT_ID: InjectionSpotId = 'menu:portal:sidebar:main'
export const PORTAL_SIDEBAR_ACCOUNT_INJECTION_SPOT_ID: InjectionSpotId = 'menu:portal:sidebar:account'
export const PORTAL_HEADER_ACTIONS_INJECTION_SPOT_ID: InjectionSpotId = 'menu:portal:header:actions'
export const PORTAL_USER_DROPDOWN_INJECTION_SPOT_ID: InjectionSpotId = 'menu:portal:user-dropdown'

// Portal page injection spots (FROZEN once shipped)
export const PortalInjectionSpots = {
  dashboardSections: 'portal:dashboard:sections' as InjectionSpotId,
  dashboardProfile: 'portal:dashboard:profile' as InjectionSpotId,
  dashboardSidebar: 'portal:dashboard:sidebar' as InjectionSpotId,
  pageBefore: (pageId: string): InjectionSpotId => `portal:${pageId}:before` as InjectionSpotId,
  pageAfter: (pageId: string): InjectionSpotId => `portal:${pageId}:after` as InjectionSpotId,
} as const

export const DetailInjectionSpots = {
  header: (entityId: string): InjectionSpotId => `detail:${entityId}:header`,
  tabs: (entityId: string): InjectionSpotId => `detail:${entityId}:tabs`,
  sidebar: (entityId: string): InjectionSpotId => `detail:${entityId}:sidebar`,
  footer: (entityId: string): InjectionSpotId => `detail:${entityId}:footer`,
  statusBadges: (entityId: string): InjectionSpotId => `detail:${entityId}:status-badges`,
} as const
