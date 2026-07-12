import { resolveSearchMinTokenLength } from '@open-mercato/shared/lib/search/config'
import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from '../../../lib/displayLabels'

export type PrincipalType = 'user' | 'role'

export type PrincipalOption = {
  id: string
  label: string
  primary: string
  secondary: string | null
}

export type PrincipalListPayload = { items?: unknown[]; total?: unknown; totalPages?: unknown }

export const PRINCIPAL_PAGE_SIZE = 20
export const PRINCIPAL_DEBOUNCE_MS = 250
export const PRINCIPAL_SEARCH_MIN_LENGTH = resolveSearchMinTokenLength()

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function normalize(value: unknown, fallbackLabel: string): PrincipalOption | null {
  const item = record(value)
  if (!item) return null
  const id = text(item, 'id')
  if (!id) return null
  const primary = firstSafeDocumentsDisplayLabel(text(item, 'label'), fallbackLabel)
  if (!primary) return null
  const rawSecondary = sanitizeDocumentsDisplayLabel(text(item, 'secondary'))
  const secondary = rawSecondary && rawSecondary !== primary ? rawSecondary : null
  return { id, primary, secondary, label: secondary ? `${primary} (${secondary})` : primary }
}

export function readPrincipalPage(
  payload: PrincipalListPayload | null,
  _principalType: PrincipalType,
  page: number,
  fallbackLabel: string,
) {
  const root = record(payload)
  const rawItems = Array.isArray(root?.items) ? root.items : []
  const items = rawItems.slice(0, PRINCIPAL_PAGE_SIZE)
    .map((item) => normalize(item, fallbackLabel))
    .filter((item): item is PrincipalOption => item !== null)
  const rawTotal = root?.total
  const total = typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : items.length
  const rawPages = root?.totalPages
  const totalPages = typeof rawPages === 'number' && Number.isFinite(rawPages) && rawPages >= 0
    ? rawPages
    : total > 0 ? Math.ceil(total / PRINCIPAL_PAGE_SIZE) : 1
  return { items, total, totalPages: Math.max(1, totalPages, page) }
}

export function buildPrincipalUrl(
  documentId: string,
  principalType: PrincipalType,
  query: string,
  page: number,
): string {
  const params = new URLSearchParams({
    mode: 'share',
    type: principalType,
    page: String(page),
    pageSize: String(PRINCIPAL_PAGE_SIZE),
  })
  if (query) params.set('search', query)
  return `/api/documents/${encodeURIComponent(documentId)}/principals?${params.toString()}`
}

export function mergePrincipalOptions(current: PrincipalOption[], next: PrincipalOption[]): PrincipalOption[] {
  const merged = new Map(current.map((item) => [item.id, item]))
  next.forEach((item) => merged.set(item.id, item))
  return Array.from(merged.values())
}
