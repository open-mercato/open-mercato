import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  buildQuery,
  loadCatalogVariantOptions,
  loadWarehouseOptions,
} from './wmsLookupLoaders'

export { buildQuery, loadCatalogVariantOptions, loadWarehouseOptions }

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

type InventoryLotListRow = {
  id?: string | null
  lot_number?: string | null
  expires_at?: string | null
}

async function loadCrudOptionsByIds<T>(
  endpoint: string,
  ids: string[],
  mapItem: (item: T) => CrudFieldOption | null,
): Promise<CrudFieldOption[]> {
  const normalizedIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (normalizedIds.length === 0) return []
  const params = buildQuery({
    page: 1,
    pageSize: normalizedIds.length,
    ids: normalizedIds.join(','),
  })
  const call = await apiCall<PagedResponse<T>>(`${endpoint}?${params}`)
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map(mapItem)
    .filter((option): option is CrudFieldOption => option !== null)
}

export async function resolveCatalogVariantLabel(catalogVariantId: string): Promise<string | null> {
  const id = catalogVariantId.trim()
  if (!id) return null
  const params = buildQuery({ page: 1, pageSize: 1, id })
  const call = await apiCall<PagedResponse<{ id?: string | null; name?: string | null; sku?: string | null }>>(
    `/api/catalog/variants?${params}`,
  )
  if (!call.ok) return null
  const item = call.result?.items?.[0]
  if (!item) return null
  return item.sku?.trim() || item.name?.trim() || id
}

export async function resolveWarehouseLabel(warehouseId: string): Promise<string | null> {
  const [option] = await loadCrudOptionsByIds<{ id?: string | null; name?: string | null; code?: string | null }>(
    '/api/wms/warehouses',
    [warehouseId],
    (item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      return { value, label: item.name || item.code || value }
    },
  )
  return option?.label ?? null
}

export async function resolveLocationLabel(locationId: string): Promise<string | null> {
  const [option] = await loadCrudOptionsByIds<{ id?: string | null; code?: string | null }>(
    '/api/wms/locations',
    [locationId],
    (item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      return { value, label: item.code || value }
    },
  )
  return option?.label ?? null
}

export async function resolveLotLabel(lotId: string): Promise<string | null> {
  const [option] = await loadCrudOptionsByIds<InventoryLotListRow>(
    '/api/wms/lots',
    [lotId],
    (item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const lotNumber = item.lot_number?.trim() || value
      const expiresAt = item.expires_at?.trim()
      const label = expiresAt ? `${lotNumber} · exp ${expiresAt.slice(0, 10)}` : lotNumber
      return { value, label }
    },
  )
  return option?.label ?? null
}

export async function resolveLotNumberFromId(lotId: string): Promise<string | null> {
  const [option] = await loadCrudOptionsByIds<InventoryLotListRow>(
    '/api/wms/lots',
    [lotId],
    (item) => {
      const value = typeof item.id === 'string' ? item.id : null
      const lotNumber = item.lot_number?.trim()
      if (!value || !lotNumber) return null
      return { value, label: lotNumber }
    },
  )
  return option?.label ?? null
}

export async function resolveCatalogVariantSku(catalogVariantId: string): Promise<string | null> {
  const id = catalogVariantId.trim()
  if (!id) return null
  const params = buildQuery({ page: 1, pageSize: 1, id })
  const call = await apiCall<PagedResponse<{ id?: string | null; sku?: string | null }>>(
    `/api/catalog/variants?${params}`,
  )
  if (!call.ok) return null
  const sku = call.result?.items?.[0]?.sku?.trim()
  return sku || null
}

type InventoryProfileListRow = {
  track_lot?: boolean | null
  track_serial?: boolean | null
}

export async function loadInventoryProfileForVariant(
  catalogVariantId: string,
): Promise<InventoryProfileListRow | null> {
  const variantId = catalogVariantId.trim()
  if (!variantId) return null
  const params = buildQuery({ page: 1, pageSize: 1, catalogVariantId: variantId })
  const call = await apiCall<PagedResponse<InventoryProfileListRow>>(
    `/api/wms/inventory-profiles?${params}`,
  )
  if (!call.ok) return null
  return call.result?.items?.[0] ?? null
}

export async function findLotIdByNumber(
  catalogVariantId: string,
  lotNumber: string,
): Promise<string | null> {
  const variantId = catalogVariantId.trim()
  const normalizedLotNumber = lotNumber.trim()
  if (!variantId || !normalizedLotNumber) return null

  const params = buildQuery({
    page: 1,
    pageSize: 20,
    catalogVariantId: variantId,
    search: normalizedLotNumber,
  })
  const call = await apiCall<PagedResponse<InventoryLotListRow>>(`/api/wms/lots?${params}`)
  if (!call.ok) return null

  const match = (call.result?.items ?? []).find(
    (item) => item.lot_number?.trim().toLowerCase() === normalizedLotNumber.toLowerCase(),
  )
  return typeof match?.id === 'string' ? match.id : null
}

export class InventoryLotMutationError extends Error {
  constructor(message = 'Failed to resolve inventory lot.') {
    super(message)
    this.name = 'InventoryLotMutationError'
  }
}

export async function ensureLotIdForInventoryMutation(input: {
  catalogVariantId: string
  lotNumber: string
  organizationId: string
  tenantId: string
}): Promise<string> {
  const lotNumber = input.lotNumber.trim()
  if (!lotNumber) {
    throw new InventoryLotMutationError('Lot number is required.')
  }

  const existingId = await findLotIdByNumber(input.catalogVariantId, lotNumber)
  if (existingId) return existingId

  const sku = await resolveCatalogVariantSku(input.catalogVariantId)
  if (!sku) {
    throw new InventoryLotMutationError('Could not resolve SKU for the selected variant.')
  }

  const call = await apiCall<{ id?: string | null }>('/api/wms/lots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      catalogVariantId: input.catalogVariantId,
      sku,
      lotNumber,
      status: 'available',
    }),
  })

  if (!call.ok) {
    const racedId = await findLotIdByNumber(input.catalogVariantId, lotNumber)
    if (racedId) return racedId
    throw new InventoryLotMutationError('Failed to create inventory lot.')
  }

  const createdId = call.result?.id?.trim()
  if (createdId) return createdId

  const resolvedId = await findLotIdByNumber(input.catalogVariantId, lotNumber)
  if (resolvedId) return resolvedId

  throw new InventoryLotMutationError('Failed to resolve created inventory lot.')
}

type LocationListRow = {
  id?: string | null
  code?: string | null
  type?: string | null
}

type ZoneListRow = {
  id?: string | null
  name?: string | null
  code?: string | null
  warehouse_id?: string | null
  warehouseId?: string | null
}

export type ZoneCrudFieldOption = CrudFieldOption & {
  warehouseId?: string
}

function readZoneWarehouseId(item: ZoneListRow): string | null {
  if (typeof item.warehouse_id === 'string' && item.warehouse_id.trim()) {
    return item.warehouse_id.trim()
  }
  if (typeof item.warehouseId === 'string' && item.warehouseId.trim()) {
    return item.warehouseId.trim()
  }
  return null
}

type AuthUserListRow = {
  id?: string | null
  email?: string | null
  roles?: string[] | null
}

export type AssigneeOptionsResult = {
  options: CrudFieldOption[]
  canListUsers: boolean
}

export type BalanceLookupErrorCode = 'LOOKUP_FAILED' | 'LOT_REQUIRED' | 'LOT_NOT_FOUND'

export class BalanceLookupError extends Error {
  code: BalanceLookupErrorCode

  constructor(message = 'Failed to load inventory balance.', code: BalanceLookupErrorCode = 'LOOKUP_FAILED') {
    super(message)
    this.name = 'BalanceLookupError'
    this.code = code
  }
}

export class ScopeEstimateError extends Error {
  constructor(message = 'Failed to estimate cycle count scope.') {
    super(message)
    this.name = 'ScopeEstimateError'
  }
}

function compareLocationCodes(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function isLocationCodeWithinRange(
  code: string,
  fromCode?: string | null,
  toCode?: string | null,
): boolean {
  const from = fromCode?.trim()
  const to = toCode?.trim()
  if (from && compareLocationCodes(code, from) < 0) return false
  if (to && compareLocationCodes(code, to) > 0) return false
  return true
}

export function formatCycleCountZoneLabel(
  baseLabel: string,
  stats?: { expectedSkus: number; binCount: number },
): string {
  const trimmed = baseLabel.trim()
  if (!trimmed || !stats) return trimmed
  return `${trimmed} · ${stats.expectedSkus} SKUs · ${stats.binCount} bins`
}

export function mapLocationOptions(items: LocationListRow[]): CrudFieldOption[] {
  return items
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const label = item.code || value
      return { value, label }
    })
    .filter((option): option is CrudFieldOption => option !== null)
}

export async function loadAllLocations(
  warehouseId: string,
  filters: { type?: string; search?: string },
): Promise<LocationListRow[]> {
  const items: LocationListRow[] = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages && page <= 10) {
    const params = buildQuery({
      page,
      pageSize: 100,
      warehouseId,
      type: filters.type,
      search: filters.search?.trim() || undefined,
    })
    const call = await apiCall<PagedResponse<LocationListRow>>(`/api/wms/locations?${params}`)
    if (!call.ok) break
    items.push(...(call.result?.items ?? []))
    totalPages = call.result?.totalPages ?? 1
    page += 1
  }

  return items
}

export function filterLocationsByCodeRange(
  locations: LocationListRow[],
  fromCode?: string | null,
  toCode?: string | null,
): LocationListRow[] {
  const from = fromCode?.trim()
  const to = toCode?.trim()
  if (!from && !to) return locations
  return locations.filter((location) => {
    const code = location.code?.trim()
    if (!code) return false
    return isLocationCodeWithinRange(code, from, to)
  })
}

async function loadLocationPage(
  warehouseId: string,
  filters: { type?: string; search?: string; page?: number; pageSize?: number },
): Promise<PagedResponse<LocationListRow>> {
  const params = buildQuery({
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 50,
    warehouseId,
    type: filters.type,
    search: filters.search?.trim() || undefined,
  })
  const call = await apiCall<PagedResponse<LocationListRow>>(`/api/wms/locations?${params}`)
  if (!call.ok) {
    throw new BalanceLookupError('Failed to load warehouse locations.')
  }
  return call.result ?? { items: [], total: 0, totalPages: 0 }
}

export async function loadLocationOptions(
  warehouseId: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  if (!warehouseId) return []
  try {
    const page = await loadLocationPage(warehouseId, { search: query })
    return mapLocationOptions(page.items ?? [])
  } catch {
    return []
  }
}

export async function loadBinLocationOptions(
  warehouseId: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  if (!warehouseId) return []
  try {
    const page = await loadLocationPage(warehouseId, { type: 'bin', search: query })
    return mapLocationOptions(page.items ?? [])
  } catch {
    return []
  }
}

export async function loadZoneOptions(
  warehouseId: string,
  query?: string,
): Promise<ZoneCrudFieldOption[]> {
  const scopedWarehouseId = warehouseId.trim()
  if (!scopedWarehouseId) return []
  const params = buildQuery({
    page: 1,
    pageSize: 50,
    warehouseId: scopedWarehouseId,
    search: query?.trim() || undefined,
  })
  const call = await apiCall<PagedResponse<ZoneListRow>>(`/api/wms/zones?${params}`)
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const label = item.name?.trim() || item.code?.trim() || value
      const zoneWarehouseId = readZoneWarehouseId(item)
      return {
        value,
        label,
        ...(zoneWarehouseId ? { warehouseId: zoneWarehouseId } : {}),
      }
    })
    .filter((option): option is ZoneCrudFieldOption => option !== null)
}

export async function resolveZoneLabel(zoneId: string): Promise<string | null> {
  const [option] = await loadCrudOptionsByIds<ZoneListRow>(
    '/api/wms/zones',
    [zoneId],
    (item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      return { value, label: item.name?.trim() || item.code?.trim() || value }
    },
  )
  return option?.label ?? null
}

export async function resolveZoneWarehouseId(zoneId: string): Promise<string | null> {
  const id = zoneId.trim()
  if (!id) return null
  const [option] = await loadCrudOptionsByIds<ZoneListRow>(
    '/api/wms/zones',
    [id],
    (item) => {
      const value = typeof item.id === 'string' ? item.id : null
      const warehouseId = readZoneWarehouseId(item)
      if (!value || !warehouseId) return null
      return { value, label: warehouseId }
    },
  )
  return option?.label ?? null
}

export async function loadAssigneeOptions(
  query?: string,
  fallback?: { userId: string; label: string },
): Promise<AssigneeOptionsResult> {
  const fallbackUserId = fallback?.userId.trim()
  const fallbackLabel = fallback?.label.trim()
  const fallbackOption =
    fallbackUserId && fallbackLabel
      ? [{ value: fallbackUserId, label: fallbackLabel }]
      : []

  const params = buildQuery({
    page: 1,
    pageSize: 50,
    search: query?.trim() || undefined,
  })
  const call = await apiCall<PagedResponse<AuthUserListRow>>(`/api/auth/users?${params}`)
  if (!call.ok) {
    return {
      options: fallbackOption,
      canListUsers: false,
    }
  }

  const options = (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const email = item.email?.trim() || value
      const role = item.roles?.find((entry) => entry.trim().length > 0)?.trim()
      const label = role ? `${email} (${role})` : email
      return { value, label }
    })
    .filter((option): option is CrudFieldOption => option !== null)

  return {
    options,
    canListUsers: true,
  }
}

export async function resolveAssigneeLabel(userId: string): Promise<string | null> {
  const params = buildQuery({ page: 1, pageSize: 1, id: userId.trim() })
  const call = await apiCall<PagedResponse<AuthUserListRow>>(`/api/auth/users?${params}`)
  if (!call.ok) return null
  const item = call.result?.items?.[0]
  if (!item?.id) return null
  const email = item.email?.trim() || item.id
  const role = item.roles?.find((entry) => entry.trim().length > 0)?.trim()
  return role ? `${email} (${role})` : email
}

export async function fetchCycleCountScopeEstimate(input: {
  warehouseId: string
  fromLocationId?: string | null
  toLocationId?: string | null
}): Promise<{ expectedSkus: number; binCount: number }> {
  const warehouseId = input.warehouseId.trim()
  if (!warehouseId) return { expectedSkus: 0, binCount: 0 }

  const bins = await loadAllLocations(warehouseId, { type: 'bin' })
  const locationById = new Map(
    bins
      .map((location) => {
        const id = location.id?.trim()
        return id ? [id, location] as const : null
      })
      .filter((entry): entry is readonly [string, LocationListRow] => entry !== null),
  )

  const fromCode = input.fromLocationId ? locationById.get(input.fromLocationId.trim())?.code : undefined
  const toCode = input.toLocationId ? locationById.get(input.toLocationId.trim())?.code : undefined
  const scopedBins = filterLocationsByCodeRange(bins, fromCode, toCode)
  const scopedBinIds = new Set(
    scopedBins.map((location) => location.id?.trim()).filter((id): id is string => Boolean(id)),
  )
  const binCount = scopedBinIds.size

  const variantIds = new Set<string>()
  let page = 1
  let totalPages = 1

  while (page <= totalPages && page <= 10) {
    const params = buildQuery({
      page,
      pageSize: 100,
      warehouseId,
    })
    const call = await apiCall<PagedResponse<{ catalog_variant_id?: string | null; location_id?: string | null; quantity_on_hand?: string | number | null }>>(
      `/api/wms/inventory/balances?${params}`,
    )
    if (!call.ok) {
      throw new ScopeEstimateError()
    }

    for (const row of call.result?.items ?? []) {
      const locationId = row.location_id?.trim()
      const variantId = row.catalog_variant_id?.trim()
      const onHand = Number(row.quantity_on_hand ?? 0)
      if (!locationId || !variantId || !Number.isFinite(onHand) || onHand <= 0) continue
      if (scopedBinIds.size > 0 && !scopedBinIds.has(locationId)) continue
      variantIds.add(variantId)
    }

    totalPages = call.result?.totalPages ?? 1
    page += 1
  }

  return { expectedSkus: variantIds.size, binCount }
}

export type InventoryBalanceLookupRow = {
  lot_id?: string | null
  quantity_on_hand?: string | number | null
  quantity_available?: number | null
}

function normalizeBalanceLotId(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function readBalanceAvailable(row: InventoryBalanceLookupRow): number {
  const available = Number(row.quantity_available ?? row.quantity_on_hand ?? 0)
  return Number.isFinite(available) ? available : 0
}

function selectBalanceLookupRow(
  items: InventoryBalanceLookupRow[],
  lotId?: string | null,
): InventoryBalanceLookupRow | null {
  if (items.length === 0) return null
  if (items.length === 1) return items[0]

  const normalizedLotId = normalizeBalanceLotId(lotId)
  if (normalizedLotId) {
    const exactMatch = items.find(
      (row) => normalizeBalanceLotId(row.lot_id) === normalizedLotId,
    )
    if (exactMatch) return exactMatch
    throw new BalanceLookupError('No balance bucket matches the selected lot.', 'LOT_NOT_FOUND')
  }

  const withoutLot = items.filter((row) => !normalizeBalanceLotId(row.lot_id))
  if (withoutLot.length === 1) return withoutLot[0]

  throw new BalanceLookupError(
    'Multiple balance buckets match this location; specify a lot.',
    'LOT_REQUIRED',
  )
}

export async function fetchBalanceAvailable(input: {
  warehouseId: string
  locationId: string
  catalogVariantId: string
  lotId?: string | null
}): Promise<number> {
  const params = buildQuery({
    page: 1,
    pageSize: 20,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    catalogVariantId: input.catalogVariantId,
    lotId: input.lotId?.trim() || undefined,
  })
  const call = await apiCall<PagedResponse<InventoryBalanceLookupRow>>(
    `/api/wms/inventory/balances?${params}`,
  )
  if (!call.ok) {
    throw new BalanceLookupError()
  }
  const row = selectBalanceLookupRow(call.result?.items ?? [], input.lotId)
  if (!row) return 0
  return readBalanceAvailable(row)
}

function mapInventoryLotListRowToOption(item: InventoryLotListRow): CrudFieldOption | null {
  const value = typeof item.id === 'string' ? item.id : null
  if (!value) return null
  const lotNumber = item.lot_number?.trim() || value
  const expiresAt = item.expires_at?.trim()
  const label = expiresAt ? `${lotNumber} · exp ${expiresAt.slice(0, 10)}` : lotNumber
  return { value, label }
}

function mapInventoryLotListRowToLotNumberOption(item: InventoryLotListRow): CrudFieldOption | null {
  const lotNumber = item.lot_number?.trim()
  if (!lotNumber) return null
  const expiresAt = item.expires_at?.trim()
  const label = expiresAt ? `${lotNumber} · exp ${expiresAt.slice(0, 10)}` : lotNumber
  return { value: lotNumber, label }
}

async function loadInventoryLotListOptions(
  catalogVariantId: string,
  query: string | undefined,
  mapItem: (item: InventoryLotListRow) => CrudFieldOption | null,
): Promise<CrudFieldOption[]> {
  if (!catalogVariantId) return []
  const params = buildQuery({
    page: 1,
    pageSize: 50,
    catalogVariantId,
    status: 'available',
    search: query?.trim() || undefined,
  })
  const call = await apiCall<PagedResponse<InventoryLotListRow>>(`/api/wms/lots?${params}`)
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map(mapItem)
    .filter((option): option is CrudFieldOption => option !== null)
}

export async function loadLotOptions(
  catalogVariantId: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  return loadInventoryLotListOptions(catalogVariantId, query, mapInventoryLotListRowToOption)
}

export async function loadLotNumberOptions(
  catalogVariantId: string,
  query?: string,
): Promise<CrudFieldOption[]> {
  return loadInventoryLotListOptions(catalogVariantId, query, mapInventoryLotListRowToLotNumberOption)
}

export class ScopeQueueError extends Error {
  constructor(message = 'Failed to build cycle count scope queue.') {
    super(message)
    this.name = 'ScopeQueueError'
  }
}

export type ScopeQueueItem = {
  locationId: string
  locationCode: string
  catalogVariantId: string
  lotId: string | null
  expectedOnHand: number
}

export async function buildCycleCountScopeQueue(input: {
  warehouseId: string
  fromLocationId?: string | null
  toLocationId?: string | null
}): Promise<ScopeQueueItem[]> {
  const warehouseId = input.warehouseId.trim()
  if (!warehouseId) return []

  const bins = await loadAllLocations(warehouseId, { type: 'bin' })
  const binById = new Map(
    bins
      .map((b) => {
        const id = b.id?.trim()
        return id ? ([id, b] as const) : null
      })
      .filter((entry): entry is readonly [string, LocationListRow] => entry !== null),
  )

  const fromCode = input.fromLocationId?.trim()
    ? binById.get(input.fromLocationId.trim())?.code
    : undefined
  const toCode = input.toLocationId?.trim()
    ? binById.get(input.toLocationId.trim())?.code
    : undefined

  const scopedBins = filterLocationsByCodeRange(bins, fromCode, toCode)
  const scopedBinIds = new Set(
    scopedBins.map((b) => b.id?.trim()).filter((id): id is string => Boolean(id)),
  )

  if (scopedBinIds.size === 0) return []

  type BalanceRow = {
    catalog_variant_id?: string | null
    location_id?: string | null
    lot_id?: string | null
    quantity_on_hand?: string | number | null
  }

  const items: ScopeQueueItem[] = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages && page <= 20) {
    const params = buildQuery({ page, pageSize: 100, warehouseId })
    const call = await apiCall<PagedResponse<BalanceRow>>(
      `/api/wms/inventory/balances?${params}`,
    )
    if (!call.ok) throw new ScopeQueueError()

    for (const row of call.result?.items ?? []) {
      const locationId = row.location_id?.trim()
      const variantId = row.catalog_variant_id?.trim()
      const lotId = row.lot_id?.trim() || null
      const onHand = Number(row.quantity_on_hand ?? 0)

      if (!locationId || !variantId) continue
      if (!scopedBinIds.has(locationId)) continue
      if (!Number.isFinite(onHand) || onHand <= 0) continue

      const bin = binById.get(locationId)
      items.push({
        locationId,
        locationCode: bin?.code?.trim() ?? locationId,
        catalogVariantId: variantId,
        lotId,
        expectedOnHand: onHand,
      })
    }

    totalPages = call.result?.totalPages ?? 1
    page += 1
  }

  items.sort((a, b) => {
    const cmp = a.locationCode.localeCompare(b.locationCode, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
    return cmp !== 0 ? cmp : a.catalogVariantId.localeCompare(b.catalogVariantId)
  })

  return items
}

export async function fetchVariantReorderPoint(catalogVariantId: string): Promise<number> {
  if (!catalogVariantId) return 0
  const params = buildQuery({
    page: 1,
    pageSize: 1,
    catalogVariantId,
  })
  const call = await apiCall<PagedResponse<{ reorder_point?: string | number | null }>>(
    `/api/wms/inventory-profiles?${params}`,
  )
  if (!call.ok) return 0
  const row = call.result?.items?.[0]
  if (!row) return 0
  const reorderPoint = Number(row.reorder_point ?? 0)
  return Number.isFinite(reorderPoint) ? reorderPoint : 0
}

export type LocationCapacitySnapshot = {
  capacityUnits: number | null
  totalOnHand: number
}

async function fetchLocationCapacityUnits(locationId: string): Promise<number | null> {
  const id = locationId.trim()
  if (!id) return null
  const params = buildQuery({ page: 1, pageSize: 1, ids: id })
  const call = await apiCall<PagedResponse<{ id?: string | null; capacity_units?: string | number | null }>>(
    `/api/wms/locations?${params}`,
  )
  if (!call.ok) return null
  const raw = call.result?.items?.[0]?.capacity_units
  if (raw == null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const LOCATION_TOTAL_ON_HAND_PAGE_SIZE = 100
const LOCATION_TOTAL_ON_HAND_MAX_PAGES = 50

async function fetchLocationTotalOnHand(input: {
  warehouseId: string
  locationId: string
}): Promise<number> {
  const locationId = input.locationId.trim()
  if (!locationId) return 0
  let sum = 0
  let page = 1
  let totalPages = 1
  do {
    const params = buildQuery({
      page,
      pageSize: LOCATION_TOTAL_ON_HAND_PAGE_SIZE,
      warehouseId: input.warehouseId,
      locationId,
    })
    const call = await apiCall<PagedResponse<{ quantity_on_hand?: string | number | null }>>(
      `/api/wms/inventory/balances?${params}`,
    )
    if (!call.ok) break
    for (const row of call.result?.items ?? []) {
      const value = Number(row.quantity_on_hand ?? 0)
      if (Number.isFinite(value)) sum += value
    }
    totalPages = call.result?.totalPages ?? 1
    page += 1
  } while (page <= totalPages && page <= LOCATION_TOTAL_ON_HAND_MAX_PAGES)
  return sum
}

export async function fetchLocationCapacitySnapshot(input: {
  warehouseId: string
  locationId: string
}): Promise<LocationCapacitySnapshot> {
  const [capacityUnits, totalOnHand] = await Promise.all([
    fetchLocationCapacityUnits(input.locationId),
    fetchLocationTotalOnHand(input),
  ])
  return { capacityUnits, totalOnHand }
}

export async function fetchBalanceOnHand(input: {
  warehouseId: string
  locationId: string
  catalogVariantId: string
  lotId?: string | null
}): Promise<number> {
  const params = buildQuery({
    page: 1,
    pageSize: 20,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
    catalogVariantId: input.catalogVariantId,
    lotId: input.lotId?.trim() || undefined,
  })
  const call = await apiCall<PagedResponse<InventoryBalanceLookupRow>>(
    `/api/wms/inventory/balances?${params}`,
  )
  if (!call.ok) {
    throw new BalanceLookupError()
  }
  const row = selectBalanceLookupRow(call.result?.items ?? [], input.lotId)
  if (!row) return 0
  const onHand = Number(row.quantity_on_hand ?? 0)
  return Number.isFinite(onHand) ? onHand : 0
}
