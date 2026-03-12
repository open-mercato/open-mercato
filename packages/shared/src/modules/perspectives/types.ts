export type PerspectiveSettings = {
  columnOrder?: string[]
  columnVisibility?: Record<string, boolean>
  filters?: Record<string, unknown>
  sorting?: Array<{ id: string; desc?: boolean }>
  pageSize?: number
  searchValue?: string
}

export type PerspectiveDto = {
  id: string
  name: string
  tableId: string
  settings: PerspectiveSettings
  isDefault: boolean
  isShared?: boolean
  createdAt: string
  updatedAt?: string | null
}

/**
 * A saved view is a named perspective used as a reusable filter/sort/column preset
 * for any DataTable. Any module can use saved views by storing perspectives with
 * a stable `tableId` (e.g., `customers:deal`, `sales:order`).
 */
export type SavedViewDto = {
  id: string
  name: string
  tableId: string
  filters: Record<string, unknown>
  sortField?: string | null
  sortDir?: 'asc' | 'desc' | null
  columns?: string[] | null
  isDefault: boolean
  isShared: boolean
  userId: string
  createdAt: string
  updatedAt?: string | null
}

export type SavedViewsResponse = {
  items: SavedViewDto[]
  total: number
}

export type RolePerspectiveDto = PerspectiveDto & {
  roleId: string
  tenantId: string | null
  organizationId: string | null
  roleName?: string | null
}

export type PerspectivesIndexResponse = {
  tableId: string
  perspectives: PerspectiveDto[]
  shared: PerspectiveDto[]
  defaultPerspectiveId: string | null
  rolePerspectives: RolePerspectiveDto[]
  roles: Array<{ id: string; name: string; hasPerspective: boolean; hasDefault: boolean }>
  canApplyToRoles: boolean
}

export type PerspectiveSaveResponse = {
  perspective: PerspectiveDto
  rolePerspectives: RolePerspectiveDto[]
  clearedRoleIds: string[]
}
