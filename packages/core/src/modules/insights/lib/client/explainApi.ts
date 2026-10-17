/* eslint-disable om-ds/require-loading-state -- Explain request helpers return promises; the calling components own their loading presentation. */

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type {
  ExplainDescriptorsResponse,
  ExplainFetchOutcome,
  ExplainFieldResponse,
  ExplainLogResponse,
  ExplainOverviewResponse,
  ExplainRequestParams,
} from './types'

export const EXPLAIN_API_PATH = '/api/insights/explain'
export const EXPLAIN_DESCRIPTORS_API_PATH = '/api/insights/explain/descriptors'
export const EXPLAIN_LOG_API_PATH = '/api/insights/explain/log'
export const EXPLAIN_ACCESS_API_PATH = '/api/insights/explain/access'
export const EXPLAIN_PAGE_PATH = '/backend/insights/why'
export const EXPLAIN_ACCESS_MAX_FEATURES = 20

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function appendParam(search: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined) return
  const text = String(value).trim()
  if (!text) return
  search.set(key, text)
}

export function buildExplainQuery(params: ExplainRequestParams): string {
  const search = new URLSearchParams()
  appendParam(search, 'resourceKind', params.resourceKind)
  appendParam(search, 'resourceId', params.resourceId)
  appendParam(search, 'field', params.field)
  appendParam(search, 'itemId', params.itemId)
  appendParam(search, 'limit', params.limit)
  appendParam(search, 'before', params.before)
  return search.toString()
}

export function buildExplainPageHref(params: Pick<ExplainRequestParams, 'resourceKind' | 'resourceId' | 'field' | 'itemId'>): string {
  const search = new URLSearchParams()
  appendParam(search, 'resourceKind', params.resourceKind)
  appendParam(search, 'resourceId', params.resourceId)
  appendParam(search, 'field', params.field)
  appendParam(search, 'itemId', params.itemId)
  return `${EXPLAIN_PAGE_PATH}?${search.toString()}`
}

const UNSAFE_HREF_CHARACTERS = /[\u0000-\u0020\u007f\\]/

export function isSafeInternalHref(href: string | null | undefined): href is string {
  if (typeof href !== 'string' || href.length === 0) return false
  if (UNSAFE_HREF_CHARACTERS.test(href)) return false
  return href.startsWith('/') && !href.startsWith('//')
}

async function requestJson<TBody>(url: string, signal?: AbortSignal): Promise<ExplainFetchOutcome<TBody>> {
  const call = await apiCall<TBody>(url, signal ? { signal } : undefined)
  if (call.ok && isRecord(call.result)) return { status: 'ok', body: call.result as TBody }
  if (call.status === 404) return { status: 'not_found' }
  if (call.status === 403) return { status: 'forbidden' }
  return { status: 'error', httpStatus: call.status || null }
}

export function fetchExplanation(
  params: ExplainRequestParams,
  signal?: AbortSignal,
): Promise<ExplainFetchOutcome<ExplainFieldResponse | ExplainOverviewResponse>> {
  return requestJson<ExplainFieldResponse | ExplainOverviewResponse>(`${EXPLAIN_API_PATH}?${buildExplainQuery(params)}`, signal)
}

export function fetchLogExplanation(logId: string, signal?: AbortSignal): Promise<ExplainFetchOutcome<ExplainLogResponse>> {
  const search = new URLSearchParams({ logId })
  return requestJson<ExplainLogResponse>(`${EXPLAIN_LOG_API_PATH}?${search.toString()}`, signal)
}

export function fetchExplainDescriptors(signal?: AbortSignal): Promise<ExplainFetchOutcome<ExplainDescriptorsResponse>> {
  return requestJson<ExplainDescriptorsResponse>(EXPLAIN_DESCRIPTORS_API_PATH, signal)
}

const ACCESS_FEATURE_ID_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_:-]+)+$/

export function normalizeAccessFeatures(features: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(features)) return []
  const unique = new Set<string>()
  for (const feature of features) {
    if (typeof feature !== 'string') continue
    const trimmed = feature.trim()
    if (ACCESS_FEATURE_ID_PATTERN.test(trimmed)) unique.add(trimmed)
  }
  return Array.from(unique).slice(0, EXPLAIN_ACCESS_MAX_FEATURES)
}

export function resolveExplainableAccessFeatures(features: readonly unknown[] | null | undefined): string[] | null {
  if (!Array.isArray(features)) return null
  const requested = new Set<string>()
  for (const feature of features) {
    if (typeof feature === 'string' && feature.trim().length > 0) requested.add(feature.trim())
  }
  const explainable = normalizeAccessFeatures(features)
  if (requested.size === 0 || explainable.length !== requested.size) return null
  return explainable
}

export function fetchAccessExplanation(
  params: { features: readonly string[]; path?: string | null },
  signal?: AbortSignal,
): Promise<ExplainFetchOutcome<Record<string, unknown>>> {
  const search = new URLSearchParams()
  appendParam(search, 'features', normalizeAccessFeatures(params.features).join(','))
  appendParam(search, 'path', params.path)
  return requestJson<Record<string, unknown>>(`${EXPLAIN_ACCESS_API_PATH}?${search.toString()}`, signal)
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}
