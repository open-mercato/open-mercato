import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'

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
