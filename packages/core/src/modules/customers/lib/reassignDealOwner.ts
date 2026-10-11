import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { BulkActionExecuteResult } from '@open-mercato/ui/backend/DataTable'

export const BULK_UPDATE_OWNER_ENDPOINT = '/api/customers/deals/bulk-update-owner'

type BulkUpdateOwnerResponse = {
  ok: boolean
  progressJobId: string | null
  message: string
}

/**
 * Posts a bulk owner reassignment and returns the queued job id.
 *
 * Split out of the deals list page so the request shape and the progress-id passthrough are
 * testable without rendering the page. `errorMessage` is supplied by the caller because the
 * page owns translation; it is thrown as-is so the guarded-mutation wrapper surfaces the same
 * text it did before this was extracted.
 */
export async function requestBulkOwnerReassignment(params: {
  ids: string[]
  ownerUserId: string
  errorMessage: string
}): Promise<{ progressJobId: string | null }> {
  const call = await apiCall<BulkUpdateOwnerResponse>(BULK_UPDATE_OWNER_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: params.ids, ownerUserId: params.ownerUserId }),
  })
  if (!call.ok) throw new Error(params.errorMessage)
  return { progressJobId: call.result?.progressJobId ?? null }
}

/**
 * The success shape handed back to `DataTable`. Returning `ok: true` with a `progressJobId` is
 * what makes the table clear the row selection and track the job in the top bar — that side of
 * the contract is covered by `DataTable.propBulkActions.test.tsx`; this builder is what keeps
 * our half of it honest.
 */
export function buildReassignOwnerSuccess(params: {
  ids: string[]
  progressJobId: string | null
  message: string
}): BulkActionExecuteResult {
  return {
    ok: true,
    progressJobId: params.progressJobId,
    affectedCount: params.ids.length,
    message: params.message,
  }
}
