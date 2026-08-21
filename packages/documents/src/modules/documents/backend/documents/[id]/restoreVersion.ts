import {
  apiCallOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { normalizeDocumentContent } from '../documentUi'

type RestoreVersionWithCurrentContentTokenInput = {
  documentId: string
  versionId: string
  errorMessage: string
}

/**
 * Restore a version against the content row's CURRENT optimistic-lock token.
 *
 * The token observed when the page loaded is unusable here: every keystroke
 * the caller made since (materialized by the collaboration sidecar, or saved
 * by the single-user autosave) advanced `updated_at`, so restoring after any
 * edit answered a spurious 409, and a document opened before its content row
 * existed had no token at all. Reading the token immediately before the
 * restore keeps the lock meaningful for the concurrent-write race it exists
 * for, while the server-side pre-restore snapshot preserves whatever
 * collaborators wrote in between.
 */
export async function restoreVersionWithCurrentContentToken({
  documentId,
  versionId,
  errorMessage,
}: RestoreVersionWithCurrentContentTokenInput) {
  const contentCall = await apiCallOrThrow<unknown>(
    `/api/documents/${encodeURIComponent(documentId)}/content`,
    undefined,
    { errorMessage },
  )
  const contentUpdatedAt = normalizeDocumentContent(contentCall.result).updatedAt
  if (!contentUpdatedAt || !Number.isFinite(Date.parse(contentUpdatedAt))) {
    throw new Error(errorMessage)
  }

  return withScopedApiRequestHeaders(
    buildOptimisticLockHeader(contentUpdatedAt),
    () => apiCallOrThrow(
      `/api/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST' },
      { errorMessage },
    ),
  )
}
