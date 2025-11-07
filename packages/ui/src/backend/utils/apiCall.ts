"use client"

import { apiFetch } from './api'
import { readJsonSafe } from './serverErrors'

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
