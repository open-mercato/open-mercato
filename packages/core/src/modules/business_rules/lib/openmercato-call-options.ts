import type { EntityManager } from '@mikro-orm/postgresql'
import {
  getApiRouteManifests,
  type ApiRouteManifestEntry,
  type Module,
} from '@open-mercato/shared/modules/registry'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ApiKey } from '../../api_keys/data/entities'
import { Role } from '../../auth/data/entities'
import { Organization } from '../../directory/data/entities'
import {
  OPENMERCATO_CALL_METHODS,
  type OpenMercatoApiKeyOption,
  type OpenMercatoCallMethod,
  type OpenMercatoEndpointOption,
} from './openmercato-call-options-types'

export type OpenMercatoCallScope = {
  tenantId: string
  organizationId?: string | null
}

const METHOD_ORDER = new Map<string, number>(
  OPENMERCATO_CALL_METHODS.map((method, index) => [method, index]),
)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isOpenMercatoCallMethod(value: string): value is OpenMercatoCallMethod {
  return OPENMERCATO_CALL_METHODS.includes(value as OpenMercatoCallMethod)
}

function hasPathSegment(path: string, segment: string): boolean {
  return path.split('/').some((part) => part === segment)
}

function shouldExposeEndpoint(path: string, method: string, operation: Record<string, any>): boolean {
  if (!isOpenMercatoCallMethod(method.toUpperCase())) return false
  if (!path.startsWith('/api/')) return false
  if (path.includes('{')) return false
  if (path.includes('[')) return false
  if (path.startsWith('/api/docs')) return false
  if (hasPathSegment(path, 'options')) return false
  if (path === '/api/business_rules/openmercato-call-options') return false
  if (operation.deprecated === true) return false
  return true
}

export function dedupeOpenMercatoEndpointOptions(
  options: OpenMercatoEndpointOption[],
): OpenMercatoEndpointOption[] {
  const deduped = new Map<string, OpenMercatoEndpointOption>()

  for (const option of options) {
    const existing = deduped.get(option.id)
    if (!existing) {
      deduped.set(option.id, option)
      continue
    }

    if ((!existing.summary && option.summary) || (!existing.operationId && option.operationId)) {
      deduped.set(option.id, {
        ...existing,
        label: option.label,
        summary: option.summary ?? existing.summary,
        operationId: option.operationId ?? existing.operationId,
      })
    }
  }

  return Array.from(deduped.values())
}

function sortEndpointOptions(options: OpenMercatoEndpointOption[]): OpenMercatoEndpointOption[] {
  return dedupeOpenMercatoEndpointOptions(options).sort((a, b) => {
    const pathCompare = a.path.localeCompare(b.path)
    if (pathCompare !== 0) return pathCompare
    return (METHOD_ORDER.get(a.method) ?? 99) - (METHOD_ORDER.get(b.method) ?? 99)
  })
}

export function collectOpenMercatoEndpointOptionsFromDocument(doc: { paths?: Record<string, any> }): OpenMercatoEndpointOption[] {
  const options: OpenMercatoEndpointOption[] = []

  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [rawMethod, operation] of Object.entries(methods ?? {})) {
      const method = rawMethod.toUpperCase()
      if (!operation || typeof operation !== 'object') continue
      if (!shouldExposeEndpoint(path, method, operation as Record<string, any>)) continue

      const typedMethod = method as OpenMercatoCallMethod
      const summary = typeof (operation as any).summary === 'string' ? (operation as any).summary : null
      const operationId = typeof (operation as any).operationId === 'string' ? (operation as any).operationId : null

      options.push({
        id: `${typedMethod} ${path}`,
        path,
        method: typedMethod,
        label: summary ? `${typedMethod} ${path} - ${summary}` : `${typedMethod} ${path}`,
        summary,
        operationId,
      })
    }
  }

  return sortEndpointOptions(options)
}

export function collectOpenMercatoEndpointOptions(modules: Module[]): OpenMercatoEndpointOption[] {
  return collectOpenMercatoEndpointOptionsFromDocument(buildOpenApiDocument(modules))
}

function normalizeManifestPath(path: string): string {
  const prefixed = path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`
  return prefixed.replace(/\/+$/, '') || '/api'
}

function getRouteMethodDoc(routeDoc: OpenApiRouteDoc | undefined, method: OpenMercatoCallMethod): OpenApiMethodDoc | undefined {
  return routeDoc?.methods?.[method]
}

async function collectOpenMercatoEndpointOptionsFromApiRouteManifests(
  routes: ApiRouteManifestEntry[],
): Promise<OpenMercatoEndpointOption[]> {
  const options: OpenMercatoEndpointOption[] = []

  for (const route of routes) {
    const path = normalizeManifestPath(route.path)
    const candidateMethods = route.methods
      .map((method) => method.toUpperCase())
      .filter(isOpenMercatoCallMethod)
    if (candidateMethods.length === 0) continue
    if (!path.startsWith('/api/')) continue
    if (path.includes('[')) continue
    if (path.startsWith('/api/docs')) continue
    if (hasPathSegment(path, 'options')) continue
    if (path === '/api/business_rules/openmercato-call-options') continue

    let routeDoc: OpenApiRouteDoc | undefined
    try {
      const routeModule = await route.load()
      routeDoc = routeModule.openApi as OpenApiRouteDoc | undefined
    } catch {
      routeDoc = undefined
    }

    for (const typedMethod of candidateMethods) {
      const methodDoc = getRouteMethodDoc(routeDoc, typedMethod)
      const operation = methodDoc ?? {}
      if (!shouldExposeEndpoint(path, typedMethod, operation as Record<string, any>)) continue

      const summary = typeof methodDoc?.summary === 'string' ? methodDoc.summary : null
      const operationId = typeof methodDoc?.operationId === 'string' ? methodDoc.operationId : null
      options.push({
        id: `${typedMethod} ${path}`,
        path,
        method: typedMethod,
        label: summary ? `${typedMethod} ${path} - ${summary}` : `${typedMethod} ${path}`,
        summary,
        operationId,
      })
    }
  }

  return sortEndpointOptions(options)
}

export async function getCurrentOpenMercatoEndpointOptions(): Promise<OpenMercatoEndpointOption[]> {
  try {
    const moduleOptions = collectOpenMercatoEndpointOptions(getModules())
    if (moduleOptions.length > 0) return moduleOptions
  } catch {
    // The runtime app route registry is the source of truth when modules were not
    // registered in this package instance.
  }

  const apiRoutes = getApiRouteManifests()
  if (apiRoutes.length === 0) return []
  return collectOpenMercatoEndpointOptionsFromApiRouteManifests(apiRoutes)
}

export function findOpenMercatoEndpointOption(
  endpoint: string,
  method: string,
  options: OpenMercatoEndpointOption[],
): OpenMercatoEndpointOption | null {
  const normalizedMethod = method.trim().toUpperCase()
  if (!endpoint.startsWith('/api/')) return null
  if (!isOpenMercatoCallMethod(normalizedMethod)) return null
  return options.find((option) => option.path === endpoint && option.method === normalizedMethod) ?? null
}

export async function listOpenMercatoApiKeyOptions(
  em: EntityManager,
  scope: OpenMercatoCallScope,
): Promise<OpenMercatoApiKeyOption[]> {
  const filters: Record<string, any> = {
    tenantId: scope.tenantId,
    deletedAt: null,
  }
  if (scope.organizationId) {
    filters.organizationId = scope.organizationId
  }

  const keys = (await em.find(ApiKey, filters, { orderBy: { name: 'asc' } })) as ApiKey[]
  const now = Date.now()
  const activeKeys = keys.filter((key) => !key.expiresAt || key.expiresAt.getTime() > now)

  const roleIds = new Set<string>()
  const organizationIds = new Set<string>()
  for (const key of activeKeys) {
    if (key.organizationId) organizationIds.add(String(key.organizationId))
    if (Array.isArray(key.rolesJson)) {
      for (const roleId of key.rolesJson) roleIds.add(String(roleId))
    }
  }

  const [roles, organizations] = await Promise.all([
    roleIds.size > 0 ? em.find(Role, { id: { $in: Array.from(roleIds) }, deletedAt: null }) : [],
    organizationIds.size > 0 ? em.find(Organization, { id: { $in: Array.from(organizationIds) } }) : [],
  ])
  const roleMap = new Map((roles as Role[]).map((role) => [String(role.id), role.name ?? null]))
  const orgMap = new Map((organizations as Organization[]).map((org) => [String(org.id), org.name ?? null]))

  return activeKeys.map((key) => ({
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    organizationId: key.organizationId ?? null,
    organizationName: key.organizationId ? orgMap.get(String(key.organizationId)) ?? null : null,
    roles: Array.isArray(key.rolesJson)
      ? key.rolesJson.map((roleId) => ({
          id: String(roleId),
          name: roleMap.get(String(roleId)) ?? null,
        }))
      : [],
  }))
}

export async function resolveOpenMercatoApiKeyProfile(
  em: EntityManager,
  apiKeyId: string,
  scope: OpenMercatoCallScope,
): Promise<ApiKey | null> {
  if (!apiKeyId || typeof apiKeyId !== 'string') return null
  if (!UUID_RE.test(apiKeyId)) return null
  const filters: Record<string, any> = {
    id: apiKeyId,
    tenantId: scope.tenantId,
    deletedAt: null,
  }
  if (scope.organizationId) {
    filters.organizationId = scope.organizationId
  }

  const key = await em.findOne(ApiKey, filters)
  if (!key) return null
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null
  return key
}

export async function validateOpenMercatoCallActions(
  em: EntityManager,
  actions: unknown,
  scope: OpenMercatoCallScope,
  endpointOptions?: OpenMercatoEndpointOption[],
): Promise<string[]> {
  if (!Array.isArray(actions) || actions.length === 0) return []

  const errors: string[] = []
  let availableEndpointOptions = endpointOptions
  for (const [index, action] of actions.entries()) {
    if (!action || typeof action !== 'object') continue
    const typedAction = action as { type?: string; config?: Record<string, any> }
    if (typedAction.type !== 'CALL_OPEN_MERCATO') continue
    availableEndpointOptions ??= await getCurrentOpenMercatoEndpointOptions()

    const config = typedAction.config ?? {}
    const endpoint = typeof config.endpoint === 'string' ? config.endpoint : ''
    const method = typeof config.method === 'string' ? config.method : ''
    const apiKeyId = typeof config.apiKeyId === 'string' ? config.apiKeyId : ''

    if (!findOpenMercatoEndpointOption(endpoint, method, availableEndpointOptions)) {
      errors.push(`Action ${index + 1}: selected OpenMercato endpoint is not available`)
    }

    const apiKey = await resolveOpenMercatoApiKeyProfile(em, apiKeyId, scope)
    if (!apiKey) {
      errors.push(`Action ${index + 1}: selected API key profile is not available`)
    } else if (!Array.isArray(apiKey.rolesJson) || apiKey.rolesJson.length === 0) {
      errors.push(`Action ${index + 1}: selected API key profile has no roles`)
    }
  }

  return errors
}
