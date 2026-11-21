import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type CatalogVariantLookupCall<Row> = {
  ok: boolean
  status: number
  result?: { items?: Row[] } | null
  response: Response
}

/**
 * The WMS detail pages read the variant name from `/api/catalog/variants`, which needs
 * `catalog.products.view`. A `wms.view` user without catalog access gets 403 there; the
 * WMS data itself is still readable, so a 403 yields a bare row (id only) instead of an error.
 */
export async function readOptionalCatalogVariant<Row extends { id: string }>(
  call: CatalogVariantLookupCall<Row>,
  catalogVariantId: string,
  raise: (response: Response) => Promise<unknown>,
): Promise<Row | null> {
  if (call.ok) return call.result?.items?.[0] ?? null
  if (call.status === 403) return { id: catalogVariantId } as Row
  await raise(call.response)
  return null
}

/**
 * Fetches the catalog variant for a WMS detail page. `apiFetch` throws `ForbiddenError` (and
 * shows a permission toast) on 403 unless `x-om-forbidden-redirect: 0` is sent, so the opt-out
 * header is required for the 403 fallback in `readOptionalCatalogVariant` to be reachable.
 */
export async function fetchOptionalCatalogVariant<Row extends { id: string }>(
  catalogVariantId: string,
  raise: (response: Response) => Promise<unknown>,
): Promise<Row | null> {
  const params = new URLSearchParams({ id: catalogVariantId, page: '1', pageSize: '1' })
  const call = await apiCall<{ items?: Row[] }>(`/api/catalog/variants?${params.toString()}`, {
    headers: { 'x-om-forbidden-redirect': '0' },
  })
  return readOptionalCatalogVariant(call, catalogVariantId, raise)
}
