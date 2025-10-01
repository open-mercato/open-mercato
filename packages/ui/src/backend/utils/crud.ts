export type SortDir = 'asc' | 'desc'

export type ListResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

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

import { apiFetch } from './api'

export async function fetchCrudList<T>(apiPath: string, params: Record<string, any>, init?: RequestInit): Promise<ListResponse<T>> {
  const qs = buildCrudQuery(params)
  const res = await apiFetch(`/api/${apiPath}?${qs}`, { ...(init || {}) })
  if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to fetch list'))
  return res.json()
}

export function buildCrudCsvUrl(apiPath: string, params: Record<string, any>): string {
  const qs = buildCrudQuery({ ...params, format: 'csv' })
  return `/api/${apiPath}?${qs}`
}

export async function createCrud(apiPath: string, body: any, init?: RequestInit): Promise<Response> {
  const res = await apiFetch(`/api/${apiPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(init || {}),
  })
  if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to create'))
  return res
}

export async function updateCrud(apiPath: string, body: any, init?: RequestInit): Promise<Response> {
  const res = await apiFetch(`/api/${apiPath}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(init || {}),
  })
  if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to update'))
  return res
}

export async function deleteCrud(apiPath: string, id: string, init?: RequestInit): Promise<Response> {
  const res = await apiFetch(`/api/${apiPath}?id=${encodeURIComponent(id)}`, { method: 'DELETE', ...(init || {}) })
  if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to delete'))
  return res
}
