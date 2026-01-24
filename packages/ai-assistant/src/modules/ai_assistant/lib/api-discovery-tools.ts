/**
 * API Discovery Tools
 *
 * Meta-tools for discovering and executing API endpoints via search.
 *
 * 2 tools total:
 * - find_api: Search for endpoints (includes schema summary)
 * - call_api: Execute an endpoint
 */

import { z } from 'zod'
import { registerMcpTool } from './tool-registry'
import type { McpToolContext } from './types'
import {
  getApiEndpoints,
  searchEndpoints,
  simplifyRequestBodySchema,
} from './api-endpoint-index'

/**
 * Load API discovery tools into the registry
 */
export async function loadApiDiscoveryTools(): Promise<number> {
  // Ensure endpoints are parsed and cached
  const endpoints = await getApiEndpoints()
  console.error(`[API Discovery] ${endpoints.length} endpoints available for discovery`)

  // Register the two discovery tools
  registerApiDiscoverTool()
  registerApiExecuteTool()

  return 2
}

/**
 * find_api - Find relevant API endpoints based on a query.
 * Enhanced to include request body schema summary.
 */
function registerApiDiscoverTool(): void {
  registerMcpTool(
    {
      name: 'find_api',
      description: `Search for API endpoints by keyword. Use AFTER understand_entity if you need more endpoint options.

NOTE: understand_entity already returns the main CRUD endpoints for an entity.
Use find_api only when:
- understand_entity didn't show the endpoint you need
- You need to search for a specific action across modules
- You're looking for non-CRUD endpoints

OUTPUT includes:
- method, path, operationId
- requestBody schema with required fields

EXAMPLES:
- "customer comments" - Find comment-related APIs
- "export orders" - Find export functionality
- "bulk update" - Find bulk operations`,
      inputSchema: z.object({
        query: z
          .string()
          .describe('Natural language query to find relevant endpoints (e.g., "create customer", "list orders")'),
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
            suggestions: [
              'Try broader terms like "customer" or "order"',
              'Use method filter to narrow results (e.g., method: "POST")',
              'Use list_entities to find entity names, then understand_entity to get endpoints',
            ],
          }
        }

        // Format results for LLM consumption - now includes schema
        const results = matches.map((endpoint) => {
          const result: Record<string, unknown> = {
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
          }

          // Include request body schema for mutation endpoints
          if (endpoint.requestBodySchema) {
            const simplifiedSchema = simplifyRequestBodySchema(endpoint.requestBodySchema)
            if (simplifiedSchema) {
              result.requestBody = simplifiedSchema
            }
          }

          return result
        })

        return {
          success: true,
          message: `Found ${results.length} matching endpoint(s)`,
          endpoints: results,
          hint: 'Use call_api with method, path, and body to execute the endpoint.',
        }
      },
    },
    { moduleId: 'api' }
  )
}

/**
 * call_api - Execute an API endpoint
 */
function registerApiExecuteTool(): void {
  registerMcpTool(
    {
      name: 'call_api',
      description: `Execute an API call. Use AFTER understand_entity to get the endpoint path and required fields.

⚠️ WARNING: This tool can MODIFY and DELETE data!

WORKFLOW:
1. FIRST: Call understand_entity to get fields and endpoints
2. For mutations (POST/PUT/DELETE): Confirm with user
3. Then call this tool with the endpoint from understand_entity

METHODS:
- GET: Read data (safe)
- POST: Create new record
- PUT/PATCH: Update record
- DELETE: Remove record (ALWAYS confirm first!)

PARAMETERS:
- method: HTTP method
- path: API path from understand_entity (e.g., /api/customers/companies)
- body: Request body with required fields from understand_entity`,
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
 * Try to parse JSON, return original string if fails
 */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
