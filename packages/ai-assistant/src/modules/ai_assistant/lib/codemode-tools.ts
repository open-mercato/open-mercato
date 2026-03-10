/**
 * Code Mode Tools
 *
 * Two meta-tools that replace all individual API/schema/module tools:
 * - search: Query the OpenAPI spec + entity graph programmatically
 * - execute: Make API calls via a sandboxed api.request() wrapper
 *
 * The AI writes JavaScript that runs in a node:vm sandbox with injected globals.
 */

import { z } from 'zod'
import { registerMcpTool } from './tool-registry'
import type { McpToolContext } from './types'
import { createSandbox } from './sandbox'
import { truncateResult } from './truncate'
import { getRawOpenApiSpec } from './api-endpoint-index'
import {
  getCachedEntityGraph,
  inferModuleFromEntity,
  type EntityGraph,
} from './entity-graph'
import {
  lookupSearchCache,
  storeSearchResult,
  buildMemoryContext,
  buildSearchLabel,
  incrementToolCallCount,
} from './session-memory'

/**
 * Cached spec object combining OpenAPI paths + entity schemas.
 */
let cachedCodeModeSpec: Record<string, unknown> | null = null

/**
 * Cached TypeScript type stubs for common CRUD endpoints.
 * Generated once at startup from the OpenAPI spec.
 */
let cachedCommonTypes: string | null = null

/**
 * Build the merged spec object for the search tool.
 */
async function getCodeModeSpec(): Promise<Record<string, unknown>> {
  if (cachedCodeModeSpec) return cachedCodeModeSpec

  const rawSpec = await getRawOpenApiSpec()
  const graph = getCachedEntityGraph()

  const paths = (rawSpec?.paths ?? {}) as Record<string, Record<string, unknown>>
  const entitySchemas = graph ? buildEntitySchemas(graph) : []

  const spec: Record<string, unknown> = {
    paths,
    info: rawSpec?.info,
    components: rawSpec?.components,
    entitySchemas,
  }

  // --- Helper functions injected into sandbox ---

  /**
   * spec.findEndpoints(keyword) — find all endpoints matching a keyword.
   * Returns compact list: [{ path, methods }]
   */
  spec.findEndpoints = (keyword: string) => {
    const kw = keyword.toLowerCase()
    return Object.entries(paths)
      .filter(([path]) => path.toLowerCase().includes(kw))
      .map(([path, methods]) => ({
        path,
        methods: Object.keys(methods).filter((m) => m !== 'parameters'),
      }))
  }

  /**
   * spec.describeEndpoint(path, method) — compact endpoint profile with working example.
   * Returns: { path, method, summary, requiredFields, optionalFields, nestedCollections, example, relatedEndpoints, relatedEntity }
   * For full schema access, use: spec.paths[path][method].requestBody
   */
  spec.describeEndpoint = (path: string, method: string) => {
    const pathObj = paths[path] as Record<string, unknown> | undefined
    if (!pathObj) return null

    const endpoint = pathObj[method.toLowerCase()] as Record<string, unknown> | undefined
    if (!endpoint) return null

    // Extract requestBody JSON Schema
    const bodySchema = extractRequestBodySchema(endpoint)
    const bodyProps = (bodySchema?.properties ?? {}) as Record<string, Record<string, unknown>>
    const bodyRequired = (bodySchema?.required ?? []) as string[]

    // Split fields into required (with types) vs optional (names only)
    const requiredFields: Array<{ name: string; type: string; format?: string }> = []
    const optionalFields: string[] = []
    const nestedCollections: Array<{
      field: string
      type: string
      requiredFields: Array<{ name: string; type: string }>
      commonFields: string[]
    }> = []

    for (const [name, prop] of Object.entries(bodyProps)) {
      const propType = (prop.type as string) || 'string'

      // Detect nested array collections (e.g. lines, items, addresses)
      if (propType === 'array' && prop.items && (prop.items as Record<string, unknown>).type === 'object') {
        const itemSchema = prop.items as Record<string, unknown>
        const itemProps = (itemSchema.properties ?? {}) as Record<string, Record<string, unknown>>
        const itemRequired = (itemSchema.required ?? []) as string[]

        const nestedRequired = itemRequired.map((n) => ({
          name: n,
          type: ((itemProps[n]?.type as string) || 'string'),
        }))

        // Common fields: first few non-required fields that are likely user-provided
        const nestedOptional = Object.keys(itemProps).filter((n) => !itemRequired.includes(n))
        const commonFields = nestedOptional.slice(0, 6)

        nestedCollections.push({
          field: name,
          type: 'array',
          requiredFields: nestedRequired,
          commonFields,
        })
        continue
      }

      if (bodyRequired.includes(name)) {
        const field: { name: string; type: string; format?: string } = { name, type: propType }
        if (prop.format) field.format = prop.format as string
        requiredFields.push(field)
      } else {
        optionalFields.push(name)
      }
    }

    // Generate minimal working example from required fields + nested collections
    const example: Record<string, unknown> = {}
    for (const field of requiredFields) {
      example[field.name] = generatePlaceholder(field.type, field.format)
    }
    for (const collection of nestedCollections) {
      const itemExample: Record<string, unknown> = {}
      for (const field of collection.requiredFields) {
        itemExample[field.name] = generatePlaceholder(field.type)
      }
      // Add first 2 common fields to the example
      for (const name of collection.commonFields.slice(0, 2)) {
        itemExample[name] = '<value>'
      }
      example[collection.field] = [itemExample]
    }

    // Find related endpoints sharing the same module prefix
    const segments = path.replace('/api/', '').split('/')
    const moduleSegment = segments[0]
    const resourceName = segments[1] || segments[0]
    const modulePrefix = `/api/${moduleSegment}/`
    const relatedEndpoints = Object.entries(paths)
      .filter(([p]) => p.startsWith(modulePrefix) && p !== path && !p.includes('{'))
      .map(([p, methods]) => ({
        path: p,
        methods: Object.keys(methods as Record<string, unknown>).filter((m) => m !== 'parameters'),
      }))
      .slice(0, 8)

    // Compact entity: className + relationship summary
    const resourceNorm = resourceName.replace(/-/g, '_')
    const resourceSingular = resourceNorm.endsWith('s') ? resourceNorm.slice(0, -1) : resourceNorm
    const moduleSingular = moduleSegment.endsWith('s') ? moduleSegment.slice(0, -1) : moduleSegment
    const prefixedTable = `${moduleSingular}_${resourceNorm}`

    const entity = entitySchemas.find((e: Record<string, unknown>) => {
      const table = ((e.tableName as string) || '').toLowerCase()
      const cls = ((e.className as string) || '').toLowerCase()
      const mod = ((e.module as string) || '').toLowerCase()
      if (table === resourceNorm || table === prefixedTable) return true
      if (cls.includes(moduleSingular) && cls.includes(resourceSingular)) return true
      if (mod === moduleSegment && cls.includes(resourceSingular)) return true
      if (cls === resourceSingular || cls.includes(resourceSingular)) return true
      return false
    }) || null

    let relatedEntity: string | null = null
    if (entity) {
      const ent = entity as Record<string, unknown>
      const rels = (ent.relationships as Array<{ relationship: string; target: string }>) || []
      const relSummary = rels.map((r) => `${r.relationship}: ${r.target}`).join(', ')
      relatedEntity = `${ent.className}${relSummary ? ` (${relSummary})` : ''}`
    }

    // GET endpoints: include query parameters compactly
    const parameters = method.toLowerCase() === 'get'
      ? (endpoint.parameters as Array<Record<string, unknown>> || [])
          .filter((p) => p.in === 'query')
          .map((p) => p.name as string)
      : undefined

    return {
      path,
      method: method.toUpperCase(),
      summary: endpoint.summary || endpoint.description,
      ...(parameters && parameters.length > 0 ? { queryParams: parameters } : {}),
      ...(requiredFields.length > 0 ? { requiredFields } : {}),
      ...(optionalFields.length > 0 ? { optionalFields } : {}),
      ...(nestedCollections.length > 0 ? { nestedCollections } : {}),
      ...(Object.keys(example).length > 0 ? { example } : {}),
      ...(relatedEndpoints.length > 0 ? { relatedEndpoints } : {}),
      relatedEntity,
    }
  }

  /**
   * spec.describeEntity(keyword) — find entity by keyword and return its full schema.
   * Returns: { className, tableName, module, fields, relationships }
   */
  spec.describeEntity = (keyword: string) => {
    const kw = keyword.toLowerCase()
    return entitySchemas.find((e: Record<string, unknown>) => {
      const cls = (e.className as string || '').toLowerCase()
      const table = (e.tableName as string || '').toLowerCase()
      return cls.includes(kw) || table.includes(kw)
    }) || null
  }

  cachedCodeModeSpec = spec
  return spec
}

/**
 * Extract the JSON Schema from an OpenAPI endpoint's requestBody.
 * Handles the common `content['application/json'].schema` path.
 */
function extractRequestBodySchema(
  endpoint: Record<string, unknown>
): Record<string, unknown> | null {
  const requestBody = endpoint.requestBody as Record<string, unknown> | undefined
  if (!requestBody) return null

  const content = requestBody.content as Record<string, Record<string, unknown>> | undefined
  if (!content) return null

  const jsonContent = content['application/json']
  if (!jsonContent) return null

  return (jsonContent.schema as Record<string, unknown>) || null
}

/**
 * Generate a placeholder value for a given JSON Schema type.
 */
function generatePlaceholder(type: string, format?: string): unknown {
  if (format === 'uuid' || format === 'objectId') return '<uuid>'
  if (format === 'date-time' || format === 'date') return '<date>'
  if (format === 'email') return '<email>'
  switch (type) {
    case 'string': return '<string>'
    case 'number':
    case 'integer': return 0
    case 'boolean': return false
    case 'array': return []
    default: return '<value>'
  }
}

/**
 * Common CRUD endpoints to pre-generate types for.
 * These are the endpoints the agent uses most and where debug spirals happen.
 */
const COMMON_ENDPOINTS: Array<{ path: string; method: string; typeName: string }> = [
  { path: '/api/sales/quotes', method: 'post', typeName: 'CreateQuote' },
  { path: '/api/sales/orders', method: 'post', typeName: 'CreateOrder' },
  { path: '/api/sales/invoices', method: 'post', typeName: 'CreateInvoice' },
  { path: '/api/customers/companies', method: 'post', typeName: 'CreateCompany' },
  { path: '/api/customers/people', method: 'post', typeName: 'CreatePerson' },
  { path: '/api/customers/deals', method: 'post', typeName: 'CreateDeal' },
  { path: '/api/catalog/products', method: 'post', typeName: 'CreateProduct' },
  { path: '/api/customers/companies', method: 'put', typeName: 'UpdateCompany' },
  { path: '/api/customers/people', method: 'put', typeName: 'UpdatePerson' },
  { path: '/api/sales/quotes', method: 'put', typeName: 'UpdateQuote' },
]

/**
 * Generate TypeScript-like type stubs from the OpenAPI spec for common endpoints.
 * This runs once at startup and injects types into the execute tool description
 * so the LLM sees the correct payload shape without needing to call describeEndpoint.
 */
async function generateCommonTypes(): Promise<string> {
  if (cachedCommonTypes) return cachedCommonTypes

  const rawSpec = await getRawOpenApiSpec()
  if (!rawSpec?.paths) {
    cachedCommonTypes = ''
    return ''
  }

  const paths = rawSpec.paths as Record<string, Record<string, unknown>>
  const typeLines: string[] = ['Available types for api.request() body:\n']

  for (const { path, method, typeName } of COMMON_ENDPOINTS) {
    const pathObj = paths[path] as Record<string, unknown> | undefined
    if (!pathObj) continue

    const endpoint = pathObj[method] as Record<string, unknown> | undefined
    if (!endpoint) continue

    const bodySchema = extractRequestBodySchema(endpoint)
    if (!bodySchema?.properties) continue

    const typeStr = schemaToTypeString(
      typeName,
      bodySchema,
      `${method.toUpperCase()} ${path}`,
    )
    if (typeStr) typeLines.push(typeStr)
  }

  if (typeLines.length <= 1) {
    cachedCommonTypes = ''
    return ''
  }

  cachedCommonTypes = typeLines.join('\n')
  console.error(`[Code Mode] Generated ${typeLines.length - 1} common type stubs`)
  return cachedCommonTypes
}

/**
 * Convert a JSON Schema object to a compact TypeScript-like type string.
 * Produces a single-line or multi-line type declaration the LLM can use directly.
 */
function schemaToTypeString(
  typeName: string,
  schema: Record<string, unknown>,
  comment: string,
): string | null {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!props) return null

  const required = new Set((schema.required as string[]) || [])

  // Skip internal fields that the sandbox injects automatically
  const skipFields = new Set(['tenantId', 'organizationId'])

  const fields: string[] = []
  const nestedTypes: string[] = []

  for (const [name, prop] of Object.entries(props)) {
    if (skipFields.has(name)) continue
    if (!prop || typeof prop !== 'object') continue

    const isRequired = required.has(name)
    const optMark = isRequired ? '' : '?'

    // Detect nested array of objects → extract as separate type
    if (
      prop.type === 'array' &&
      prop.items &&
      (prop.items as Record<string, unknown>).type === 'object'
    ) {
      const itemTypeName = `${typeName}${capitalize(singularize(name))}`
      const itemSchema = prop.items as Record<string, unknown>
      const nestedType = schemaToTypeString(itemTypeName, itemSchema, '')
      if (nestedType) nestedTypes.push(nestedType)
      fields.push(`${name}${optMark}: ${itemTypeName}[]`)
      continue
    }

    const propType = resolvePropertyType(prop)
    fields.push(`${name}${optMark}: ${propType}`)
  }

  if (fields.length === 0) return null

  const commentLine = comment ? `// ${comment}\n` : ''
  const nested = nestedTypes.length > 0 ? nestedTypes.join('\n') + '\n' : ''
  return `${nested}${commentLine}type ${typeName} = { ${fields.join('; ')} }`
}

/**
 * Resolve a JSON Schema property to a compact TypeScript type string.
 */
function resolvePropertyType(prop: Record<string, unknown>): string {
  // Handle anyOf (nullable types)
  if (prop.anyOf && Array.isArray(prop.anyOf)) {
    const variants = (prop.anyOf as Array<Record<string, unknown> | null>).filter(
      (s): s is Record<string, unknown> => s != null,
    )
    const nonNull = variants.filter((s) => s.type !== 'null')
    if (nonNull.length === 1) {
      return resolvePropertyType(nonNull[0]) + ' | null'
    }
    if (nonNull.length > 1) {
      return nonNull.map((s) => resolvePropertyType(s)).join(' | ')
    }
  }

  // Handle enum
  if (prop.enum && Array.isArray(prop.enum)) {
    return (prop.enum as string[]).map((v) => `'${v}'`).join(' | ')
  }

  const type = prop.type as string
  const format = prop.format as string | undefined

  if (type === 'array') {
    const items = prop.items as Record<string, unknown> | undefined
    if (items) return `${resolvePropertyType(items)}[]`
    return 'unknown[]'
  }

  if (type === 'object') return 'object'

  if (format === 'uuid') return 'string /*uuid*/'
  if (format === 'date-time') return 'string /*ISO date*/'
  if (format === 'date') return 'string /*date*/'
  if (format === 'email') return 'string /*email*/'

  switch (type) {
    case 'string': return 'string'
    case 'number':
    case 'integer': return 'number'
    case 'boolean': return 'boolean'
    default: return 'unknown'
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function singularize(s: string): string {
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y'
  if (s.endsWith('ses')) return s.slice(0, -2)
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1)
  return s
}

/**
 * Format a 400 API error response into a human-readable fix instruction.
 * Parses Zod-style validation errors and produces a concise message the LLM can act on.
 */
function formatValidationError(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return `Validation error: ${JSON.stringify(data)}`
  }

  // Raw Zod v4 array format: [{ expected, code, path, message }]
  if (Array.isArray(data)) {
    const issues = data as Array<Record<string, unknown>>
    const parts = issues.slice(0, 5).map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join('.') : ''
      const msg = issue.message as string || `expected ${issue.expected}` || issue.code as string || 'invalid'
      return path ? `${path}: ${msg}` : msg
    })
    if (parts.length > 0) {
      return `Validation failed — ${parts.join('; ')}. Fix the listed fields and retry.`
    }
  }

  const obj = data as Record<string, unknown>

  // Zod v4 flat format: { fieldErrors: { field: [messages] }, formErrors: [messages] }
  if (obj.fieldErrors && typeof obj.fieldErrors === 'object') {
    const fieldErrors = obj.fieldErrors as Record<string, string[]>
    const parts: string[] = []
    for (const [field, messages] of Object.entries(fieldErrors)) {
      if (Array.isArray(messages) && messages.length > 0) {
        parts.push(`${field}: ${messages[0]}`)
      }
    }
    const formErrors = obj.formErrors as string[] | undefined
    if (Array.isArray(formErrors) && formErrors.length > 0) {
      parts.push(formErrors[0])
    }
    if (parts.length > 0) {
      return `Validation failed — ${parts.join('; ')}. Fix the listed fields and retry.`
    }
  }

  // Zod v3 format: { issues: [{ path: [...], message, code }] }
  if (obj.issues && Array.isArray(obj.issues)) {
    const issues = obj.issues as Array<Record<string, unknown>>
    const parts = issues.slice(0, 5).map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join('.') : ''
      const msg = issue.message as string || issue.code as string || 'invalid'
      return path ? `${path}: ${msg}` : msg
    })
    return `Validation failed — ${parts.join('; ')}. Fix the listed fields and retry.`
  }

  // Our API error format: { error: string, details: ... }
  if (obj.error && typeof obj.error === 'string') {
    const details = obj.details
    if (details && typeof details === 'object') {
      return formatValidationError(details)
    }
    return obj.error
  }

  // Generic: { message: string }
  if (obj.message && typeof obj.message === 'string') {
    return obj.message
  }

  // Fallback: compact JSON
  const json = JSON.stringify(data)
  if (json.length > 500) {
    return `Validation error (truncated): ${json.slice(0, 500)}...`
  }
  return `Validation error: ${json}`
}

/**
 * Build entity schema array from the entity graph.
 * Same structure as buildEntityResult in entity-graph-tools.ts.
 */
function buildEntitySchemas(graph: EntityGraph) {
  return graph.nodes.map((node) => {
    const relationships = graph.edges
      .filter((edge) => edge.source === node.className)
      .map((edge) => ({
        relationship: edge.relationship,
        target: edge.target,
        property: edge.property,
        nullable: edge.nullable,
      }))

    return {
      className: node.className,
      tableName: node.tableName,
      module: inferModuleFromEntity(node.className, node.tableName),
      fields: node.properties,
      relationships,
    }
  })
}

/**
 * Detect mutation HTTP methods in code via static analysis.
 * Returns which methods were found (POST, PUT, PATCH, DELETE).
 */
function detectMutationInCode(code: string): { hasMutation: boolean; methods: string[] } {
  const methods: string[] = []
  const pattern = /method:\s*['"](\w+)['"]/gi
  let match
  while ((match = pattern.exec(code)) !== null) {
    const method = match[1].toUpperCase()
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      methods.push(method)
    }
  }
  return { hasMutation: methods.length > 0, methods }
}

/**
 * Load and register the two Code Mode tools.
 * Generates TypeScript type stubs for common endpoints at startup.
 * @returns Number of tools registered (always 2)
 */
export async function loadCodeModeTools(): Promise<number> {
  const commonTypes = await generateCommonTypes()
  registerSearchTool()
  registerExecuteTool(commonTypes)
  return 2
}

/**
 * search — Query the OpenAPI spec and entity graph programmatically.
 */
function registerSearchTool(): void {
  registerMcpTool(
    {
      name: 'search',
      description: `Query the OpenAPI spec and entity schemas. READ-ONLY, no side effects.
Globals: spec.findEndpoints(keyword), spec.describeEndpoint(path, method), spec.describeEntity(keyword), spec.paths, spec.entitySchemas.
Use BEFORE execute to learn endpoint schemas for CREATE/UPDATE. Skip for common paths (companies, people, orders, quotes, products).`,
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            'An async arrow function that queries spec, e.g. async () => spec.paths["/api/customers/companies"]'
          ),
      }),
      requiredFeatures: [],
      handler: async (input: { code: string }, ctx: McpToolContext) => {
        const codePreview = input.code.slice(0, 120).replace(/\n/g, ' ')
        console.error(`[AI Usage] search: code="${codePreview}${input.code.length > 120 ? '...' : ''}"`)

        // Check session memory for cached result
        if (ctx.sessionId) {
          const cached = lookupSearchCache(ctx.sessionId, input.code)
          if (cached) {
            console.error(`[AI Usage] search: CACHE HIT (label="${cached.label}")`)
            const memoryContext = buildMemoryContext(ctx.sessionId)
            return {
              success: true,
              result: cached.result,
              fromCache: true,
              _memoryContext: memoryContext,
            }
          }

          // Enforce tool call limit
          const { count, exceeded } = incrementToolCallCount(ctx.sessionId)
          if (exceeded) {
            console.error(`[AI Usage] search: TOOL CALL LIMIT EXCEEDED (count=${count})`)
            return {
              success: false,
              error: 'Tool call limit exceeded. Summarize what you know and respond to the user.',
            }
          }
        }

        const spec = await getCodeModeSpec()
        const sandbox = createSandbox({ spec })
        const result = await sandbox.execute(input.code)

        if (result.error) {
          console.error(`[AI Usage] search: ERROR in ${result.durationMs}ms — ${result.error}`)
          return {
            success: false,
            error: result.error,
            logs: result.logs,
            durationMs: result.durationMs,
          }
        }

        const truncated = truncateResult(result.result)
        console.error(`[AI Usage] search: OK in ${result.durationMs}ms — ${truncated.length} chars`)

        // Store in session memory
        if (ctx.sessionId) {
          const label = buildSearchLabel(input.code)
          storeSearchResult(ctx.sessionId, input.code, truncated, label)
        }

        const memoryContext = ctx.sessionId ? buildMemoryContext(ctx.sessionId) : undefined
        return {
          success: true,
          result: truncated,
          logs: result.logs,
          durationMs: result.durationMs,
          _memoryContext: memoryContext,
        }
      },
    },
    { moduleId: 'codemode' }
  )
}

/**
 * execute — Run JavaScript that can make API calls via api.request().
 */
function registerExecuteTool(commonTypes: string): void {
  const typesBlock = commonTypes
    ? `\n\n${commonTypes}`
    : ''

  registerMcpTool(
    {
      name: 'execute',
      description: `Make API calls. Returns JSON.
Globals: api.request({ method, path, query?, body? }) → { success, statusCode, data }, context { tenantId, organizationId, userId }.
RULES: For FIND/LIST → GET only (1 call). For UPDATE → PUT to collection path with id in BODY. NEVER PUT/POST/DELETE unless user explicitly asked to change data. Before ANY write operation (POST/PUT/DELETE), you MUST use the AskUserQuestion tool to get explicit user confirmation. Do NOT just ask in text — use the tool so execution pauses until the user responds.${typesBlock}`,
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            'Async arrow function. For reads: async () => api.request({ method: "GET", path: "/api/customers/companies" }). For updates: async () => api.request({ method: "PUT", path: "/api/customers/companies", body: { id: "<uuid>", name: "New Name" } }). id goes in BODY not URL.'
          ),
      }),
      requiredFeatures: [], // ACL checked at API level
      handler: async (input: { code: string }, ctx: McpToolContext) => {
        const codePreview = input.code.slice(0, 120).replace(/\n/g, ' ')
        console.error(`[AI Usage] execute: code="${codePreview}${input.code.length > 120 ? '...' : ''}" user=${ctx.userId || 'unknown'}`)

        // Enforce tool call limit
        if (ctx.sessionId) {
          const { count, exceeded } = incrementToolCallCount(ctx.sessionId)
          if (exceeded) {
            console.error(`[AI Usage] execute: TOOL CALL LIMIT EXCEEDED (count=${count})`)
            return {
              success: false,
              error: 'Tool call limit exceeded. Summarize what you know and respond to the user.',
            }
          }
        }

        // Detect mutations via static analysis — cap API calls for safety
        const mutationInfo = detectMutationInCode(input.code)
        const maxApiCalls = mutationInfo.hasMutation ? 20 : 50
        if (mutationInfo.hasMutation) {
          console.error(`[AI Usage] execute: MUTATION DETECTED (${mutationInfo.methods.join(',')}) — capping API calls to ${maxApiCalls}`)
        }
        let apiCallCount = 0

        const apiRequestFn = createApiRequestFn(ctx, () => {
          apiCallCount++
          if (apiCallCount > maxApiCalls) {
            throw new Error(`API call limit exceeded (max ${maxApiCalls})`)
          }
        })

        const context = {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
        }

        const sandbox = createSandbox(
          { api: { request: apiRequestFn }, context },
          { maxApiCalls }
        )

        const result = await sandbox.execute(input.code)

        if (result.error) {
          console.error(`[AI Usage] execute: ERROR in ${result.durationMs}ms — apiCalls=${apiCallCount} — ${result.error}`)
          return {
            success: false,
            error: result.error,
            logs: result.logs,
            durationMs: result.durationMs,
            apiCallCount,
          }
        }

        const truncated = truncateResult(result.result)
        console.error(`[AI Usage] execute: OK in ${result.durationMs}ms — apiCalls=${apiCallCount} — ${truncated.length} chars`)

        const memoryContext = ctx.sessionId ? buildMemoryContext(ctx.sessionId) : undefined
        return {
          success: true,
          result: truncated,
          logs: result.logs,
          durationMs: result.durationMs,
          apiCallCount,
          _memoryContext: memoryContext,
        }
      },
    },
    { moduleId: 'codemode' }
  )
}

/**
 * Create the api.request() function for the execute sandbox.
 * Replicates the authenticated API call logic from api-discovery-tools.ts.
 */
function createApiRequestFn(
  ctx: McpToolContext,
  onCall: () => void
): (params: {
  method: string
  path: string
  query?: Record<string, string>
  body?: Record<string, unknown>
}) => Promise<unknown> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'

  return async (params) => {
    onCall()

    const { method, path, query, body } = params
    const callStart = Date.now()

    // Ensure path starts with /api
    const apiPath = path.startsWith('/api') ? path : `/api${path}`
    let url = `${baseUrl}${apiPath}`

    // Build query parameters
    const queryParams: Record<string, string> = { ...query }

    if (method === 'GET') {
      if (ctx.tenantId) queryParams.tenantId = ctx.tenantId
      if (ctx.organizationId) queryParams.organizationId = ctx.organizationId
    }

    if (Object.keys(queryParams).length > 0) {
      const separator = url.includes('?') ? '&' : '?'
      url += separator + new URLSearchParams(queryParams).toString()
    }

    // Build request body with context injection
    let requestBody: Record<string, unknown> | undefined
    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
      requestBody = { ...body }
      if (ctx.tenantId) requestBody.tenantId = ctx.tenantId
      if (ctx.organizationId) requestBody.organizationId = ctx.organizationId
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (ctx.apiKeySecret) headers['X-API-Key'] = ctx.apiKeySecret
    if (ctx.tenantId) headers['X-Tenant-Id'] = ctx.tenantId
    if (ctx.organizationId) headers['X-Organization-Id'] = ctx.organizationId

    // Execute request using host fetch (not sandbox)
    const response = await globalThis.fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: requestBody ? JSON.stringify(requestBody) : undefined,
    })

    const responseText = await response.text()
    const data = tryParseJson(responseText)
    const callDuration = Date.now() - callStart

    if (!response.ok) {
      console.error(`[AI Usage] api.request: ${method.toUpperCase()} ${apiPath} → ${response.status} in ${callDuration}ms`)

      // Format 400 validation errors into a clear fix instruction for the LLM
      if (response.status === 400) {
        return {
          success: false,
          statusCode: 400,
          error: formatValidationError(data),
        }
      }

      return {
        success: false,
        statusCode: response.status,
        error: `API error ${response.status}`,
        details: data,
      }
    }

    console.error(`[AI Usage] api.request: ${method.toUpperCase()} ${apiPath} → ${response.status} in ${callDuration}ms (${responseText.length} bytes)`)

    // Add mutation warning for non-GET calls
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
      return {
        success: true,
        statusCode: response.status,
        data,
        _note: 'WRITE operation performed. Only do writes when user explicitly requested data modification.',
      }
    }

    return {
      success: true,
      statusCode: response.status,
      data,
    }
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
