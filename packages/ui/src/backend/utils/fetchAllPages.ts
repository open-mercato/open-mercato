"use client"

import { apiCall } from './apiCall'

// Offset-paged list routes cap how many rows one response may carry, so a
// caller that needs the whole collection has to walk the pages. Bound the walk
// so a route reporting hasMore forever cannot hang the caller; at the 500-row
// dictionary ceiling this still covers 25k rows.
export const MAX_OFFSET_PAGES = 50

export type OffsetPagedPayload = Record<string, unknown>

export type OffsetPagedResult = {
  ok: boolean
  items: unknown[]
  pageCount: number
  firstPayload: OffsetPagedPayload
  errorPayload: OffsetPagedPayload | null
}

const ABSOLUTE_URL_PATTERN = /^([a-z][a-z\d+\-.]*:)?\/\//i

type ParsedUrl = { url: URL; absolute: boolean }

function parseUrl(value: string): ParsedUrl | null {
  try {
    const absolute = ABSOLUTE_URL_PATTERN.test(value)
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    return { url: absolute ? new URL(value) : new URL(value, origin), absolute }
  } catch {
    return null
  }
}

function formatUrl(parsed: ParsedUrl): string {
  return parsed.absolute ? parsed.url.toString() : `${parsed.url.pathname}${parsed.url.search}`
}

function readOffset(value: string): number {
  const parsed = parseUrl(value)
  if (!parsed) return 0
  const offset = Number.parseInt(parsed.url.searchParams.get('offset') ?? '', 10)
  return Number.isFinite(offset) && offset > 0 ? offset : 0
}

function withOffset(value: string, offset: number): string {
  const parsed = parseUrl(value)
  if (!parsed) {
    const separator = value.includes('?') ? '&' : '?'
    return `${value}${separator}offset=${offset}`
  }
  parsed.url.searchParams.set('offset', String(offset))
  return formatUrl(parsed)
}

/**
 * Walk every page of an offset-paged list route and return the assembled items.
 *
 * A route that does not report `hasMore` resolves after a single request, so
 * this is a drop-in replacement for a one-shot `apiCall` against any list
 * endpoint. Ordering is preserved as the route returned it, page after page —
 * callers that need a global order across page boundaries must re-sort.
 */
export async function fetchAllOffsetPages(
  url: string,
  options: { maxPages?: number } = {},
): Promise<OffsetPagedResult> {
  const maxPages = options.maxPages ?? MAX_OFFSET_PAGES
  const baseOffset = readOffset(url)
  const items: unknown[] = []
  let firstPayload: OffsetPagedPayload = {}
  let pageCount = 0

  while (pageCount < maxPages) {
    // The first request goes out untouched so a route that caches only its
    // default page still serves that page from cache.
    const pageUrl = pageCount === 0 ? url : withOffset(url, baseOffset + items.length)
    const call = await apiCall<OffsetPagedPayload>(pageUrl, undefined, { fallback: {} })
    const payload = call.result ?? {}
    if (!call.ok) {
      return { ok: false, items, pageCount, firstPayload, errorPayload: payload }
    }
    pageCount += 1
    if (pageCount === 1) firstPayload = payload
    const pageItems = Array.isArray(payload.items) ? payload.items : []
    items.push(...pageItems)
    // An empty page also stops the walk: without it a route that keeps
    // reporting hasMore while returning nothing would spin to the page cap.
    if (payload.hasMore !== true || pageItems.length === 0) break
  }

  return { ok: true, items, pageCount, firstPayload, errorPayload: null }
}
