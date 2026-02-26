/**
 * API Interceptor Runner
 *
 * Executes API interceptors against requests and responses.
 * Handles timeout (default 5000ms), fail-closed on errors,
 * priority ordering, feature gating, and metadata passthrough.
 */

import type {
  ApiInterceptor,
  InterceptorAfterResult,
  InterceptorBeforeResult,
  InterceptorContext,
  InterceptorRegistryEntry,
  InterceptorRequest,
  InterceptorResponse,
} from './api-interceptor'
import { getInterceptorsForRoute } from './interceptor-registry'

const DEFAULT_TIMEOUT = 5000

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Interceptor timed out after ${ms}ms`)), ms),
  )
}

function hasRequiredFeatures(
  interceptor: ApiInterceptor,
  userFeatures: string[] | undefined,
): boolean {
  if (!interceptor.features || interceptor.features.length === 0) return true
  if (!userFeatures) return false
  const hasFeature = (required: string): boolean => {
    for (const granted of userFeatures) {
      if (granted === '*' || granted === required) return true
      if (granted.endsWith('.*')) {
        const prefix = granted.slice(0, -1)
        if (required.startsWith(prefix)) return true
      }
    }
    return false
  }
  return interceptor.features.every((feature) => hasFeature(feature))
}

function getActiveInterceptors(
  route: string,
  method: string,
  context: InterceptorContext,
): InterceptorRegistryEntry[] {
  const entries = getInterceptorsForRoute(route, method)
  return entries.filter((entry) => {
    return hasRequiredFeatures(entry.interceptor, context.userFeatures)
  })
}

/**
 * Run before-interceptors against an incoming request.
 *
 * Runs all matching before hooks in priority order (higher first).
 * - If any interceptor returns `ok: false`, short-circuits with that result.
 * - If any interceptor modifies body/query/headers, the modified version is passed to the next.
 * - Metadata is accumulated across all interceptors.
 * - On timeout or crash: fail-closed (returns error with interceptorId).
 */
export async function runInterceptorsBefore(
  route: string,
  request: InterceptorRequest,
  context: InterceptorContext,
): Promise<InterceptorBeforeResult> {
  const activeEntries = getActiveInterceptors(route, request.method, context)

  if (activeEntries.length === 0) {
    return { ok: true }
  }

  let currentBody = request.body
  let currentQuery = request.query
  let currentHeaders = request.headers
  let accumulatedMetadata: Record<string, unknown> = { ...(context.metadata ?? {}) }

  for (const entry of activeEntries) {
    const interceptor = entry.interceptor
    if (!interceptor.before) continue

    const timeout = interceptor.timeoutMs ?? DEFAULT_TIMEOUT

    const currentRequest: InterceptorRequest = {
      ...request,
      body: currentBody,
      query: currentQuery,
      headers: currentHeaders,
    }

    const currentContext: InterceptorContext = {
      ...context,
      metadata: accumulatedMetadata,
    }

    try {
      const result = await Promise.race([
        interceptor.before(currentRequest, currentContext),
        timeoutPromise(timeout),
      ])

      if (!result.ok) {
        console.warn(
          `[UMES] Interceptor ${interceptor.id} rejected request: ${result.message ?? 'no reason'}`,
        )
        return {
          ok: false,
          message: result.message ?? `Rejected by interceptor ${interceptor.id}`,
          statusCode: result.statusCode ?? 400,
          metadata: { ...accumulatedMetadata, ...(result.metadata ?? {}) },
        }
      }

      if (result.body) currentBody = result.body
      if (result.query) currentQuery = result.query
      if (result.headers) currentHeaders = { ...currentHeaders, ...result.headers }
      if (result.metadata) accumulatedMetadata = { ...accumulatedMetadata, ...result.metadata }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[UMES] Interceptor ${interceptor.id} before-hook failed: ${message}`)
      return {
        ok: false,
        message: `Interceptor ${interceptor.id} failed: ${message}`,
        statusCode: 500,
        metadata: accumulatedMetadata,
      }
    }
  }

  return {
    ok: true,
    body: currentBody,
    query: currentQuery,
    headers: currentHeaders,
    metadata: accumulatedMetadata,
  }
}

/**
 * Run after-interceptors against an outgoing response.
 *
 * Runs all matching after hooks in priority order (higher first).
 * - `merge` results are shallow-merged into the response body.
 * - `replace` results replace the entire response body.
 * - On crash: fail-closed (returns error result with interceptorId).
 */
export async function runInterceptorsAfter(
  route: string,
  request: InterceptorRequest,
  response: InterceptorResponse,
  context: InterceptorContext,
): Promise<InterceptorAfterResult> {
  const activeEntries = getActiveInterceptors(route, request.method, context)

  if (activeEntries.length === 0) {
    return {}
  }

  let currentBody = { ...response.body }
  let usedReplace = false

  for (const entry of activeEntries) {
    const interceptor = entry.interceptor
    if (!interceptor.after) continue

    const timeout = interceptor.timeoutMs ?? DEFAULT_TIMEOUT

    const currentResponse: InterceptorResponse = {
      ...response,
      body: currentBody,
    }

    try {
      const result = await Promise.race([
        interceptor.after(request, currentResponse, context),
        timeoutPromise(timeout),
      ])

      if (result.replace) {
        currentBody = { ...result.replace }
        usedReplace = true
      } else if (result.merge) {
        currentBody = { ...currentBody, ...result.merge }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[UMES] Interceptor ${interceptor.id} after-hook failed: ${message}`)
      return {
        replace: {
          error: `Interceptor ${interceptor.id} failed`,
          message,
          _interceptorId: interceptor.id,
        },
      }
    }
  }

  return usedReplace ? { replace: currentBody } : { merge: currentBody }
}
