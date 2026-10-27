export type ManagerRecord = { userId: string; name: string | null; email: string | null }

export type FloorRow = {
  id: string | null
  number: number
  name: string
  sizeX: string
  sizeY: string
  spaceCount: number
  unitCount: number
}

export type BuildingRecord = {
  id: string
  name: string
  address: string
  status: string
  updatedAt: string | null
  floorCount: number
  floorsBelow: number
  floorsAbove: number
  spaceCount: number
  unitCount: number
  managers: ManagerRecord[]
  floors: FloorRow[]
}

export type BuildingListPayload = {
  items?: unknown[]
  total?: number
  totalPages?: number
  archivedCount?: number
  canManageAll?: boolean
  error?: string
}

export type BuildingUsage = {
  floorCount: number
  spaceCount: number
  unitCount: number
  commonAreaCount: number
  everUsed: boolean
  canDelete: boolean
  canArchive: boolean
  blockers: Array<{ kind: 'lease' | 'booking'; id: string; label: string; unitId: string; until: string | null }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length && Number.isFinite(Number(value))) return Number(value)
  return 0
}

function normalizeManager(value: unknown): ManagerRecord | null {
  if (!isRecord(value)) return null
  const userId = readString(value.userId)
  if (!userId) return null
  return { userId, name: readString(value.name), email: readString(value.email) }
}

function normalizeFloor(value: unknown): FloorRow | null {
  if (!isRecord(value)) return null
  return {
    id: readString(value.id),
    number: readNumber(value.number),
    name: readString(value.name) ?? '',
    sizeX: String(readNumber(value.sizeX)),
    sizeY: String(readNumber(value.sizeY)),
    spaceCount: readNumber(value.spaceCount),
    unitCount: readNumber(value.unitCount),
  }
}

export function normalizeBuilding(value: unknown): BuildingRecord | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  if (!id) return null
  const managers = Array.isArray(value.managers) ? value.managers.map(normalizeManager).filter((item): item is ManagerRecord => item !== null) : []
  const floors = Array.isArray(value.floors) ? value.floors.map(normalizeFloor).filter((item): item is FloorRow => item !== null) : []
  return {
    id,
    name: readString(value.name) ?? '',
    address: readString(value.address) ?? '',
    status: readString(value.status) ?? 'active',
    updatedAt: readString(value.updatedAt),
    floorCount: readNumber(value.floorCount),
    floorsBelow: readNumber(value.floorsBelow),
    floorsAbove: readNumber(value.floorsAbove),
    spaceCount: readNumber(value.spaceCount),
    unitCount: readNumber(value.unitCount),
    managers,
    floors: floors.sort((left, right) => left.number - right.number),
  }
}

export function managerLabel(manager: ManagerRecord): string {
  return manager.name?.trim() || manager.email?.trim() || manager.userId
}
