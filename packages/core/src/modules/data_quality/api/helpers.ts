import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveOrganizationScopeForRequest } from '../../directory/utils/organizationScope'

export type DataQualityRouteContext = {
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  container: Awaited<ReturnType<typeof createRequestContainer>>
  commandContext: CommandRuntimeContext
  selectedOrganizationId: string | null
  organizationIds: string[] | null
}

export async function resolveDataQualityRouteContext(
  req: Request,
): Promise<DataQualityRouteContext | null> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return null
  }

  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request: req,
  }).catch(() => null)

  const scopedTenantId = organizationScope?.tenantId ?? auth.tenantId ?? null
  const selectedOrganizationId = organizationScope
    ? (organizationScope.selectedId ?? null)
    : (auth.orgId ?? null)

  const rawFilteredIds = organizationScope?.filterIds
  const normalizedFilteredIds = Array.isArray(rawFilteredIds)
    ? Array.from(new Set(rawFilteredIds.filter((value): value is string => typeof value === 'string' && value.length > 0)))
    : null
  const fallbackOrgId = selectedOrganizationId ?? auth.orgId ?? null

  let organizationIds: string[] | null
  if (!organizationScope) {
    organizationIds = fallbackOrgId ? [fallbackOrgId] : null
  } else if (normalizedFilteredIds === null) {
    organizationIds = organizationScope.allowedIds === null
      ? null
      : (fallbackOrgId ? [fallbackOrgId] : null)
  } else if (normalizedFilteredIds.length > 0) {
    organizationIds = normalizedFilteredIds
  } else if (fallbackOrgId) {
    const allowedIds = Array.isArray(organizationScope.allowedIds)
      ? organizationScope.allowedIds
      : null
    const canUseFallback = allowedIds === null
      || allowedIds.length === 0
      || allowedIds.includes(fallbackOrgId)
    organizationIds = canUseFallback ? [fallbackOrgId] : []
  } else {
    organizationIds = []
  }

  const scopedAuth = {
    ...auth,
    tenantId: scopedTenantId,
    orgId: selectedOrganizationId,
  }

  return {
    auth: scopedAuth,
    container,
    selectedOrganizationId,
    organizationIds,
    commandContext: {
      container,
      auth: scopedAuth,
      organizationScope,
      selectedOrganizationId,
      organizationIds,
      request: req,
    },
  }
}

export async function unwrapRouteParams<T extends Record<string, string | undefined>>(
  ctx: { params?: Promise<T> | T },
): Promise<T> {
  const params = ctx.params
  if (!params) {
    return {} as T
  }

  return typeof (params as Promise<unknown>).then === 'function'
    ? await (params as Promise<T>)
    : (params as T)
}

export async function withMergedJsonBody(
  request: Request,
  patch: Record<string, unknown>,
): Promise<Request> {
  const parsed = await readJsonSafe<unknown>(request, {})
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}

  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify({ ...body, ...patch }),
  })
}

export function toIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString()
  }
  return typeof value === 'string' ? value : null
}
