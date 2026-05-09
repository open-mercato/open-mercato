import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/helpers/integration/featureTogglesFixtures'
import {
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

type RolesResponse = {
  items?: Array<{
    id?: string
    name?: string
  }>
}

type RoleAclResponse = {
  isSuperAdmin?: boolean
  features?: string[]
  organizations?: string[] | null
}

type FeatureToggleListResponse = {
  items?: Array<{
    id?: string
    identifier?: string
  }>
}

export type InventoryBalanceListResponse = {
  items?: Array<{
    id?: string
    warehouse_id?: string | null
    location_id?: string | null
    catalog_variant_id?: string | null
    quantity_on_hand?: string | number | null
    quantity_reserved?: string | number | null
    quantity_allocated?: string | number | null
    quantity_available?: number | null
  }>
}

export type InventoryReservationListResponse = {
  items?: Array<{
    id?: string
    warehouse_id?: string | null
    catalog_variant_id?: string | null
    quantity?: string | number | null
    source_type?: string | null
    source_id?: string | null
    status?: string | null
    metadata?: Record<string, unknown> | null
  }>
}

export type InventoryMovementListResponse = {
  items?: Array<{
    id?: string
    warehouse_id?: string | null
    location_from_id?: string | null
    location_to_id?: string | null
    catalog_variant_id?: string | null
    quantity?: string | number | null
    type?: string | null
    reference_type?: string | null
    reference_id?: string | null
  }>
}

export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim().length > 0) {
    return Number(value)
  }
  return 0
}

export async function createCrudFixture(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, `Missing id in ${path} create response`)
}

export async function postAction<T>(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  expect(response.ok(), `Failed POST ${path}: ${response.status()}`).toBeTruthy()
  return (await readJsonSafe<T>(response)) as T
}

export async function ensureRoleFeatures(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  roleName: string,
  requiredFeatures: string[],
): Promise<() => Promise<void>> {
  const rolesResponse = await apiRequest(
    request,
    'GET',
    `/api/auth/roles?tenantId=${encodeURIComponent(tenantId)}&page=1&pageSize=100`,
    { token },
  )
  expect(
    rolesResponse.ok(),
    `Failed GET /api/auth/roles: ${rolesResponse.status()}`,
  ).toBeTruthy()
  const rolesBody = await readJsonSafe<RolesResponse>(rolesResponse)
  const role = rolesBody?.items?.find((item) => item.name === roleName) ?? null
  const roleId = expectId(role?.id, `Missing ${roleName} role in tenant ${tenantId}`)

  const aclPath = `/api/auth/roles/acl?roleId=${encodeURIComponent(roleId)}&tenantId=${encodeURIComponent(tenantId)}`
  const aclResponse = await apiRequest(request, 'GET', aclPath, { token })
  expect(
    aclResponse.ok(),
    `Failed GET ${aclPath}: ${aclResponse.status()}`,
  ).toBeTruthy()
  const aclBody = (await readJsonSafe<RoleAclResponse>(aclResponse)) ?? {}
  const original = {
    isSuperAdmin: Boolean(aclBody.isSuperAdmin),
    features: Array.isArray(aclBody.features) ? aclBody.features : [],
    organizations: Array.isArray(aclBody.organizations)
      ? aclBody.organizations
      : null,
  }

  const mergedFeatures = Array.from(
    new Set([...original.features, ...requiredFeatures]),
  ).sort()
  const originalSorted = [...original.features].sort()
  const changed = mergedFeatures.join('|') !== originalSorted.join('|')

  if (changed) {
    const updateResponse = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token,
      data: {
        roleId,
        tenantId,
        isSuperAdmin: original.isSuperAdmin,
        features: mergedFeatures,
        organizations: original.organizations,
      },
    })
    expect(
      updateResponse.ok(),
      `Failed PUT /api/auth/roles/acl: ${updateResponse.status()}`,
    ).toBeTruthy()
  }

  return async () => {
    if (!changed) return
    await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token,
      data: {
        roleId,
        tenantId,
        isSuperAdmin: original.isSuperAdmin,
        features: original.features,
        organizations: original.organizations,
      },
    }).catch(() => undefined)
  }
}

export async function ensureBooleanFeatureToggle(
  request: APIRequestContext,
  token: string,
  identifier: string,
  name: string,
  description: string,
  category: string,
): Promise<() => Promise<void>> {
  const listResponse = await apiRequest(
    request,
    'GET',
    `/api/feature_toggles/global?identifier=${encodeURIComponent(identifier)}&page=1&pageSize=10`,
    { token },
  )
  expect(
    listResponse.ok(),
    `Failed GET /api/feature_toggles/global for ${identifier}: ${listResponse.status()}`,
  ).toBeTruthy()

  const listBody = await readJsonSafe<FeatureToggleListResponse>(listResponse)
  const existingToggle =
    listBody?.items?.find((item) => item.identifier === identifier) ?? null
  if (existingToggle?.id) {
    return async () => undefined
  }

  const toggleId = await createFeatureToggleFixture(request, token, {
    identifier,
    name,
    description,
    category,
    type: 'boolean',
    defaultValue: true,
  })

  return async () => {
    await deleteFeatureToggleIfExists(request, token, toggleId)
  }
}

export async function fetchBalance(
  request: APIRequestContext,
  token: string,
  warehouseId: string,
  catalogVariantId: string,
) {
  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/balances?warehouseId=${encodeURIComponent(warehouseId)}&catalogVariantId=${encodeURIComponent(catalogVariantId)}&page=1&pageSize=20`,
    { token },
  )
  expect(
    response.ok(),
    `Failed GET /api/wms/inventory/balances: ${response.status()}`,
  ).toBeTruthy()
  const body = await readJsonSafe<InventoryBalanceListResponse>(response)
  return (
    body?.items?.find(
      (item) =>
        item.warehouse_id === warehouseId &&
        item.catalog_variant_id === catalogVariantId,
    ) ?? null
  )
}

export async function fetchReservations(
  request: APIRequestContext,
  token: string,
  query: {
    warehouseId?: string
    catalogVariantId?: string
    sourceType?: string
    sourceId?: string
  },
): Promise<NonNullable<InventoryReservationListResponse['items']>> {
  const params = new URLSearchParams({ page: '1', pageSize: '50' })
  if (query.warehouseId) params.set('warehouseId', query.warehouseId)
  if (query.catalogVariantId) {
    params.set('catalogVariantId', query.catalogVariantId)
  }
  if (query.sourceType) params.set('sourceType', query.sourceType)
  if (query.sourceId) params.set('sourceId', query.sourceId)

  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/reservations?${params.toString()}`,
    { token },
  )
  expect(
    response.ok(),
    `Failed GET /api/wms/inventory/reservations: ${response.status()}`,
  ).toBeTruthy()
  const body = await readJsonSafe<InventoryReservationListResponse>(response)
  return body?.items ?? []
}

export async function fetchMovements(
  request: APIRequestContext,
  token: string,
  query: {
    warehouseId?: string
    catalogVariantId?: string
    referenceId?: string
    type?: string
  },
): Promise<NonNullable<InventoryMovementListResponse['items']>> {
  const params = new URLSearchParams({ page: '1', pageSize: '50' })
  if (query.warehouseId) params.set('warehouseId', query.warehouseId)
  if (query.catalogVariantId) {
    params.set('catalogVariantId', query.catalogVariantId)
  }
  if (query.referenceId) params.set('referenceId', query.referenceId)
  if (query.type) params.set('type', query.type)

  const response = await apiRequest(
    request,
    'GET',
    `/api/wms/inventory/movements?${params.toString()}`,
    { token },
  )
  expect(
    response.ok(),
    `Failed GET /api/wms/inventory/movements: ${response.status()}`,
  ).toBeTruthy()
  const body = await readJsonSafe<InventoryMovementListResponse>(response)
  return body?.items ?? []
}
