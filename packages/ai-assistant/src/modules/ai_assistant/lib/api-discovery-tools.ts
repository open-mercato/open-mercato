/**
 * API Discovery Tools
 *
 * Meta-tools for discovering and executing API endpoints via search.
 * Replaces 400+ individual endpoint tools with 3 flexible tools.
 */

import { z } from 'zod'
import { registerMcpTool } from './tool-registry'
import type { McpToolContext } from './types'
import {
  getApiEndpoints,
  getEndpointByOperationId,
  searchEndpoints,
  type ApiEndpoint,
} from './api-endpoint-index'

/**
 * Load API discovery tools into the registry
 */
export async function loadApiDiscoveryTools(): Promise<number> {
  // Ensure endpoints are parsed and cached
  const endpoints = await getApiEndpoints()
  console.error(`[API Discovery] ${endpoints.length} endpoints available for discovery`)

  // Register the three discovery tools
  registerApiDiscoverTool()
  registerApiExecuteTool()
  registerApiSchemaTool()

  return 3
}

/**
 * api_discover - Find relevant API endpoints based on a query
 */
function registerApiDiscoverTool(): void {
  registerMcpTool(
    {
      name: 'api_discover',
      description: `Find API endpoints in Open Mercato by keyword or action.

CAPABILITIES: This tool searches 400+ endpoints that can CREATE, READ, UPDATE, and DELETE
data across all modules (customers, products, orders, shipments, invoices, etc.).

SEARCH: Uses hybrid search (fulltext + vector) for best results. You can filter by HTTP method.

EXAMPLES:
- "customer endpoints" - Find all customer-related APIs
- "create order" - Find endpoint to create new orders
- "delete product" - Find endpoint to delete products (confirm with user before executing!)
- "update company name" - Find endpoint to modify companies
- "search customers" - Find search/list endpoints

Returns: method, path, description, and operationId for each match.
Use operationId with api_schema to get detailed parameter info before calling api_execute.`,
      inputSchema: z.object({
        query: z
          .string()
          .describe('Natural language query to find relevant endpoints (e.g., "customer list")'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
          .optional()
          .describe('Filter by HTTP method'),
        limit: z.number().optional().default(10).describe('Max results to return (default: 10)'),
      }),
      requiredFeatures: [], // Available to all authenticated users
      handler: async (input: { query: string; method?: string; limit?: number }, ctx) => {
        const { query, method, limit = 10 } = input

        // Search for matching endpoints
        const searchService = ctx.container?.resolve<any>('searchService')
        const matches = await searchEndpoints(searchService, query, { limit, method })

        if (matches.length === 0) {
          return {
            success: true,
            message: 'No matching endpoints found. Try different search terms.',
            endpoints: [],
          }
        }

        // Format results for LLM consumption
        const results = matches.map((endpoint) => ({
          operationId: endpoint.operationId,
          method: endpoint.method,
          path: endpoint.path,
          description: endpoint.description || endpoint.summary,
          tags: endpoint.tags,
          parameters: endpoint.parameters.map((p) => ({
            name: p.name,
            in: p.in,
            required: p.required,
            type: p.type,
          })),
          hasRequestBody: endpoint.requestBodySchema !== null,
        }))

        return {
          success: true,
          message: `Found ${results.length} matching endpoint(s)`,
          endpoints: results,
          hint: 'Use api_schema to get detailed parameter info, or api_execute to call an endpoint',
        }
      },
    },
    { moduleId: 'api' }
  )
}

/**
 * api_execute - Execute an API endpoint
 */
function registerApiExecuteTool(): void {
  registerMcpTool(
    {
      name: 'api_execute',
      description: `Execute an API call to CREATE, READ, UPDATE, or DELETE data in Open Mercato.

WARNING: This tool can MODIFY and DELETE data. Be careful with mutations!

METHODS:
- GET: Read/search data (safe, no confirmation needed)
- POST: Create new records (confirm data with user first)
- PUT/PATCH: Update existing records (confirm changes with user)
- DELETE: Remove records permanently (ALWAYS confirm with user before executing!)

WORKFLOW:
1. First use api_discover to find the right endpoint
2. Use api_schema to understand required parameters
3. For POST/PUT/PATCH/DELETE: Confirm with user what will be changed
4. Execute the call with proper parameters

PARAMETERS:
- method: HTTP method (GET, POST, PUT, PATCH, DELETE)
- path: API path with parameters replaced (e.g., /customers/companies/123)
- query: Query parameters as key-value object (for GET requests and filtering)
- body: Request body for POST/PUT/PATCH (object with required fields)`,
      inputSchema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method'),
        path: z
          .string()
          .describe('API path with parameters replaced (e.g., /customers/123, /orders)'),
        query: z
          .record(z.string(), z.string())
          .optional()
          .describe('Query parameters as key-value pairs'),
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Request body for POST/PUT/PATCH requests'),
      }),
      requiredFeatures: [], // ACL checked at API level
      handler: async (
        input: {
          method: string
          path: string
          query?: Record<string, string>
          body?: Record<string, unknown>
        },
        ctx: McpToolContext
      ) => {
        const { method, path, query, body } = input

        // Build URL
        const baseUrl =
          process.env.NEXT_PUBLIC_API_BASE_URL ||
          process.env.NEXT_PUBLIC_APP_URL ||
          process.env.APP_URL ||
          'http://localhost:3000'

        // Ensure path starts with /api
        const apiPath = path.startsWith('/api') ? path : `/api${path}`
        let url = `${baseUrl}${apiPath}`

        // Add query parameters
        const queryParams = { ...query }

        // Add context to query for GET, to body for mutations
        if (method === 'GET') {
          if (ctx.tenantId) queryParams.tenantId = ctx.tenantId
          if (ctx.organizationId) queryParams.organizationId = ctx.organizationId
        }

        if (Object.keys(queryParams).length > 0) {
          const separator = url.includes('?') ? '&' : '?'
          url += separator + new URLSearchParams(queryParams).toString()
        }

        // Build body with context
        let requestBody: Record<string, unknown> | undefined
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
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

        // Execute request
        try {
          const response = await fetch(url, {
            method,
            headers,
            body: requestBody ? JSON.stringify(requestBody) : undefined,
          })

          const responseText = await response.text()

          if (!response.ok) {
            return {
              success: false,
              statusCode: response.status,
              error: `API error ${response.status}`,
              details: tryParseJson(responseText),
            }
          }

          return {
            success: true,
            statusCode: response.status,
            data: tryParseJson(responseText),
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Request failed',
          }
        }
      },
    },
    { moduleId: 'api' }
  )
}

/**
 * api_schema - Get detailed schema for an endpoint
 */
function registerApiSchemaTool(): void {
  registerMcpTool(
    {
      name: 'api_schema',
      description: `Get detailed schema for an API endpoint before executing it.

IMPORTANT: Always check the schema before calling POST, PUT, PATCH, or DELETE endpoints
to understand what parameters are required.

USAGE:
- Use the operationId from api_discover results
- Returns: path parameters, query parameters, and request body schema
- Shows which fields are required vs optional
- Includes field types and descriptions

This helps you construct the correct api_execute call with all required data.`,
      inputSchema: z.object({
        operationId: z.string().describe('Operation ID from api_discover results'),
      }),
      requiredFeatures: [],
      handler: async (input: { operationId: string }) => {
        const endpoint = await getEndpointByOperationId(input.operationId)

        if (!endpoint) {
          return {
            success: false,
            error: `Endpoint not found: ${input.operationId}`,
            hint: 'Use api_discover to find available endpoints',
          }
        }

        return {
          success: true,
          endpoint: {
            operationId: endpoint.operationId,
            method: endpoint.method,
            path: endpoint.path,
            description: endpoint.description,
            tags: endpoint.tags,
            deprecated: endpoint.deprecated,
            requiredFeatures: endpoint.requiredFeatures,
            parameters: endpoint.parameters,
            requestBodySchema: endpoint.requestBodySchema,
          },
          usage: buildUsageExample(endpoint),
        }
      },
    },
    { moduleId: 'api' }
  )
}

/**
 * Build usage example for an endpoint
 */
function buildUsageExample(endpoint: ApiEndpoint): string {
  const pathParams = endpoint.parameters.filter((p) => p.in === 'path')
  const queryParams = endpoint.parameters.filter((p) => p.in === 'query')

  let example = `api_execute with:\n  method: "${endpoint.method}"\n  path: "${endpoint.path}"`

  if (pathParams.length > 0) {
    example += `\n  (replace ${pathParams.map((p) => `{${p.name}}`).join(', ')} in path)`
  }

  if (queryParams.length > 0) {
    const queryExample = queryParams
      .slice(0, 3)
      .map((p) => `"${p.name}": "..."`)
      .join(', ')
    example += `\n  query: { ${queryExample} }`
  }

  if (endpoint.requestBodySchema) {
    example += `\n  body: { ... } (see requestBodySchema above)`
  }

  return example
}

/**
 * Try to parse JSON, return original string if fails
 */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
