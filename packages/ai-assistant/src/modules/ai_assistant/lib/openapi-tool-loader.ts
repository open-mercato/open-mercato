import { z } from 'zod'
import { buildOpenApiDocument, sanitizeOpenApiDocument } from '@open-mercato/shared/lib/openapi'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'
import { registerMcpTool, toolRegistry } from './tool-registry'
import type { McpToolDefinition, McpToolContext } from './types'

/**
 * OpenAPI operation structure (simplified from full OpenAPI spec)
 */
interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Array<{
    name: string
    in: 'path' | 'query' | 'header'
    required?: boolean
    schema?: JsonSchema
    description?: string
  }>
  requestBody?: {
    required?: boolean
    content?: {
      'application/json'?: {
        schema?: JsonSchema
      }
    }
  }
  responses?: Record<string, unknown>
  'x-require-features'?: string[]
  'x-require-auth'?: boolean
  deprecated?: boolean
}

/**
 * JSON Schema structure (simplified)
 */
interface JsonSchema {
  type?: string
  format?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
  enum?: unknown[]
  $ref?: string
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  nullable?: boolean
  default?: unknown
  description?: string
}

/**
 * Valid HTTP methods for tool generation
 */
const VALID_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const
type ValidMethod = (typeof VALID_METHODS)[number]

function isValidMethod(method: string): method is ValidMethod {
  return VALID_METHODS.includes(method.toLowerCase() as ValidMethod)
}

/**
 * Load MCP tools from OpenAPI documentation.
 * This fills the gap by adding GET/list endpoints that the command registry doesn't expose.
 */
export async function loadOpenApiTools(): Promise<number> {
  // 1. Import modules dynamically to avoid circular dependencies
  let modules: unknown
  try {
    const modulesImport = await import('@/generated/modules.generated')
    modules = modulesImport.modules
  } catch (error) {
    console.error('[OpenAPI Tools] Could not import modules.generated:', error)
    return 0
  }

  // 2. Build OpenAPI spec
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'

  const rawDoc = buildOpenApiDocument(modules as any, {
    title: 'Open Mercato API',
    version: '1.0.0',
    servers: [{ url: baseUrl }],
    baseUrlForExamples: baseUrl,
  })
  const doc = sanitizeOpenApiDocument(rawDoc) as OpenApiDocument

  // 3. Parse endpoints into tool definitions
  const tools = parseOpenApiToTools(doc, baseUrl)

  // 4. Register tools (skip duplicates - command tools have priority)
  let registered = 0
  let skipped = 0

  for (const tool of tools) {
    if (toolRegistry.getTool(tool.name)) {
      // Command-derived or other tool already exists, skip
      skipped++
      continue
    }
    registerMcpTool(tool, { moduleId: 'openapi' })
    registered++
  }

  if (skipped > 0) {
    console.error(`[OpenAPI Tools] Skipped ${skipped} tools (already registered by commands)`)
  }

  return registered
}

/**
 * Convert OpenAPI operations to MCP tool definitions
 */
function parseOpenApiToTools(doc: OpenApiDocument, baseUrl: string): McpToolDefinition[] {
  const tools: McpToolDefinition[] = []

  if (!doc.paths) {
    return tools
  }

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isValidMethod(method)) continue
      if (!operation || typeof operation !== 'object') continue

      const op = operation as OpenApiOperation

      // Skip deprecated endpoints
      if (op.deprecated) continue

      const tool = buildToolFromOperation(path, method, op, baseUrl, doc.components?.schemas)
      if (tool) {
        tools.push(tool)
      }
    }
  }

  return tools
}

/**
 * Build a single tool from an OpenAPI operation
 */
function buildToolFromOperation(
  path: string,
  method: string,
  operation: OpenApiOperation,
  baseUrl: string,
  schemas?: Record<string, JsonSchema>
): McpToolDefinition | null {
  const toolName = buildToolName(path, method, operation.operationId)
  const inputSchema = buildInputSchema(operation, schemas)
  const description = buildDescription(operation, path, method)

  return {
    name: toolName,
    description,
    inputSchema,
    requiredFeatures: operation['x-require-features'] || [],
    handler: createHttpHandler(path, method, operation, baseUrl),
  }
}

/**
 * Build tool name from path and method.
 * Uses operationId if available, otherwise derives from path.
 */
function buildToolName(path: string, method: string, operationId?: string): string {
  // Use operationId if available, normalized to underscore format
  if (operationId) {
    return operationId.replace(/[.-]/g, '_')
  }

  // Derive from path: /customers/people → customers_people
  // /customers/people/{id} → customers_people_id
  const pathParts = path
    .replace(/^\//, '') // Remove leading slash
    .replace(/\{([^}]+)\}/g, '$1') // {id} → id
    .split('/')
    .filter(Boolean)
    .join('_')

  const action = methodToAction(method, path)
  return `api_${pathParts}_${action}`
}

/**
 * Map HTTP method to action name
 */
function methodToAction(method: string, path: string): string {
  const hasIdParam = path.includes('{')

  const map: Record<string, string> = {
    get: hasIdParam ? 'get' : 'list',
    post: 'create',
    put: 'update',
    patch: 'patch',
    delete: 'delete',
  }

  return map[method.toLowerCase()] || method.toLowerCase()
}

/**
 * Build description from operation metadata
 */
function buildDescription(operation: OpenApiOperation, path: string, method: string): string {
  if (operation.description) {
    return operation.description
  }
  if (operation.summary) {
    return operation.summary
  }
  return `${method.toUpperCase()} ${path}`
}

/**
 * Build Zod input schema from OpenAPI parameters + requestBody
 */
function buildInputSchema(
  operation: OpenApiOperation,
  schemas?: Record<string, JsonSchema>
): z.ZodType {
  const shape: Record<string, z.ZodType> = {}

  // Add path and query parameters
  for (const param of operation.parameters || []) {
    if (param.in === 'path' || param.in === 'query') {
      const paramSchema = resolveSchema(param.schema, schemas)
      shape[param.name] = jsonSchemaToZod(paramSchema, param.required ?? false)

      // Add description if available
      if (param.description && shape[param.name]) {
        shape[param.name] = shape[param.name].describe(param.description)
      }
    }
  }

  // Add request body properties (for POST/PUT/PATCH)
  const bodySchema = operation.requestBody?.content?.['application/json']?.schema
  if (bodySchema) {
    const resolvedBody = resolveSchema(bodySchema, schemas)

    if (resolvedBody?.properties) {
      const requiredFields = resolvedBody.required || []

      for (const [key, propSchema] of Object.entries(resolvedBody.properties)) {
        // Skip context fields (auto-injected by handler)
        if (['tenantId', 'organizationId'].includes(key)) continue

        const isRequired = requiredFields.includes(key)
        const resolved = resolveSchema(propSchema, schemas)
        shape[key] = jsonSchemaToZod(resolved, isRequired)

        // Add description if available
        if (resolved?.description && shape[key]) {
          shape[key] = shape[key].describe(resolved.description)
        }
      }
    }
  }

  return z.object(shape)
}

/**
 * Resolve $ref references in JSON Schema
 */
function resolveSchema(
  schema: JsonSchema | undefined,
  schemas?: Record<string, JsonSchema>
): JsonSchema | undefined {
  if (!schema) return undefined

  // Handle $ref
  if (schema.$ref && schemas) {
    const refPath = schema.$ref.replace('#/components/schemas/', '')
    return schemas[refPath] || schema
  }

  return schema
}

/**
 * Convert JSON Schema to Zod schema (simplified conversion)
 */
function jsonSchemaToZod(schema: JsonSchema | undefined, required: boolean): z.ZodType {
  if (!schema) {
    return required ? z.unknown() : z.unknown().optional()
  }

  let zodType: z.ZodType

  // Handle oneOf/anyOf as union
  if (schema.oneOf || schema.anyOf) {
    const options = (schema.oneOf || schema.anyOf)!
    if (options.length === 1) {
      return jsonSchemaToZod(options[0], required)
    }
    // For complex unions, use unknown
    zodType = z.unknown()
  } else if (schema.allOf) {
    // For allOf, try to merge or use unknown
    zodType = z.unknown()
  } else {
    switch (schema.type) {
      case 'string':
        zodType = buildStringSchema(schema)
        break
      case 'number':
      case 'integer':
        zodType = z.number()
        break
      case 'boolean':
        zodType = z.boolean()
        break
      case 'array':
        zodType = z.array(jsonSchemaToZod(schema.items, false))
        break
      case 'object':
        if (schema.properties) {
          const objShape: Record<string, z.ZodType> = {}
          const requiredProps = schema.required || []
          for (const [key, propSchema] of Object.entries(schema.properties)) {
            objShape[key] = jsonSchemaToZod(propSchema, requiredProps.includes(key))
          }
          zodType = z.object(objShape)
        } else {
          zodType = z.record(z.string(), z.unknown())
        }
        break
      case 'null':
        zodType = z.null()
        break
      default:
        zodType = z.unknown()
    }
  }

  // Handle nullable
  if (schema.nullable) {
    zodType = zodType.nullable()
  }

  // Handle enum
  if (schema.enum && schema.enum.length > 0) {
    const enumValues = schema.enum as [string, ...string[]]
    if (enumValues.every((v) => typeof v === 'string')) {
      zodType = z.enum(enumValues as [string, ...string[]])
    }
  }

  // Handle default
  if (schema.default !== undefined) {
    zodType = zodType.default(schema.default)
  }

  return required ? zodType : zodType.optional()
}

/**
 * Build string schema with format validation
 */
function buildStringSchema(schema: JsonSchema): z.ZodString {
  let stringSchema = z.string()

  switch (schema.format) {
    case 'uuid':
      stringSchema = z.string().uuid()
      break
    case 'email':
      stringSchema = z.string().email()
      break
    case 'uri':
    case 'url':
      stringSchema = z.string().url()
      break
    case 'date-time':
      stringSchema = z.string().datetime()
      break
    case 'date':
      stringSchema = z.string().date()
      break
  }

  return stringSchema
}

/**
 * Create HTTP handler for API call
 */
function createHttpHandler(
  path: string,
  method: string,
  operation: OpenApiOperation,
  baseUrl: string
): McpToolDefinition['handler'] {
  return async (input: unknown, ctx: McpToolContext) => {
    const inputObj = (input || {}) as Record<string, unknown>

    // Build URL with path parameters (API routes require /api prefix)
    let url = `${baseUrl}/api${path}`
    const queryParams: Record<string, string> = {}
    const bodyParams: Record<string, unknown> = {}

    // Process parameters
    const paramNames = new Set<string>()
    for (const param of operation.parameters || []) {
      paramNames.add(param.name)
      const value = inputObj[param.name]

      if (value === undefined) continue

      if (param.in === 'path') {
        url = url.replace(`{${param.name}}`, encodeURIComponent(String(value)))
      } else if (param.in === 'query') {
        queryParams[param.name] = String(value)
      }
    }

    // Remaining params go to body (for POST/PUT/PATCH)
    const methodUpper = method.toUpperCase()
    if (['POST', 'PUT', 'PATCH'].includes(methodUpper)) {
      for (const [key, value] of Object.entries(inputObj)) {
        if (!paramNames.has(key) && value !== undefined) {
          bodyParams[key] = value
        }
      }

      // Add context (tenantId, organizationId)
      if (ctx.tenantId) bodyParams.tenantId = ctx.tenantId
      if (ctx.organizationId) bodyParams.organizationId = ctx.organizationId
    }

    // Add query string
    if (Object.keys(queryParams).length > 0) {
      const separator = url.includes('?') ? '&' : '?'
      url += separator + new URLSearchParams(queryParams).toString()
    }

    // Add tenant/org to query for GET requests
    if (methodUpper === 'GET') {
      const contextParams: Record<string, string> = {}
      if (ctx.tenantId) contextParams.tenantId = ctx.tenantId
      if (ctx.organizationId) contextParams.organizationId = ctx.organizationId

      if (Object.keys(contextParams).length > 0) {
        const separator = url.includes('?') ? '&' : '?'
        url += separator + new URLSearchParams(contextParams).toString()
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add auth headers if available
    if (ctx.apiKeySecret) headers['X-API-Key'] = ctx.apiKeySecret
    if (ctx.tenantId) headers['X-Tenant-Id'] = ctx.tenantId
    if (ctx.organizationId) headers['X-Organization-Id'] = ctx.organizationId

    // Make HTTP request
    try {
      const response = await fetch(url, {
        method: methodUpper,
        headers,
        body: ['POST', 'PUT', 'PATCH'].includes(methodUpper)
          ? JSON.stringify(bodyParams)
          : undefined,
      })

      const responseText = await response.text()

      if (!response.ok) {
        return {
          success: false,
          error: `API error ${response.status}: ${responseText}`,
          statusCode: response.status,
        }
      }

      // Try to parse as JSON
      try {
        const data = JSON.parse(responseText)
        return {
          success: true,
          data,
        }
      } catch {
        // Return as text if not JSON
        return {
          success: true,
          data: responseText,
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}
