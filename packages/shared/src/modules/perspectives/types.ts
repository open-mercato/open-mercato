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
  createdAt: string
  updatedAt?: string | null
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
