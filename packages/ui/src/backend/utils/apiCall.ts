"use client"

import { apiFetch } from './api'
import { raiseCrudError, readJsonSafe } from './serverErrors'

export type ApiCallOptions<TReturn> = {
  parse?: (res: Response) => Promise<TReturn | null>
  fallback?: TReturn | null
}

export type ApiCallResult<TReturn> = {
  ok: boolean
  status: number
  result: TReturn | null
  response: Response
}

export async function apiCall<TReturn = Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: ApiCallOptions<TReturn>,
): Promise<ApiCallResult<TReturn>> {
  const response = await apiFetch(input, init)
  const parser = options?.parse
  const fallback = options?.fallback ?? null
  let result: TReturn | null = null
  try {
    const source = response.clone()
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
