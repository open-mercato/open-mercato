import { type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'

export async function getLocales(
  request: APIRequestContext,
  token: string,
): Promise<string[]> {
  const response = await apiRequest(request, 'GET', '/api/translations/locales', { token })
  if (!response.ok()) return []
  const body = (await response.json()) as { locales?: string[] }
  return body.locales ?? []
}

export async function setLocales(
  request: APIRequestContext,
  token: string,
  locales: string[],
): Promise<void> {
  await apiRequest(request, 'PUT', '/api/translations/locales', { token, data: { locales } })
}

export async function deleteTranslationIfExists(
  request: APIRequestContext,
  token: string | null,
  entityType: string,
  entityId: string | null,
): Promise<void> {
  if (!token || !entityId) return
  try {
    await apiRequest(request, 'DELETE', `/api/translations/${entityType}/${entityId}`, { token })
  } catch {
    return
  }
}

type RoleAclPayload = { features: string[]; isSuperAdmin: boolean; organizations: string[] | null }

async function findRoleId(
  request: APIRequestContext,
  token: string,
  roleName: string,
): Promise<string> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles?search=${encodeURIComponent(roleName)}&pageSize=50`, { token })
  const body = (await response.json()) as { items?: Array<{ id: string; name: string }> }
  const role = (body.items ?? []).find((r) => r.name === roleName)
  if (!role) throw new Error(`Role "${roleName}" not found`)
  return role.id
}

async function getRoleAcl(
  request: APIRequestContext,
  token: string,
  roleId: string,
): Promise<RoleAclPayload> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles/acl?roleId=${roleId}`, { token })
  const body = (await response.json()) as Partial<RoleAclPayload>
  return {
    features: Array.isArray(body.features) ? body.features : [],
    isSuperAdmin: !!body.isSuperAdmin,
    organizations: body.organizations ?? null,
  }
}

export async function ensureRoleFeatures(
  request: APIRequestContext,
  token: string,
  roleName: string,
  requiredFeatures: string[],
): Promise<string[]> {
  const roleId = await findRoleId(request, token, roleName)
  const acl = await getRoleAcl(request, token, roleId)
  const original = [...acl.features]
  const merged = Array.from(new Set([...acl.features, ...requiredFeatures]))
  if (merged.length !== acl.features.length) {
    await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
      token,
      data: { roleId, features: merged, isSuperAdmin: acl.isSuperAdmin },
    })
  }
  return original
}

export async function restoreRoleFeatures(
  request: APIRequestContext,
  token: string,
  roleName: string,
  features: string[],
): Promise<void> {
  const roleId = await findRoleId(request, token, roleName)
  const acl = await getRoleAcl(request, token, roleId)
  await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
    token,
    data: { roleId, features, isSuperAdmin: acl.isSuperAdmin },
  })
}
