type AkeneoCursorState = {
  kind: 'products' | 'list'
  nextUrl?: string | null
  updatedAfter?: string | null
  maxUpdatedAt?: string | null
}

export function serializeCursor(state: AkeneoCursorState): string {
  return JSON.stringify(state)
}

export function parseCursor(raw: string | undefined | null): AkeneoCursorState | null {
  if (!raw || raw.trim().length === 0) return null
  try {
    const parsed = JSON.parse(raw) as AkeneoCursorState
    if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function buildProductResumeCursor(current: { updatedAfter?: string | null; nextUrl?: string | null; maxUpdatedAt?: string | null }): string {
  return serializeCursor({
    kind: 'products',
    updatedAfter: current.updatedAfter ?? null,
    nextUrl: current.nextUrl ?? null,
    maxUpdatedAt: current.maxUpdatedAt ?? null,
  })
}

export function buildListResumeCursor(nextUrl?: string | null): string {
  return serializeCursor({
    kind: 'list',
    nextUrl: nextUrl ?? null,
  })
}
