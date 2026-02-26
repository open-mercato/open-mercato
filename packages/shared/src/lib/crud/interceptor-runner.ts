import type {
  ApiInterceptorMethod,
  InterceptorContext,
  InterceptorRequest,
  InterceptorResponse,
  InterceptorBeforeResult,
} from './api-interceptor'
import { getApiInterceptorsForRoute } from './interceptor-registry'

const DEFAULT_TIMEOUT_MS = 5000

type BeforeRunOk = {
  ok: true
  request: InterceptorRequest
  metadataByInterceptor: Record<string, Record<string, unknown> | undefined>
}

type BeforeRunFailed = {
  ok: false
  statusCode: number
  body: Record<string, unknown>
}

export type RunInterceptorsBeforeResult = BeforeRunOk | BeforeRunFailed

export type RunInterceptorsAfterResult = {
  ok: boolean
  statusCode: number
  body: Record<string, unknown>
  headers: Record<string, string>
}

function sanitizeObject(input?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const clean = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
  return Object.keys(clean).length > 0 ? clean : {}
}

function hasRequiredFeatures(features: string[] | undefined, userFeatures: string[] | undefined): boolean {
  if (!features || features.length === 0) return true
  const granted = new Set(userFeatures ?? [])
  return features.every((feature) => granted.has(feature))
}

function timeoutPromise(ms: number, interceptorId: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`INTERCEPTOR_TIMEOUT:${interceptorId}`))
    }, ms)
  })
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('INTERCEPTOR_TIMEOUT:')
}

async function runWithTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  interceptorId: string,
): Promise<T> {
  return Promise.race([task, timeoutPromise(timeoutMs, interceptorId)])
}

function toErrorBody(interceptorId: string, error: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {
    error: 'Internal interceptor error',
    interceptorId,
  }
  if (process.env.NODE_ENV !== 'production') {
    body.message = error instanceof Error ? error.message : String(error)
  }
  return body
}

export async function runApiInterceptorsBefore(args: {
  routePath: string
  method: ApiInterceptorMethod
  request: InterceptorRequest
  context: Omit<InterceptorContext, 'metadata'>
}): Promise<RunInterceptorsBeforeResult> {
  const { routePath, method, context } = args
  let currentRequest: InterceptorRequest = {
    ...args.request,
    body: sanitizeObject(args.request.body),
    query: sanitizeObject(args.request.query),
    headers: { ...(args.request.headers ?? {}) },
  }

  const metadataByInterceptor: Record<string, Record<string, unknown> | undefined> = {}
  const interceptors = getApiInterceptorsForRoute(routePath, method)

  for (const entry of interceptors) {
    const interceptor = entry.interceptor
    if (!interceptor.before) continue
    if (!hasRequiredFeatures(interceptor.features, context.userFeatures)) continue

    try {
      const timeoutMs = interceptor.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const result = await runWithTimeout(
        interceptor.before(currentRequest, context),
        timeoutMs,
        interceptor.id,
      )

      const normalized: InterceptorBeforeResult = result ?? { ok: true }
      if (!normalized.ok) {
        return {
          ok: false,
          statusCode: normalized.statusCode ?? 400,
          body: {
            error: normalized.message ?? 'Request blocked by API interceptor',
            interceptorId: interceptor.id,
          },
        }
      }

      if (normalized.headers) {
        currentRequest = {
          ...currentRequest,
          headers: {
            ...currentRequest.headers,
            ...normalized.headers,
          },
        }
      }
      if (normalized.body) {
        currentRequest = {
          ...currentRequest,
          body: sanitizeObject(normalized.body),
        }
      }
      if (normalized.query) {
        currentRequest = {
          ...currentRequest,
          query: sanitizeObject(normalized.query),
        }
      }
      metadataByInterceptor[interceptor.id] = normalized.metadata
    } catch (error) {
      if (isTimeoutError(error)) {
        return {
          ok: false,
          statusCode: 504,
          body: {
            error: 'Interceptor timeout',
            interceptorId: interceptor.id,
          },
        }
      }
      return {
        ok: false,
        statusCode: 500,
        body: toErrorBody(interceptor.id, error),
      }
    }
  }

  return {
    ok: true,
    request: currentRequest,
    metadataByInterceptor,
  }
}

export async function runApiInterceptorsAfter(args: {
  routePath: string
  method: ApiInterceptorMethod
  request: InterceptorRequest
  response: InterceptorResponse
  context: Omit<InterceptorContext, 'metadata'>
  metadataByInterceptor?: Record<string, Record<string, unknown> | undefined>
}): Promise<RunInterceptorsAfterResult> {
  const { routePath, method, context } = args
  let body: Record<string, unknown> = { ...(args.response.body ?? {}) }
  let headers: Record<string, string> = { ...(args.response.headers ?? {}) }

  const interceptors = getApiInterceptorsForRoute(routePath, method)
  for (const entry of interceptors) {
    const interceptor = entry.interceptor
    if (!interceptor.after) continue
    if (!hasRequiredFeatures(interceptor.features, context.userFeatures)) continue

    try {
      const timeoutMs = interceptor.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const result = await runWithTimeout(
        interceptor.after(
          args.request,
          { statusCode: args.response.statusCode, body, headers },
          { ...context, metadata: args.metadataByInterceptor?.[interceptor.id] },
        ),
        timeoutMs,
        interceptor.id,
      )
      if (!result) continue
      if (result.replace && typeof result.replace === 'object') {
        body = { ...result.replace }
      } else if (result.merge && typeof result.merge === 'object') {
        body = { ...body, ...result.merge }
      }
    } catch (error) {
      if (isTimeoutError(error)) {
        return {
          ok: false,
          statusCode: 504,
          body: {
            error: 'Interceptor timeout',
            interceptorId: interceptor.id,
          },
          headers,
        }
      }
      return {
        ok: false,
        statusCode: 500,
        body: toErrorBody(interceptor.id, error),
        headers,
      }
    }
  }

  return {
    ok: true,
    statusCode: args.response.statusCode,
    body,
    headers,
  }
}
