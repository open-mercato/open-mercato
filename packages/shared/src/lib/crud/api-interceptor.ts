import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ParsedExtensionHeaders } from '../umes/extension-headers'

export type ApiInterceptorMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

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
  organizationId: string
  tenantId: string
  em: EntityManager
  container: AwilixContainer
  userFeatures?: string[]
  metadata?: Record<string, unknown>
  extensionHeaders?: ParsedExtensionHeaders
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
  /**
   * Response headers to add or overwrite. Merged over the headers the route seeded, in
   * execution order, so the LAST interceptor to run wins a collision - the same precedence the
   * body `merge` already follows. Note interceptors run in descending `priority`, so the
   * lowest-priority entry is the one that wins.
   */
  headers?: Record<string, string>
}

export type ApiInterceptor = {
  id: string
  targetRoute: string
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
