export type SortDir = 'asc' | 'desc'

export type ListResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type CrudExportFormat = 'csv' | 'json' | 'xml' | 'markdown'

function toQuery(params: Record<string, any>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      sp.set(k, v.join(','))
    } else {
      sp.set(k, String(v))
    }
  }
  return sp.toString()
}

export function buildCrudQuery(params: Record<string, any>): string {
  return toQuery(params)
}

import { apiCall, readApiResultOrThrow, type ApiCallResult } from './apiCall'
import { raiseCrudError } from './serverErrors'

function mergeHeaders(base: HeadersInit | undefined, extra: Record<string, string>): HeadersInit {
  if (!base) return extra
  const hasHeadersCtor = typeof Headers !== 'undefined'
  if (hasHeadersCtor && base instanceof Headers) {
    const merged = new Headers(base)
    Object.entries(extra).forEach(([key, value]) => merged.set(key, value))
    return merged
  }
  if (Array.isArray(base)) {
    return [...base, ...Object.entries(extra)]
  }
  return { ...(base as Record<string, string>), ...extra }
}

type CrudRequestExtras<TReturn> = {
  parseResult?: (res: Response) => Promise<TReturn | null>
  fallbackResult?: TReturn | null
  errorMessage?: string
}

export type CrudRequestInit<TReturn> = Omit<RequestInit, 'body' | 'method'> & CrudRequestExtras<TReturn>
type CrudDeleteOptions<TReturn> = Omit<RequestInit, 'method'> &
  CrudRequestExtras<TReturn> & {
    body?: unknown
    id?: string
  }

export type CrudResponse<TReturn> = ApiCallResult<TReturn>

export async function fetchCrudList<T>(apiPath: string, params: Record<string, any>, init?: RequestInit): Promise<ListResponse<T>> {
  const qs = buildCrudQuery(params)
  return readApiResultOrThrow<ListResponse<T>>(`/api/${apiPath}?${qs}`, init, {
    errorMessage: 'Failed to fetch list',
  })
}

export function buildCrudExportUrl(apiPath: string, params: Record<string, any>, format: CrudExportFormat): string {
  const qs = buildCrudQuery({ ...params, format })
  return `/api/${apiPath}?${qs}`
}

export function buildCrudCsvUrl(apiPath: string, params: Record<string, any>): string {
  return buildCrudExportUrl(apiPath, params, 'csv')
}

export async function createCrud<TReturn = Record<string, unknown>>(
  apiPath: string,
  body: any,
  init?: CrudRequestInit<TReturn>,
): Promise<CrudResponse<TReturn>> {
  const { parseResult, fallbackResult, errorMessage, headers, ...rest } = init ?? {}
  const call = await apiCall<TReturn>(
    `/api/${apiPath}`,
    {
      ...rest,
      method: 'POST',
      headers: mergeHeaders(headers, { 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    },
    {
      parse: parseResult,
      fallback: fallbackResult ?? null,
    },
  )
  if (!call.ok) await raiseCrudError(call.response, errorMessage ?? 'Failed to create')
  return call
}

export async function updateCrud<TReturn = Record<string, unknown>>(
  apiPath: string,
  body: any,
  init?: CrudRequestInit<TReturn>,
): Promise<CrudResponse<TReturn>> {
  const { parseResult, fallbackResult, errorMessage, headers, ...rest } = init ?? {}
  const call = await apiCall<TReturn>(
    `/api/${apiPath}`,
    {
      ...rest,
      method: 'PUT',
      headers: mergeHeaders(headers, { 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    },
    {
      parse: parseResult,
      fallback: fallbackResult ?? null,
    },
  )
  if (!call.ok) await raiseCrudError(call.response, errorMessage ?? 'Failed to update')
  return call
}

export async function deleteCrud<TReturn = Record<string, unknown>>(
  apiPath: string,
  id: string,
  init?: CrudRequestInit<TReturn>,
): Promise<CrudResponse<TReturn>>
export async function deleteCrud<TReturn = Record<string, unknown>>(
  apiPath: string,
  options: CrudDeleteOptions<TReturn>,
): Promise<CrudResponse<TReturn>>
export async function deleteCrud<TReturn = Record<string, unknown>>(
  apiPath: string,
  idOrOptions: string | CrudDeleteOptions<TReturn>,
  maybeInit?: CrudRequestInit<TReturn>,
): Promise<CrudResponse<TReturn>> {
  if (typeof idOrOptions === 'string') {
    const { parseResult, fallbackResult, errorMessage, ...rest } = maybeInit ?? {}
    const call = await apiCall<TReturn>(
      `/api/${apiPath}?id=${encodeURIComponent(idOrOptions)}`,
      {
        ...rest,
        method: 'DELETE',
      },
      {
        parse: parseResult,
        fallback: fallbackResult ?? null,
      },
    )
    if (!call.ok) await raiseCrudError(call.response, errorMessage ?? 'Failed to delete')
    return call
  }
  const { parseResult, fallbackResult, errorMessage, headers, body, id, ...rest } = idOrOptions
  const payload = body ?? (id ? { id } : undefined)
  const requestHeaders =
    payload !== undefined ? mergeHeaders(headers, { 'content-type': 'application/json' }) : headers
  const call = await apiCall<TReturn>(
    `/api/${apiPath}`,
    {
      ...rest,
      method: 'DELETE',
      headers: requestHeaders,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    },
    {
      parse: parseResult,
      fallback: fallbackResult ?? null,
    },
  )
  if (!call.ok) await raiseCrudError(call.response, errorMessage ?? 'Failed to delete')
  return call
}
