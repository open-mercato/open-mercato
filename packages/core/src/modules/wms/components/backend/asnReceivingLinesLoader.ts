import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

/** API max pageSize (AGENTS.md); ASN detail loops until short page. */
export const ASN_RECEIVING_LINES_PAGE_SIZE = 100

export type AsnReceivingLineRow = {
  id: string
  asn_id?: string | null
  catalog_variant_id?: string | null
  expected_qty?: string | number | null
  received_qty?: string | number | null
  lot_number?: string | null
  qc_status?: string | null
  target_staging_location_id?: string | null
  rejection_reason?: string | null
  updated_at?: string | null
}

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

export type LoadAllAsnReceivingLinesResult =
  | { ok: true; items: AsnReceivingLineRow[] }
  | { ok: false; response: Response }

type FetchPage = (
  page: number,
  pageSize: number,
) => Promise<{
  ok: boolean
  response: Response
  result?: PagedResponse<AsnReceivingLineRow> | null
}>

/**
 * Load every receiving line for an ASN detail console.
 * Short-page termination only — never use `totalPages` (OM_LIST_COUNT_CAP).
 */
export async function loadAllAsnReceivingLines(
  asnId: string,
  options?: {
    pageSize?: number
    fetchPage?: FetchPage
  },
): Promise<LoadAllAsnReceivingLinesResult> {
  const pageSize = Math.min(
    Math.max(1, options?.pageSize ?? ASN_RECEIVING_LINES_PAGE_SIZE),
    ASN_RECEIVING_LINES_PAGE_SIZE,
  )
  const fetchPage: FetchPage =
    options?.fetchPage ??
    (async (page, size) => {
      const call = await apiCall<PagedResponse<AsnReceivingLineRow>>(
        `/api/wms/receiving-lines?asnId=${encodeURIComponent(asnId)}&page=${page}&pageSize=${size}`,
      )
      return {
        ok: call.ok,
        response: call.response,
        result: call.result ?? null,
      }
    })

  const items: AsnReceivingLineRow[] = []
  let page = 1
  // Short-page termination: `totalPages` derives from `total`, which is a
  // display value that can be capped (OM_LIST_COUNT_CAP) — never a loop bound.
  for (;;) {
    const call = await fetchPage(page, pageSize)
    if (!call.ok) {
      return { ok: false, response: call.response }
    }
    const batch = call.result?.items ?? []
    items.push(...batch)
    if (batch.length < pageSize) break
    page += 1
  }

  return { ok: true, items }
}
