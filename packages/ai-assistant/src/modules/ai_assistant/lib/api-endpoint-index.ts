/**
 * API Endpoint Index
 *
 * Parses the OpenAPI spec into a cached, in-memory list of endpoints and
 * exposes the raw OpenAPI document to Code Mode's `search` tool. The Code
 * Mode rewrite (2026-02-22) made this the only consumer — the legacy
 * `find_api` / `call_api` / `discover_schema` tools and their search-index
 * fan-out have been removed.
 */

import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { Module } from '@open-mercato/shared/modules/registry'
import { fetchWithTimeout, resolveTimeoutMs } from '@open-mercato/shared/lib/http/fetchWithTimeout'

const DEFAULT_OPENAPI_FETCH_TIMEOUT_MS = 10_000

function resolveOpenapiFetchTimeoutMs(): number {
  const raw = process.env.AI_OPENAPI_FETCH_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : undefined
  return resolveTimeoutMs(parsed, DEFAULT_OPENAPI_FETCH_TIMEOUT_MS)
}

/**
 * Indexed API endpoint structure
 */
export interface ApiEndpoint {
  id: string
  operationId: string
  method: string
  path: string
  summary: string
  description: string
  tags: string[]
  requiredFeatures: string[]
  parameters: ApiParameter[]
  requestBodySchema: Record<string, unknown> | null
  deprecated: boolean
}

export interface ApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  type: string
  description: string
}

/**
 * In-memory cache of parsed endpoints (avoid re-parsing on each request)
 */
let endpointsCache: ApiEndpoint[] | null = null
let endpointsByOperationId: Map<string, ApiEndpoint> | null = null

/**
 * In-memory cache of the raw OpenAPI spec document (for Code Mode search tool)
 */
let rawSpecCache: OpenApiDocument | null = null

/**
 * Get all parsed API endpoints (cached)
 */
export async function getApiEndpoints(): Promise<ApiEndpoint[]> {
  if (endpointsCache) {
    return endpointsCache
  }

  endpointsCache = await parseApiEndpoints()
  endpointsByOperationId = new Map(endpointsCache.map((e) => [e.operationId, e]))

  return endpointsCache
}

/**
 * Get endpoint by operationId
 */
export async function getEndpointByOperationId(operationId: string): Promise<ApiEndpoint | null> {
  await getApiEndpoints() // Ensure cache is populated
  return endpointsByOperationId?.get(operationId) ?? null
}

/**
 * Get the raw OpenAPI spec document (cached).
 * Uses the same 3-tier loading strategy as parseApiEndpoints():
 * generated JSON → module registry → HTTP fetch.
 */
export async function getRawOpenApiSpec(): Promise<OpenApiDocument | null> {
  if (rawSpecCache) return rawSpecCache
  rawSpecCache = await loadRawOpenApiSpec()
  return rawSpecCache
}

/**
 * Set the raw OpenAPI spec cache directly.
 * Used by servers that want to inject a pre-built spec.
 */
export function setRawSpecCache(doc: OpenApiDocument): void {
  rawSpecCache = doc
}

/**
 * Clear the raw OpenAPI spec cache.
 */
export function clearRawSpecCache(): void {
  rawSpecCache = null
}

/**
 * Load the rich OpenAPI spec, skipping Tier 1 (static JSON) which lacks requestBody schemas.
 * Prefers Tier 2 (runtime module registry) which has full Zod-converted schemas.
 * Falls back to Tier 1 then Tier 3 if needed.
 */
export async function loadRichOpenApiSpec(): Promise<OpenApiDocument | null> {
  if (rawSpecCache) return rawSpecCache

  // Tier 2 first: Module registry (has full Zod-converted schemas)
  try {
    const { getModules } = await import('@open-mercato/shared/lib/modules/registry')
    const modules: Module[] = getModules()
    const modulesWithApis = modules.filter((m) => m.apis && m.apis.length > 0)

    if (modulesWithApis.length > 0) {
      const doc = buildOpenApiDocument(modules, {
        title: 'Open Mercato API',
        version: '1.0.0',
        servers: [{ url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' }],
      })
      if (!doc.paths || Object.keys(doc.paths).length === 0) {
        return null
      }
      console.error(`[API Index] Rich OpenAPI spec built from ${modulesWithApis.length} modules (Tier 2)`)
      rawSpecCache = doc
      return doc
    }
  } catch {
    // Registry not available — fall through
  }

  // Fall back to standard 3-tier loading (Tier 1 → Tier 3)
  rawSpecCache = await loadRawOpenApiSpec()
  return rawSpecCache
}

/**
 * Load raw OpenAPI spec using the 3-tier strategy.
 */
async function loadRawOpenApiSpec(): Promise<OpenApiDocument | null> {
  // Tier 1: Generated JSON file
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { findAppRoot, findAllApps } = await import('@open-mercato/shared/lib/bootstrap/appResolver')

    let appRoot = findAppRoot()
    if (!appRoot) {
      let current = process.cwd()
      while (current !== path.dirname(current)) {
        const appsDir = path.join(current, 'apps')
        if (fs.existsSync(appsDir)) {
          const apps = findAllApps(current)
          if (apps.length > 0) {
            appRoot = apps[0]
            break
          }
        }
        current = path.dirname(current)
      }
    }

    if (appRoot) {
      const jsonPath = path.join(appRoot.generatedDir, 'openapi.generated.json')
      if (fs.existsSync(jsonPath)) {
        const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as OpenApiDocument
        console.error(`[API Index] Raw OpenAPI spec loaded from ${jsonPath}`)
        return doc
      }
    }
  } catch (error) {
    console.error('[API Index] Raw spec from JSON failed:', error instanceof Error ? error.message : error)
  }

  // Tier 2: Module registry
  try {
    const { getModules } = await import('@open-mercato/shared/lib/modules/registry')
    const modules: Module[] = getModules()
    const modulesWithApis = modules.filter((m) => m.apis && m.apis.length > 0)

    if (modulesWithApis.length > 0) {
      const doc = buildOpenApiDocument(modules, {
        title: 'Open Mercato API',
        version: '1.0.0',
        servers: [{ url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' }],
      })
      console.error(`[API Index] Raw OpenAPI spec built from ${modulesWithApis.length} modules`)
      return doc
    }
  } catch {
    // Registry not available
  }

  // Tier 3: HTTP fetch
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'

  try {
    const response = await fetchWithTimeout(`${baseUrl}/api/docs/openapi`, {
      timeoutMs: resolveOpenapiFetchTimeoutMs(),
    })
    if (response.ok) {
      const doc = (await response.json()) as OpenApiDocument
      console.error('[API Index] Raw OpenAPI spec fetched via HTTP')
      return doc
    }
  } catch (error) {
    console.error('[API Index] Raw spec HTTP fetch failed:', error instanceof Error ? error.message : error)
  }

  return null
}

/**
 * Parse endpoints from generated OpenAPI JSON file (for CLI context).
 * This is generated by `yarn generate`.
 */
async function parseApiEndpointsFromGeneratedJson(): Promise<ApiEndpoint[]> {
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { findAppRoot, findAllApps } = await import('@open-mercato/shared/lib/bootstrap/appResolver')

    let appRoot = findAppRoot()

    // Try monorepo structure if not found - walk up to find monorepo root
    if (!appRoot) {
      let current = process.cwd()
      // Walk up until we find a directory containing 'apps' folder
      while (current !== path.dirname(current)) {
        const appsDir = path.join(current, 'apps')
        if (fs.existsSync(appsDir)) {
          const apps = findAllApps(current)
          if (apps.length > 0) {
            appRoot = apps[0]
            break
          }
        }
        current = path.dirname(current)
      }
    }

    if (!appRoot) {
      console.error('[API Index] Could not find app root')
      return []
    }

    const jsonPath = path.join(appRoot.generatedDir, 'openapi.generated.json')
    if (!fs.existsSync(jsonPath)) {
      console.error('[API Index] openapi.generated.json not found - run yarn generate')
      return []
    }

    const doc = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as OpenApiDocument
    console.error(`[API Index] Loaded OpenAPI from ${jsonPath}`)
    return extractEndpoints(doc)
  } catch (error) {
    console.error('[API Index] Error reading generated JSON:', error instanceof Error ? error.message : error)
    return []
  }
}

/**
 * Parse endpoints from registered modules (works in Next.js context).
 */
async function parseApiEndpointsFromModules(): Promise<ApiEndpoint[]> {
  try {
    const { getModules } = await import('@open-mercato/shared/lib/modules/registry')
    const modules: Module[] = getModules()

    // Count how many modules have APIs defined
    const modulesWithApis = modules.filter((m) => m.apis && m.apis.length > 0)

    if (modulesWithApis.length > 0) {
      console.error(
        `[API Index] Found ${modules.length} modules, ${modulesWithApis.length} with APIs`
      )

      // Generate OpenAPI spec from modules
      const doc = buildOpenApiDocument(modules, {
        title: 'Open Mercato API',
        version: '1.0.0',
        servers: [{ url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000' }],
      })
      if (!doc.paths || Object.keys(doc.paths).length === 0) {
        return []
      }

      return extractEndpoints(doc)
    }
  } catch {
    // Registry not available
  }

  return []
}

/**
 * Parse OpenAPI spec via HTTP fetch.
 * Fetches the OpenAPI spec from the running app's /api/docs/openapi endpoint.
 */
async function parseApiEndpointsFromHttp(): Promise<ApiEndpoint[]> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'

  const openApiUrl = `${baseUrl}/api/docs/openapi`

  try {
    console.error(`[API Index] Fetching OpenAPI spec from ${openApiUrl}...`)
    const response = await fetchWithTimeout(openApiUrl, {
      timeoutMs: resolveOpenapiFetchTimeoutMs(),
    })

    if (!response.ok) {
      console.error(`[API Index] Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`)
      return []
    }

    const doc = (await response.json()) as OpenApiDocument
    console.error(`[API Index] Successfully fetched OpenAPI spec`)
    return extractEndpoints(doc)
  } catch (error) {
    console.error('[API Index] Could not fetch OpenAPI spec:', error instanceof Error ? error.message : error)
    console.error('[API Index] Make sure the app is running at', baseUrl)
    return []
  }
}

/**
 * Parse API endpoints - tries generated JSON first (CLI), then modules (Next.js), then HTTP.
 */
async function parseApiEndpoints(): Promise<ApiEndpoint[]> {
  // Try generated JSON first (works in CLI context without Next.js)
  const fromJson = await parseApiEndpointsFromGeneratedJson()
  if (fromJson.length > 0) {
    console.error(`[API Index] Loaded ${fromJson.length} endpoints from generated JSON`)
    return fromJson
  }

  // Try loading from module registry (works in Next.js context)
  const fromModules = await parseApiEndpointsFromModules()
  if (fromModules.length > 0) {
    console.error(`[API Index] Loaded ${fromModules.length} endpoints from modules registry`)
    return fromModules
  }

  // Fall back to HTTP fetch (requires running Next.js app)
  console.error('[API Index] Generated JSON and modules not available, falling back to HTTP fetch...')
  return parseApiEndpointsFromHttp()
}

/**
 * Extract endpoints from OpenAPI document
 */
function extractEndpoints(doc: OpenApiDocument): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = []
  const validMethods = ['get', 'post', 'put', 'patch', 'delete']

  if (!doc.paths) {
    return endpoints
  }

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!validMethods.includes(method.toLowerCase())) continue
      if (!operation || typeof operation !== 'object') continue

      const op = operation as any

      // Generate operationId if not present
      const operationId = op.operationId || generateOperationId(path, method)

      const endpoint: ApiEndpoint = {
        id: operationId,
        operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary || '',
        description: op.description || op.summary || `${method.toUpperCase()} ${path}`,
        tags: op.tags || [],
        requiredFeatures: op['x-require-features'] || [],
        deprecated: op.deprecated || false,
        parameters: extractParameters(op.parameters || []),
        requestBodySchema: extractRequestBodySchema(op.requestBody, doc.components?.schemas),
      }

      endpoints.push(endpoint)
    }
  }

  console.error(`[API Index] Parsed ${endpoints.length} endpoints from OpenAPI spec`)
  return endpoints
}

/**
 * Generate operationId from path and method
 */
function generateOperationId(path: string, method: string): string {
  const pathParts = path
    .replace(/^\//, '')
    .replace(/\{([^}]+)\}/g, 'by_$1')
    .split('/')
    .filter(Boolean)
    .join('_')

  return `${method.toLowerCase()}_${pathParts}`
}

/**
 * Extract parameter info
 */
function extractParameters(params: any[]): ApiParameter[] {
  return params
    .filter((p) => p.in === 'path' || p.in === 'query')
    .map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required ?? false,
      type: p.schema?.type || 'string',
      description: p.description || '',
    }))
}

/**
 * Extract request body schema (simplified)
 */
function extractRequestBodySchema(
  requestBody: any,
  schemas?: Record<string, any>
): Record<string, unknown> | null {
  if (!requestBody?.content?.['application/json']?.schema) {
    return null
  }

  const schema = requestBody.content['application/json'].schema

  // Resolve $ref if present
  if (schema.$ref && schemas) {
    const refPath = schema.$ref.replace('#/components/schemas/', '')
    return schemas[refPath] || schema
  }

  return schema
}

/**
 * Clear endpoint cache (for testing)
 */
export function clearEndpointCache(): void {
  endpointsCache = null
  endpointsByOperationId = null
  rawSpecCache = null
}

/**
 * Extract simplified request body schema for LLM consumption.
 * Returns required fields and basic property info without deep nesting.
 */
export function simplifyRequestBodySchema(
  schema: Record<string, unknown> | null
): { required: string[]; properties: Record<string, { type: string; format?: string; enum?: string[] }> } | null {
  if (!schema) return null

  const properties: Record<string, { type: string; format?: string; enum?: string[] }> = {}
  const required: string[] = (schema.required as string[]) || []

  const schemaProps = (schema.properties || schema) as Record<string, unknown>

  for (const [key, value] of Object.entries(schemaProps)) {
    if (typeof value !== 'object' || value === null) continue
    const propSchema = value as Record<string, unknown>

    const prop: { type: string; format?: string; enum?: string[] } = {
      type: (propSchema.type as string) || 'unknown',
    }

    if (propSchema.format) prop.format = propSchema.format as string
    if (propSchema.enum && Array.isArray(propSchema.enum)) {
      prop.enum = propSchema.enum.slice(0, 10) as string[] // Limit enum values
    }

    properties[key] = prop
  }

  return { required, properties }
}
