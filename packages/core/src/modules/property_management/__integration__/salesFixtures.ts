import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export type SalesDocumentResource = 'orders' | 'quotes'

const PAGE_SIZE = 100
const MAX_PAGES = 50

type DocumentPage = { ids: string[]; totalPages: number; total: number } | null

async function readChannelPage(
  request: APIRequestContext,
  token: string,
  resource: SalesDocumentResource,
  channelId: string,
  page: number,
): Promise<DocumentPage> {
  const params = new URLSearchParams({ channelId, page: String(page), pageSize: String(PAGE_SIZE) })
  const listed = await apiRequest(request, 'GET', `/api/sales/${resource}?${params.toString()}`, { token }).catch(() => null)
  if (!listed || listed.status() !== 200) return null
  const body = await readJsonSafe<{ items?: Array<{ id?: unknown }>; total?: number; totalPages?: number }>(listed)
  const ids = (body?.items ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  const total = typeof body?.total === 'number' ? body.total : ids.length
  const totalPages = typeof body?.totalPages === 'number' ? body.totalPages : Math.max(1, Math.ceil(total / PAGE_SIZE))
  return { ids, totalPages, total }
}

export async function listChannelDocumentIds(
  request: APIRequestContext,
  token: string,
  resource: SalesDocumentResource,
  channelId: string,
): Promise<string[] | null> {
  const ids = new Set<string>()
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const listed = await readChannelPage(request, token, resource, channelId, page)
    if (!listed) return null
    for (const id of listed.ids) ids.add(id)
    if (page >= listed.totalPages || listed.ids.length === 0) return Array.from(ids)
  }
  return null
}

/**
 * Deletes every sales document of `resource` on a QA sales channel, reading all pages first so
 * deletions cannot shift the paging. Resolves `true` only when a re-read confirms none remain,
 * so callers can keep the channel (and anything else the documents reference) otherwise.
 */
export async function deleteChannelSalesDocuments(
  request: APIRequestContext,
  token: string | null,
  resource: SalesDocumentResource,
  channelId: string | null,
): Promise<boolean> {
  if (!token || !channelId) return true
  const ids = await listChannelDocumentIds(request, token, resource, channelId)
  if (ids === null) return false
  for (const id of ids) {
    await apiRequest(request, 'DELETE', `/api/sales/${resource}?id=${encodeURIComponent(id)}`, { token }).catch(() => null)
  }
  const remaining = await readChannelPage(request, token, resource, channelId, 1)
  return remaining !== null && remaining.total === 0
}

export async function deleteChannelOrders(request: APIRequestContext, token: string | null, channelId: string | null): Promise<boolean> {
  return deleteChannelSalesDocuments(request, token, 'orders', channelId)
}
