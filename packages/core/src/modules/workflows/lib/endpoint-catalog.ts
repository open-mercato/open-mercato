/**
 * Workflows Module - in-process endpoint catalog (issue #4235, spec
 * 2026-07-26-workflows-ux-redesign.md section 5.3).
 *
 * Builds a trimmed index of the platform's API surface from the SAME inputs
 * the docs route uses — the registered module list plus the API route
 * manifests — via `attachOpenApiDocsToModules` + `buildOpenApiDocument`. The
 * projection keeps only what the endpoint picker and the CALL_API output
 * contract need: path, method, summary, tag, parameter descriptors, and the
 * declared request/response JSON schemas. Undeclared responses (the
 * generator's advisory `Schema not declared` fallback) are omitted so
 * consumers degrade honestly to `unknown` instead of trusting a placeholder.
 *
 * Server-only: assembling the catalog loads every route module through the
 * manifests (exactly what the docs route pays), so the result is cached per
 * process. Paths are exposed with the `/api` prefix to match what CALL_API
 * `endpoint` config values look like (`buildApiUrl` only accepts `/api/*`).
 */

import { ZodType } from 'zod'
import type { ZodTypeAny } from 'zod'
import type { Module } from '@open-mercato/shared/modules/registry'
import { getApiRouteManifests } from '@open-mercato/shared/modules/registry'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { attachOpenApiDocsToModules, buildOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findMatchingEndpoint } from './endpoint-path'

export type WorkflowEndpointParamLocation = 'path' | 'query' | 'header'

export interface WorkflowEndpointParam {
  name: string
  in: WorkflowEndpointParamLocation
  required: boolean
  type: string
}

export interface WorkflowEndpointDescriptor {
  path: string
  method: string
  summary: string
  tag: string
  params: WorkflowEndpointParam[]
  hasRequestSchema: boolean
  requestSchema?: Record<string, unknown>
  responseSchema?: Record<string, unknown>
}

export interface WorkflowEndpointCatalog {
  items: WorkflowEndpointDescriptor[]
}

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const PARAM_LOCATIONS = new Set<WorkflowEndpointParamLocation>(['path', 'query', 'header'])

const UNDECLARED_RESPONSE_DESCRIPTION = 'Schema not declared'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function methodRank(method: string): number {
  const index = METHOD_ORDER.indexOf(method as (typeof METHOD_ORDER)[number])
  return index === -1 ? METHOD_ORDER.length : index
}

function compareEndpoints(left: WorkflowEndpointDescriptor, right: WorkflowEndpointDescriptor): number {
  const byPath = left.path.localeCompare(right.path)
  if (byPath !== 0) return byPath
  return methodRank(left.method) - methodRank(right.method)
}

function schemaTypeOf(schema: unknown): string {
  if (!isRecord(schema)) return 'unknown'
  if (typeof schema.type === 'string' && schema.type.length > 0) return schema.type
  return 'unknown'
}

function projectParams(parameters: unknown): WorkflowEndpointParam[] {
  if (!Array.isArray(parameters)) return []
  const params: WorkflowEndpointParam[] = []
  for (const parameter of parameters) {
    if (!isRecord(parameter)) continue
    const name = parameter.name
    const location = parameter.in
    if (typeof name !== 'string' || name.length === 0) continue
    if (typeof location !== 'string' || !PARAM_LOCATIONS.has(location as WorkflowEndpointParamLocation)) continue
    params.push({
      name,
      in: location as WorkflowEndpointParamLocation,
      required: parameter.required === true,
      type: schemaTypeOf(parameter.schema),
    })
  }
  return params
}

function jsonContentSchema(container: unknown): Record<string, unknown> | undefined {
  if (!isRecord(container)) return undefined
  const content = container.content
  if (!isRecord(content)) return undefined
  const jsonEntry = content['application/json']
  if (!isRecord(jsonEntry)) return undefined
  const schema = jsonEntry.schema
  if (!isRecord(schema) || Object.keys(schema).length === 0) return undefined
  return schema
}

function isDeclaredResponseSchema(schema: Record<string, unknown>): boolean {
  if (schema.description !== UNDECLARED_RESPONSE_DESCRIPTION) return true
  if (isRecord(schema.properties) && Object.keys(schema.properties).length > 0) return true
  return schema.type !== 'object'
}

function projectSuccessResponseSchema(responses: unknown): Record<string, unknown> | undefined {
  if (!isRecord(responses)) return undefined
  const successStatuses = Object.keys(responses)
    .map((status) => Number.parseInt(status, 10))
    .filter((status) => Number.isInteger(status) && status >= 200 && status < 300)
    .sort((left, right) => left - right)
  for (const status of successStatuses) {
    const schema = jsonContentSchema(responses[String(status)])
    if (schema && isDeclaredResponseSchema(schema)) return schema
  }
  return undefined
}

export function buildEndpointCatalog(modules: Module[]): WorkflowEndpointCatalog {
  const doc = buildOpenApiDocument(modules)
  const items: WorkflowEndpointDescriptor[] = []
  for (const [docPath, operations] of Object.entries(doc.paths)) {
    if (!isRecord(operations)) continue
    for (const [methodLower, operation] of Object.entries(operations)) {
      const method = methodLower.toUpperCase()
      if (methodRank(method) === METHOD_ORDER.length) continue
      if (!isRecord(operation)) continue
      const requestSchema = jsonContentSchema(operation.requestBody)
      const responseSchema = projectSuccessResponseSchema(operation.responses)
      const tags = operation.tags
      items.push({
        path: `/api${docPath}`,
        method,
        summary:
          typeof operation.summary === 'string' && operation.summary.length > 0
            ? operation.summary
            : `${method} /api${docPath}`,
        tag: Array.isArray(tags) && typeof tags[0] === 'string' ? tags[0] : '',
        params: projectParams(operation.parameters),
        hasRequestSchema: requestSchema !== undefined,
        ...(requestSchema !== undefined ? { requestSchema } : {}),
        ...(responseSchema !== undefined ? { responseSchema } : {}),
      })
    }
  }
  items.sort(compareEndpoints)
  return { items }
}

interface EndpointResponseSchemaEntry {
  path: string
  method: string
  schema: ZodTypeAny | null
}

function normalizeDocPath(path: string): string {
  const segments = path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/)
      if (optionalCatchAll) return `{${optionalCatchAll[1]}}`
      const catchAll = segment.match(/^\[\.\.\.(.+)\]$/)
      if (catchAll) return `{${catchAll[1]}}`
      const dynamic = segment.match(/^\[(.+)\]$/)
      if (dynamic) return `{${dynamic[1]}}`
      return segment
    })
  return `/${segments.join('/')}`
}

function successResponseZodSchema(methodDoc: OpenApiMethodDoc | undefined): ZodTypeAny | null {
  if (!methodDoc || !Array.isArray(methodDoc.responses)) return null
  const declaredSuccesses = methodDoc.responses
    .filter(
      (response) =>
        typeof response?.status === 'number' &&
        response.status >= 200 &&
        response.status < 300 &&
        response.schema instanceof ZodType,
    )
    .sort((left, right) => left.status - right.status)
  const schema = declaredSuccesses[0]?.schema
  return schema instanceof ZodType ? schema : null
}

/**
 * Index of the endpoint surface with each endpoint's declared zod success
 * response schema (or null when none is declared), built from the SAME
 * attached route docs the catalog projection reads. Every endpoint is
 * indexed — not only those with schemas — so a literal route always wins the
 * match over a sibling `{param}` template instead of borrowing its schema.
 * Schemas stay zod (not JSON schema) so the CALL_API output contract can
 * feed `flattenSchemaToContract` through the existing `resolveOutputContract`
 * seam.
 */
function buildResponseSchemaIndex(modules: Module[]): EndpointResponseSchemaEntry[] {
  const entries: EndpointResponseSchemaEntry[] = []
  for (const moduleEntry of modules) {
    for (const api of moduleEntry.apis ?? []) {
      const rawPath = (api as { path?: unknown }).path
      if (typeof rawPath !== 'string' || rawPath.length === 0) continue
      const path = `/api${normalizeDocPath(rawPath)}`
      if ('handlers' in api) {
        const handlers = (api as { handlers?: Record<string, unknown> }).handlers ?? {}
        const docs = (api as { docs?: OpenApiRouteDoc }).docs
        for (const method of METHOD_ORDER) {
          if (typeof handlers[method] !== 'function') continue
          entries.push({ path, method, schema: successResponseZodSchema(docs?.methods?.[method]) })
        }
        continue
      }
      const legacyMethod = (api as { method?: unknown }).method
      if (typeof legacyMethod !== 'string' || legacyMethod.length === 0) continue
      entries.push({
        path,
        method: legacyMethod.toUpperCase(),
        schema: successResponseZodSchema((api as { docs?: OpenApiMethodDoc }).docs),
      })
    }
  }
  return entries
}

let catalogPromise: Promise<WorkflowEndpointCatalog> | null = null
let responseSchemaIndex: EndpointResponseSchemaEntry[] | null = null

async function assembleCatalog(): Promise<WorkflowEndpointCatalog> {
  const docModules = await attachOpenApiDocsToModules(getModules(), getApiRouteManifests())
  responseSchemaIndex = buildResponseSchemaIndex(docModules)
  return buildEndpointCatalog(docModules)
}

export async function getWorkflowEndpointCatalog(): Promise<WorkflowEndpointCatalog> {
  if (!catalogPromise) {
    catalogPromise = assembleCatalog().catch((error: unknown) => {
      catalogPromise = null
      throw error
    })
  }
  return catalogPromise
}

/**
 * Warms the per-process catalog cache, swallowing failures: callers that only
 * need the sync `findEndpointResponseSchema` lookup (the context-schema
 * route) degrade to 'unknown' contracts when assembly is impossible, e.g.
 * when the module registry is not bootstrapped.
 */
export async function ensureWorkflowEndpointCatalog(): Promise<void> {
  try {
    await getWorkflowEndpointCatalog()
  } catch {
    return
  }
}

/**
 * Sync lookup over the warmed response-schema index. Returns null until
 * `getWorkflowEndpointCatalog`/`ensureWorkflowEndpointCatalog` has resolved
 * at least once in this process, and for endpoints without a declared zod
 * success response.
 */
export function findEndpointResponseSchema(endpoint: string, method: string): ZodTypeAny | null {
  if (!responseSchemaIndex) return null
  const matched = findMatchingEndpoint(endpoint, method, responseSchemaIndex)
  return matched ? matched.item.schema : null
}

export function clearWorkflowEndpointCatalogForTests(): void {
  catalogPromise = null
  responseSchemaIndex = null
}
