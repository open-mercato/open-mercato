"use client"

import { apiFetch } from './api'
import { raiseCrudError, readJsonSafe } from './serverErrors'
import { createScopedHeaderStack } from './scopedHeaderStack'
import {
  EXTENSION_PAYLOAD_TRANSPORT_KEY,
  mergeExtensionPayload,
  type ParsedExtensionPayload,
} from '@open-mercato/shared/lib/umes/extension-payload'
import { createLogger } from '@open-mercato/shared/lib/logger'

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
const logger = createLogger('ui').child({ component: 'apiCall' })

type ScopedRequestBody = {
  payload: ParsedExtensionPayload
  spent: boolean
}

// The extension payload belongs to exactly one request: the submit the scope was opened
// around. Keeping the scope open for every call in between would graft another module's
// field values onto unrelated writes — including hand-written `.strict()` routes that
// reject unknown keys outright — so an armed scope is spent by the first eligible request.
const scopedRequestBodies: ScopedRequestBody[] = []
const EXTENSION_PAYLOAD_METHODS = new Set(['POST', 'PUT', 'PATCH'])

function resolveRequestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (typeof init?.method === 'string') return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

function readHeaderValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name) ?? undefined
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (entry[0]?.toLowerCase() === name) return entry[1]
    }
    return undefined
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === name) return value
  }
  return undefined
}

function hasJsonContentType(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  const declared = readHeaderValue(init?.headers, 'content-type')
    ?? (typeof Request !== 'undefined' && input instanceof Request
      ? input.headers.get('content-type') ?? undefined
      : undefined)
  if (!declared) return false
  const mediaType = declared.split(';', 1)[0]!.trim().toLowerCase()
  return mediaType === 'application/json' || mediaType.endsWith('+json')
}

function resolveArmedScopedBody(): ScopedRequestBody | undefined {
  const armed = scopedRequestBodies.filter((scoped) => !scoped.spent)
  return armed.length === 1 ? armed[0] : undefined
}

function withScopedWidgetPayload(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): RequestInit | undefined {
  if (!scopedRequestBodies.some((scoped) => !scoped.spent)) return init
  if (!EXTENSION_PAYLOAD_METHODS.has(resolveRequestMethod(input, init))) return init
  if (typeof init?.body !== 'string') return init
  if (!hasJsonContentType(input, init)) return init
  let body: unknown
  try {
    body = JSON.parse(init.body)
  } catch {
    return init
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return init
  const scoped = resolveArmedScopedBody()
  if (!scoped) return init
  scoped.spent = true
  const mergedBody = {
    ...(body as Record<string, unknown>),
    [EXTENSION_PAYLOAD_TRANSPORT_KEY]: mergeExtensionPayload(
      (body as Record<string, unknown>)[EXTENSION_PAYLOAD_TRANSPORT_KEY],
      scoped.payload,
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

/**
 * Arm the extension payload for the next eligible JSON write issued by `run`.
 *
 * The scope covers a single request: the first `POST`/`PUT`/`PATCH` with a JSON
 * content-type and a JSON-object body consumes it, and every later call inside the
 * same scope — a secondary write in the same `onSubmit`, an autosave, a background
 * refetch — is left untouched.
 */
export async function withScopedApiRequestBody<T>(
  widgetPayload: ParsedExtensionPayload,
  run: () => Promise<T>,
): Promise<T> {
  const scoped: ScopedRequestBody = { payload: widgetPayload, spent: false }
  scopedRequestBodies.push(scoped)
  try {
    return await run()
  } finally {
    const index = scopedRequestBodies.lastIndexOf(scoped)
    if (index >= 0) scopedRequestBodies.splice(index, 1)
    if (!scoped.spent && process.env.NODE_ENV === 'development') {
      logger.warn('Scoped widget payload was not sent with an eligible request')
    }
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
  const response = await apiFetch(input, withScopedWidgetPayload(input, requestInit))
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
