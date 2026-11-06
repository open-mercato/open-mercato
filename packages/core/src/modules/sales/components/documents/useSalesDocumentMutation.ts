'use client'

import * as React from 'react'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function useSalesDocumentMutation(kind: 'order' | 'quote', documentId?: string | null) {
  const t = useT()
  const contextId = `record-lock:sales.${kind}:${documentId ?? 'pending'}`
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const runDocumentMutation = React.useCallback(
    <TResult,>(operation: () => Promise<TResult>, mutationPayload: Record<string, unknown>) =>
      runMutation({
        operation,
        mutationPayload,
        context: {
          formId: contextId,
          resourceKind: `sales.${kind}`,
          resourceId: documentId ?? undefined,
          retryLastMutation,
        },
      }),
    [contextId, documentId, kind, retryLastMutation, runMutation],
  )
  return runDocumentMutation
}
