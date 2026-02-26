/**
 * API Interceptor Contract
 *
 * Allows modules to hook into other modules' API routes —
 * validate, transform, or augment requests and responses.
 *
 * Interceptors operate at the HTTP/route level (outermost cross-module layer).
 * They run AFTER Zod validation (before) and BEFORE response enrichers (after).
 */

/**
 * Incoming request data available to interceptors.
 */
export interface InterceptorRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers: Record<string, string>
}

/**
 * Outgoing response data available to after-interceptors.
 */
export interface InterceptorResponse {
  statusCode: number
  body: Record<string, unknown>
  headers: Record<string, string>
}

/**
 * Context available to interceptors during execution.
 */
export interface InterceptorContext {
  userId: string
  organizationId: string
  tenantId: string
  em: unknown
  container: unknown
  userFeatures?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Result of a before-interceptor execution.
 *
 * - `ok: true` — request passes; optional body/query/headers modifications are forwarded.
 * - `ok: false` — request is rejected; optional message/statusCode describe the error.
 * - `metadata` — arbitrary data passed to subsequent interceptors and after-hooks.
 */
export interface InterceptorBeforeResult {
  ok: boolean
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, string>
  message?: string
  statusCode?: number
  metadata?: Record<string, unknown>
}

/**
 * Result of an after-interceptor execution.
 *
 * - `merge` — shallow-merge into the response body (additive).
 * - `replace` — replace the entire response body (use sparingly).
 */
export interface InterceptorAfterResult {
  merge?: Record<string, unknown>
  replace?: Record<string, unknown>
}

/**
 * API interceptor definition.
 *
 * Rules:
 * - `targetRoute` supports wildcards: 'example/todos' (exact), 'example/*' (prefix), '*' (all)
 * - `methods` restricts which HTTP methods this interceptor applies to
 * - At least one of `before` or `after` MUST be implemented
 * - `before` hooks run in priority order; first `ok: false` short-circuits
 * - `after` hooks run in priority order; merge/replace accumulate
 */
export interface ApiInterceptor {
  /** Unique identifier: `<module>.<interceptor-name>` */
  id: string

  /** Route pattern to intercept (supports wildcards: 'example/*', '*') */
  targetRoute: string

  /** HTTP methods this interceptor applies to */
  methods: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]

  /** Execution priority (higher = runs first). Default: 0 */
  priority?: number

  /** ACL features required for this interceptor to run */
  features?: string[]

  /** Maximum execution time in ms before the interceptor fails. Default: 5000 */
  timeoutMs?: number

  /** Pre-request hook: validate, transform, or reject the request */
  before?(request: InterceptorRequest, context: InterceptorContext): Promise<InterceptorBeforeResult>

  /** Post-response hook: augment or replace the response body */
  after?(request: InterceptorRequest, response: InterceptorResponse, context: InterceptorContext): Promise<InterceptorAfterResult>
}

/**
 * Registered interceptor entry with module context.
 */
export interface InterceptorRegistryEntry {
  moduleId: string
  interceptor: ApiInterceptor
}
