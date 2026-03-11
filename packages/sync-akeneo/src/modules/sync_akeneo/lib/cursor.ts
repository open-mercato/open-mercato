import { normalizeAkeneoDateTime, sanitizeAkeneoProductNextUrl } from './client'

type AkeneoCursorState = {
  kind: 'products' | 'list'
  nextUrl?: string | null
  updatedAfter?: string | null
  maxUpdatedAt?: string | null
}

function normalizeCursorString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeProductCursorDateTime(value: unknown): string | null {
  return normalizeAkeneoDateTime(normalizeCursorString(value))
}

function normalizeProductCursorNextUrl(value: unknown): string | null {
  const normalized = normalizeCursorString(value)
  return normalized ? sanitizeAkeneoProductNextUrl(normalized) : null
}

export function serializeCursor(state: AkeneoCursorState): string {
  return JSON.stringify(state)
}

export function parseCursor(raw: string | undefined | null): AkeneoCursorState | null {
  if (!raw || raw.trim().length === 0) return null
  try {
    const parsed = JSON.parse(raw) as AkeneoCursorState
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null
    return {
      kind: parsed.kind === 'list' ? 'list' : 'products',
      nextUrl: parsed.kind === 'list'
        ? normalizeCursorString(parsed.nextUrl)
        : normalizeProductCursorNextUrl(parsed.nextUrl),
      updatedAfter: normalizeProductCursorDateTime(parsed.updatedAfter),
      maxUpdatedAt: normalizeProductCursorDateTime(parsed.maxUpdatedAt),
    }
  } catch {
    return null
  }
}

export function buildProductResumeCursor(current: { updatedAfter?: string | null; nextUrl?: string | null; maxUpdatedAt?: string | null }): string {
  return serializeCursor({
    kind: 'products',
    updatedAfter: normalizeProductCursorDateTime(current.updatedAfter),
    nextUrl: normalizeProductCursorNextUrl(current.nextUrl),
    maxUpdatedAt: normalizeProductCursorDateTime(current.maxUpdatedAt),
  })
}

export function buildListResumeCursor(nextUrl?: string | null): string {
  return serializeCursor({
    kind: 'list',
    nextUrl: normalizeCursorString(nextUrl),
  })
}
