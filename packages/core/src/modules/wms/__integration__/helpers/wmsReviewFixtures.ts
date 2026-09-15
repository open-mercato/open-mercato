import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const WAREHOUSES_PATH = '/api/wms/warehouses'
export const SITES_PATH = '/api/wms/sites'
export const ROLES_PATH = '/api/wms/site-warehouse-roles'

export type ReviewScope = ReturnType<typeof getTokenScope>

export type WarehouseRow = {
  id?: string
  name?: string
  code?: string
  is_active?: boolean
  is_primary?: boolean
}

export type SiteRow = {
  id?: string
  name?: string
  code?: string
  isActive?: boolean
}

export type RoleRow = {
  id?: string
  siteId?: string
  warehouseId?: string
  role?: string
  isDefault?: boolean
  warehouse?: { id?: string; name?: string; isActive?: boolean }
}

type ListResponse<T> = { items?: T[] }

type RequestOptions = {
  token: string
  data?: unknown
  headers?: Record<string, string>
}

function withOrganizationScope(
  options: RequestOptions,
  organizationId?: string,
): RequestOptions {
  if (!organizationId) return options
  return {
    ...options,
    headers: { ...(options.headers ?? {}), Cookie: `om_selected_org=${organizationId}` },
  }
}

async function createResource(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  organizationId?: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'POST',
    path,
    withOrganizationScope({ token, data }, organizationId),
  )
  expect(response.status(), `Failed POST ${path}: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(body?.id, `Missing id in ${path} response`).toBeTruthy()
  return body?.id as string
}

export async function createWarehouse(
  request: APIRequestContext,
  token: string,
  scope: ReviewScope,
  name: string,
  code: string,
  options: { organizationId?: string; isPrimary?: boolean; isActive?: boolean } = {},
): Promise<string> {
  const organizationId = options.organizationId ?? scope.organizationId
  return createResource(
    request,
    token,
    WAREHOUSES_PATH,
    {
      organizationId,
      tenantId: scope.tenantId,
      name,
      code,
      city: 'Gdansk',
      country: 'PL',
      timezone: 'Europe/Warsaw',
      isActive: options.isActive ?? true,
      isPrimary: options.isPrimary ?? false,
    },
    organizationId,
  )
}

export async function createSite(
  request: APIRequestContext,
  token: string,
  scope: ReviewScope,
  name: string,
  code: string,
  organizationId?: string,
): Promise<string> {
  return createResource(
    request,
    token,
    SITES_PATH,
    { name, code },
    organizationId ?? scope.organizationId,
  )
}

export async function createRole(
  request: APIRequestContext,
  token: string,
  siteId: string,
  warehouseId: string,
  organizationId?: string,
): Promise<string> {
  return createResource(
    request,
    token,
    ROLES_PATH,
    { siteId, warehouseId, role: 'raw_material' },
    organizationId,
  )
}

export async function createOrganization(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  name: string,
): Promise<string> {
  return createResource(request, token, '/api/directory/organizations', { tenantId, name })
}

export async function listWarehouses(
  request: APIRequestContext,
  token: string,
  organizationId?: string,
): Promise<WarehouseRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${WAREHOUSES_PATH}?page=1&pageSize=100`,
    withOrganizationScope({ token }, organizationId),
  )
  expect(response.status()).toBe(200)
  return (await readJsonSafe<ListResponse<WarehouseRow>>(response))?.items ?? []
}

export async function listRoles(
  request: APIRequestContext,
  token: string,
  siteId: string,
  organizationId?: string,
): Promise<RoleRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `${ROLES_PATH}?siteId=${encodeURIComponent(siteId)}&page=1&pageSize=100`,
    withOrganizationScope({ token }, organizationId),
  )
  expect(response.status()).toBe(200)
  return (await readJsonSafe<ListResponse<RoleRow>>(response))?.items ?? []
}

export async function deleteResource(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string | null,
  organizationId?: string,
): Promise<void> {
  if (!id) return
  await apiRequest(
    request,
    'DELETE',
    `${path}?id=${encodeURIComponent(id)}`,
    withOrganizationScope({ token }, organizationId),
  ).catch(() => undefined)
}

export async function deactivateResource(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string | null,
  organizationId?: string,
): Promise<void> {
  if (!id) return
  await apiRequest(
    request,
    'PUT',
    path,
    withOrganizationScope({ token, data: { id, isActive: false } }, organizationId),
  ).catch(() => undefined)
}
