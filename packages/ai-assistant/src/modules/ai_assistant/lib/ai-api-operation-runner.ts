// Phase 1 of spec 2026-04-27-ai-tools-api-backed-dry-refactor.md.
//
// In-process API operation runner used by typed AI tools to reuse existing
// API route handlers without HTTP, fetch, or a second RBAC pass. The runner
// resolves the matched route entry from the generated `apiRoutes` manifest,
// validates that the route is documented (`openApi`) and that mutation routes
// declare `requiredFeatures`, asserts the route's required features are
// covered by the tool definition, then invokes the route handler directly with
// a synthetic Request that carries a Symbol-keyed trusted-auth envelope so the
// shared auth resolver short-circuits cookie/JWT/API-key parsing.
import {
  attachTrustedAuthContext,
  type AuthContext,
  type TrustedAuthContextEnvelope,
} from '@open-mercato/shared/lib/auth/server'
import {
  findApiRouteManifestMatch,
  getApiRouteManifests,
  type ApiRouteManifestEntry,
  type RouteMatchParams,
} from '@open-mercato/shared/modules/registry'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import type { AiToolDefinition, McpToolContext } from './types'

export type AiApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const MUTATION_METHODS: ReadonlySet<AiApiHttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const SYNTHETIC_ORIGIN = 'http://internal.local'

export type AiApiOperationRequest = {
  method: AiApiHttpMethod
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: Record<string, unknown>
  allowFeaturelessMutation?: boolean
}

export type AiApiOperationResponse<T = unknown> = {
  success: boolean
  statusCode: number
  data?: T
  error?: string
  details?: unknown
}

export interface AiToolExecutionContext extends McpToolContext {
  tool: AiToolDefinition
}

export type AiApiOperationRunnerOptions = {
  /** Optional override of the API route manifest (used by tests). */
  apiRoutes?: ApiRouteManifestEntry[]
  /** Custom loader for the API route manifest (used by tests). */
  loadApiRoutes?: () => Promise<ApiRouteManifestEntry[]>
}

export type AiApiOperationRunner = {
  run<T = unknown>(request: AiApiOperationRequest): Promise<AiApiOperationResponse<T>>
}

type ResolvedHandler = (req: Request, ctx?: { params: RouteMatchParams }) => Promise<Response> | Response

type LoadedRouteModule = Record<string, unknown>

type MethodMetadata = {
  requireAuth?: boolean
  requireFeatures?: string[]
}

function normalizeMethod(method: string): AiApiHttpMethod {
  const upper = method.toUpperCase()
  if (upper === 'GET' || upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE') {
    return upper
  }
  throw new Error(`Unsupported method "${method}"`)
}

function normalizePath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) return '/'
  const trimmed = path.startsWith('/') ? path : `/${path}`
  return trimmed.replace(/\/+$/, '') || '/'
}

function buildUrl(path: string, query?: AiApiOperationRequest['query']): URL {
  const url = new URL(`${SYNTHETIC_ORIGIN}/api${normalizePath(path)}`)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue
      url.searchParams.append(key, String(value))
    }
  }
  return url
}

function buildAuthEnvelope(ctx: AiToolExecutionContext): TrustedAuthContextEnvelope {
  const userId = ctx.userId
  if (!userId) {
    return { auth: null, status: 'invalid' }
  }
  const auth: AuthContext = {
    sub: userId,
    userId,
    tenantId: ctx.tenantId,
    orgId: ctx.organizationId,
    roles: [],
    isSuperAdmin: ctx.isSuperAdmin,
  }
  return { auth, status: 'authenticated' }
}

function pickHandler(entry: ApiRouteManifestEntry, mod: LoadedRouteModule, method: AiApiHttpMethod): ResolvedHandler | null {
  const direct = mod[method]
  if (typeof direct === 'function') return direct as ResolvedHandler
  if (entry.kind === 'legacy') {
    const fallback = mod.default ?? mod.handler
    if (typeof fallback === 'function') return fallback as ResolvedHandler
  }
  return null
}

function extractMethodMetadata(metadata: unknown, method: AiApiHttpMethod): MethodMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  const perMethod = record[method]
  const source: Record<string, unknown> = perMethod && typeof perMethod === 'object'
    ? (perMethod as Record<string, unknown>)
    : record
  const result: MethodMetadata = {}
  if (typeof source.requireAuth === 'boolean') {
    result.requireAuth = source.requireAuth
  }
  if (Array.isArray(source.requireFeatures)) {
    const features = source.requireFeatures.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    if (features.length > 0) result.requireFeatures = features
  }
  return result
}

async function readResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }
  try {
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } catch {
    return null
  }
}

function failure(statusCode: number, error: string, details?: unknown): AiApiOperationResponse {
  const response: AiApiOperationResponse = { success: false, statusCode, error }
  if (details !== undefined) response.details = details
  return response
}

function normalizeError(body: unknown): { error: string; details?: unknown } {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>
    const message = typeof record.error === 'string'
      ? record.error
      : typeof record.message === 'string'
        ? record.message
        : null
    if (message) {
      const { error: _ignored, message: _ignoredMessage, ...rest } = record
      void _ignored
      void _ignoredMessage
      return Object.keys(rest).length > 0 ? { error: message, details: rest } : { error: message }
    }
  }
  if (typeof body === 'string' && body.length > 0) {
    return { error: body }
  }
  return { error: 'Request failed' }
}

export function createAiApiOperationRunner(
  ctx: AiToolExecutionContext,
  options: AiApiOperationRunnerOptions = {},
): AiApiOperationRunner {
  let manifestPromise: Promise<ApiRouteManifestEntry[]> | null = null

  const loadManifest = async (): Promise<ApiRouteManifestEntry[]> => {
    if (options.apiRoutes) return options.apiRoutes
    if (manifestPromise) return manifestPromise
    const loader = options.loadApiRoutes ?? defaultLoadApiRoutes
    manifestPromise = loader()
    try {
      return await manifestPromise
    } catch (error) {
      manifestPromise = null
      throw error
    }
  }

  return {
    async run<T = unknown>(request: AiApiOperationRequest): Promise<AiApiOperationResponse<T>> {
      let method: AiApiHttpMethod
      try {
        method = normalizeMethod(request.method)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid method'
        return failure(400, message) as AiApiOperationResponse<T>
      }
      const path = normalizePath(request.path)

      let routes: ApiRouteManifestEntry[]
      try {
        routes = await loadManifest()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load API route manifest'
        return failure(500, `Operation runner manifest unavailable: ${message}`) as AiApiOperationResponse<T>
      }

      const match = findApiRouteManifestMatch(routes, method, path)
      if (!match) {
        return failure(
          404,
          `No documented API route matches ${method} ${path}`,
        ) as AiApiOperationResponse<T>
      }

      let mod: LoadedRouteModule
      try {
        mod = (await match.route.load()) as LoadedRouteModule
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load route module'
        return failure(500, `Failed to load route module: ${message}`) as AiApiOperationResponse<T>
      }

      if (!('openApi' in mod) || mod.openApi === undefined || mod.openApi === null) {
        return failure(
          501,
          `Route ${method} ${path} is undocumented (missing openApi export); refusing to call from AI tool`,
        ) as AiApiOperationResponse<T>
      }

      const handler = pickHandler(match.route, mod, method)
      if (!handler) {
        return failure(
          405,
          `Route ${path} does not export a handler for method ${method}`,
        ) as AiApiOperationResponse<T>
      }

      const methodMetadata = extractMethodMetadata(mod.metadata, method)
      const routeFeatures = methodMetadata?.requireFeatures ?? []
      const isMutation = MUTATION_METHODS.has(method)

      if (isMutation && routeFeatures.length === 0 && !request.allowFeaturelessMutation) {
        return failure(
          403,
          `Mutation route ${method} ${path} declares no requiredFeatures; refusing to call without allowFeaturelessMutation opt-in`,
        ) as AiApiOperationResponse<T>
      }

      const toolFeatures = ctx.tool.requiredFeatures ?? []
      if (routeFeatures.length > 0 && !hasAllFeatures(toolFeatures, routeFeatures)) {
        return failure(
          403,
          `AI tool "${ctx.tool.name}" requiredFeatures do not cover route ${method} ${path} requiredFeatures`,
          { toolFeatures, routeFeatures },
        ) as AiApiOperationResponse<T>
      }

      const url = buildUrl(path, request.query)
      const headers = new Headers()
      const requestInit: RequestInit = { method, headers }
      if (request.body !== undefined && method !== 'GET') {
        headers.set('content-type', 'application/json')
        requestInit.body = JSON.stringify(request.body)
      }

      const syntheticRequest = new Request(url, requestInit)
      attachTrustedAuthContext(syntheticRequest, buildAuthEnvelope(ctx))

      let response: Response
      try {
        response = await handler(syntheticRequest, { params: match.params })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Route handler threw'
        return failure(500, message) as AiApiOperationResponse<T>
      }

      const status = response.status
      const body = await readResponseBody(response)
      if (status >= 200 && status < 300) {
        return {
          success: true,
          statusCode: status,
          data: body as T,
        }
      }
      const normalized = normalizeError(body)
      return {
        success: false,
        statusCode: status,
        error: normalized.error,
        ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      }
    },
  }
}

async function defaultLoadApiRoutes(): Promise<ApiRouteManifestEntry[]> {
  const registered = getApiRouteManifests()
  if (registered.length === 0) {
    throw new Error(
      'No API route manifest registered. Call registerApiRouteManifests(...) at app bootstrap or pass apiRoutes/loadApiRoutes to createAiApiOperationRunner.',
    )
  }
  return registered
}

