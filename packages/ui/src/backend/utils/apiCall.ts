"use client"

import { apiFetch } from './api'
import { raiseCrudError, readJsonSafe } from './serverErrors'
import { createScopedHeaderStack } from './scopedHeaderStack'
import {
  EXTENSION_PAYLOAD_TRANSPORT_KEY,
  mergeExtensionPayload,
  type ParsedExtensionPayload,
} from '@open-mercato/shared/lib/umes/extension-payload'

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
const scopedRequestBodies: ParsedExtensionPayload[] = []

function resolveScopedApiRequestBody(): ParsedExtensionPayload | undefined {
  if (!scopedRequestBodies.length) return undefined
  let result: ParsedExtensionPayload | undefined
  for (const body of scopedRequestBodies) {
    result = mergeExtensionPayload(result, body)
  }
  return result
}

function withScopedWidgetPayload(init: RequestInit | undefined): RequestInit | undefined {
  const scopedPayload = resolveScopedApiRequestBody()
  if (!scopedPayload || typeof init?.body !== 'string') return init
  let body: unknown
  try {
    body = JSON.parse(init.body)
  } catch {
    return init
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return init
  const mergedBody = {
    ...(body as Record<string, unknown>),
    [EXTENSION_PAYLOAD_TRANSPORT_KEY]: mergeExtensionPayload(
      (body as Record<string, unknown>)[EXTENSION_PAYLOAD_TRANSPORT_KEY],
      scopedPayload,
    ),
  }
  return { ...init, body: JSON.stringify(mergedBody) }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { name?: unknown }).name === 'AbortError'
}

function createAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('[internal] The operation was aborted.', 'AbortError')
  }
  const error = new Error('[internal] The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function resolveAbortSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) return init.signal
  if (typeof Request !== 'undefined' && input instanceof Request) return input.signal ?? null
  return null
}

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

export async function withScopedApiRequestBody<T>(
  widgetPayload: ParsedExtensionPayload,
  run: () => Promise<T>,
): Promise<T> {
  scopedRequestBodies.push(widgetPayload)
  try {
    return await run()
  } finally {
    const index = scopedRequestBodies.lastIndexOf(widgetPayload)
    if (index >= 0) scopedRequestBodies.splice(index, 1)
  }
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
  const response = await apiFetch(input, withScopedWidgetPayload(requestInit))
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
  } catch (err) {
    if (isAbortError(err)) throw err
    result = fallback
  }
  // `readJsonSafe` swallows the abort that cancels an in-flight body read, so a
  // request aborted after its response headers arrived would otherwise look like
  // a successful call that returned an empty payload.
  if (result == null && resolveAbortSignal(input, init)?.aborted) {
    throw createAbortError()
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
