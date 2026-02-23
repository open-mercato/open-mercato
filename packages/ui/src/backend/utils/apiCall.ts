"use client"

import { apiFetch } from './api'
import { raiseCrudError, readJsonSafe } from './serverErrors'
import { createScopedHeaderStack } from './scopedHeaderStack'

export type ApiCallOptions<TReturn> = {
  parse?: (res: Response) => Promise<TReturn | null>
  fallback?: TReturn | null
}

export type ApiCallResult<TReturn> = {
  ok: boolean
  status: number
  result: TReturn | null
  response: Response
  cacheStatus: 'hit' | 'miss' | null
}

const scopedRequestHeaders = createScopedHeaderStack()

function mergeHeaders(base: HeadersInit | undefined, extra: Record<string, string>): HeadersInit {
  if (!base) return extra
  if (typeof Headers !== 'undefined' && base instanceof Headers) {
    const merged = new Headers(base)
    Object.entries(extra).forEach(([key, value]) => merged.set(key, value))
    return merged
  }
  if (Array.isArray(base)) {
    return [...base, ...Object.entries(extra)]
  }
  return { ...(base as Record<string, string>), ...extra }
}

export async function withScopedApiRequestHeaders<T>(
  headers: Record<string, string>,
  run: () => Promise<T>,
): Promise<T> {
  return scopedRequestHeaders.withScopedHeaders(headers, run)
}

export async function apiCall<TReturn = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: ApiCallOptions<TReturn>,
): Promise<ApiCallResult<TReturn>> {
  const scopedHeaders = scopedRequestHeaders.resolveScopedHeaders()
  const requestInit = Object.keys(scopedHeaders).length > 0
    ? { ...(init ?? {}), headers: mergeHeaders(init?.headers, scopedHeaders) }
    : init
  const response = await apiFetch(input, requestInit)
  const parser = options?.parse
  const fallback = options?.fallback ?? null
  let result: TReturn | null = null
  const rawCacheStatus =
    response.headers?.get?.('x-om-cache') ??
    response.headers?.get?.('x-cache-status') ??
    null
  const cacheStatus = rawCacheStatus === 'hit' || rawCacheStatus === 'miss' ? rawCacheStatus : null
  try {
    const source = typeof (response as Response & { clone?: () => Response }).clone === 'function'
      ? response.clone()
      : response
    if (parser) result = await parser(source)
    else result = await readJsonSafe<TReturn>(source, fallback)
  } catch {
    result = fallback
  }
  return {
    ok: response.ok,
    status: response.status,
    result,
    response,
    cacheStatus,
  }
}

export type ApiCallOrThrowOptions<TReturn> = ApiCallOptions<TReturn> & {
  errorMessage?: string
}

export async function apiCallOrThrow<TReturn = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: ApiCallOrThrowOptions<TReturn>,
): Promise<ApiCallResult<TReturn>> {
  const { errorMessage, ...callOptions } = options ?? {}
  const call = await apiCall<TReturn>(input, init, callOptions)
  if (!call.ok) {
    await raiseCrudError(call.response, errorMessage)
  }
  return call
}

export type ReadApiResultOrThrowOptions<TReturn> = ApiCallOrThrowOptions<TReturn> & {
  allowNullResult?: boolean
  emptyResultMessage?: string
}

export async function readApiResultOrThrow<TReturn = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: ReadApiResultOrThrowOptions<TReturn> & { allowNullResult?: false },
): Promise<TReturn>
export async function readApiResultOrThrow<TReturn = Record<string, unknown>>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: ReadApiResultOrThrowOptions<TReturn> & { allowNullResult: true },
): Promise<TReturn | null>
export async function readApiResultOrThrow<TReturn = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: ReadApiResultOrThrowOptions<TReturn>,
): Promise<TReturn | null> {
  const { allowNullResult = false, emptyResultMessage, ...callOptions } = options ?? {}
  const call = await apiCallOrThrow<TReturn>(input, init, callOptions)
  if (call.result == null && !allowNullResult) {
    const fallback =
      emptyResultMessage ?? callOptions.errorMessage ?? `Missing response payload (${call.status})`
    throw new Error(fallback)
  }
  return call.result
}
