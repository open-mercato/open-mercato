import {
  apiCallOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'

type RestoreVersionWithObservedContentTokenInput = {
  documentId: string
  versionId: string
  contentUpdatedAt: string | null
  errorMessage: string
}

export async function restoreVersionWithObservedContentToken({
  documentId,
  versionId,
  contentUpdatedAt,
  errorMessage,
}: RestoreVersionWithObservedContentTokenInput) {
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
