import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ParsedExtensionHeaders } from '../umes/extension-headers'
import type { AuthContext } from '../auth/server'

export type ApiInterceptorMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type ApiInterceptorScope = 'route' | 'request'

export type InterceptorRequest = {
  method: ApiInterceptorMethod
  url: string
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers: Record<string, string>
}

export type InterceptorResponse = {
  statusCode: number
  body: Record<string, unknown>
  headers: Record<string, string>
}

export type InterceptorContext = {
  userId: string
  /**
   * Organization the request is scoped to, or `''` when no single organization is in
   * scope (for example an API key created for all organizations). The empty string is
   * a "no organization" sentinel kept for type compatibility, never an id: check it for
   * truthiness (`context.organizationId || null`) before binding it to a uuid column or
   * a decryption scope. `?? null` does not catch it.
   */
  organizationId: string
  /** Tenant the request is scoped to, or `''` when the caller has none. Same sentinel rule as `organizationId`. */
  tenantId: string
  em: EntityManager
  container: AwilixContainer
  userFeatures?: string[]
  metadata?: Record<string, unknown>
  extensionHeaders?: ParsedExtensionHeaders
  auth?: AuthContext
  routePattern?: string
}

export type InterceptorBeforeResult = {
  ok: boolean
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, string>
  message?: string
  statusCode?: number
  metadata?: Record<string, unknown>
}

export type InterceptorAfterResult = {
  merge?: Record<string, unknown>
  replace?: Record<string, unknown>
}

export type ApiInterceptor = {
  id: string
  targetRoute: string
  scope?: ApiInterceptorScope
  methods: ApiInterceptorMethod[]
  priority?: number
  features?: string[]
  timeoutMs?: number
  before?: (request: InterceptorRequest, context: InterceptorContext) => Promise<InterceptorBeforeResult>
  after?: (
    request: InterceptorRequest,
    response: InterceptorResponse,
    context: InterceptorContext,
  ) => Promise<InterceptorAfterResult>
}

export type ApiInterceptorRegistryEntry = {
  moduleId: string
  interceptor: ApiInterceptor
  moduleOrder: number
  interceptorOrder: number
}
