"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import {
  readShareItems,
  type DocumentSharePermission,
  type DocumentSharePrincipalType,
  type ShareRow,
  type SharesResponse,
} from './shareDialogModel'

type UseShareDialogInput = {
  documentId: string
  open: boolean
  canManage: boolean
}

type ShareMutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export function useShareDialog({ documentId, open, canManage }: UseShareDialogInput) {
  const t = useT()
  const [shares, setShares] = React.useState<ShareRow[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [principalType, setPrincipalType] = React.useState<DocumentSharePrincipalType>('user')
  const [principalId, setPrincipalId] = React.useState('')
  const [permission, setPermission] = React.useState<DocumentSharePermission>('viewer')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const mutationContextId = `documents-share-dialog:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<ShareMutationContext>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const mutationContext = React.useCallback((resourceKind: string, resourceId: string) => ({
    formId: mutationContextId,
    resourceKind,
    resourceId,
    retryLastMutation,
  }), [mutationContextId, retryLastMutation])

  const loadShares = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const fallback: SharesResponse = { items: [] }
    try {
      const call = await apiCall<SharesResponse>(
        `/api/documents/${encodeURIComponent(documentId)}/shares`,
        undefined,
        { fallback },
      )
      if (!call.ok) {
        setError(t('documents.share.dialog.error.load'))
        return
      }
      setShares(readShareItems(call.result ?? fallback, t('documents.share.removedPrincipal')))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('documents.share.dialog.error.load'))
    } finally {
      setIsLoading(false)
    }
  }, [documentId, t])

  React.useEffect(() => {
    if (open) void loadShares()
  }, [loadShares, open])

  const addShare = React.useCallback(async () => {
    const trimmedPrincipal = principalId.trim()
    if (!trimmedPrincipal || !canManage) return
    setIsSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/shares`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ principalType, principalId: trimmedPrincipal, permission }),
            },
            { errorMessage: t('documents.share.dialog.error.add') },
          )
        },
        context: mutationContext('documents.document_share', documentId),
        mutationPayload: { principalType, principalId: trimmedPrincipal, permission },
      })
      setPrincipalId('')
      setPermission('viewer')
      await loadShares()
      flash(t('documents.share.dialog.success.add'), 'success')
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : t('documents.share.dialog.error.add'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [canManage, documentId, loadShares, mutationContext, permission, principalId, principalType, runMutation, t])

  const changePermission = React.useCallback(async (
    share: ShareRow,
    nextPermission: DocumentSharePermission,
  ) => {
    if (!canManage || share.permission === nextPermission) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(share.updatedAt),
          () => apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/shares`,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: share.id, permission: nextPermission }),
            },
            { errorMessage: t('documents.share.dialog.error.update') },
          ),
        ),
        context: mutationContext('documents.document_share', share.id),
        mutationPayload: { id: share.id, permission: nextPermission },
      })
      setShares((current) => current.map((row) => (
        row.id === share.id ? { ...row, permission: nextPermission } : row
      )))
      await loadShares()
      flash(t('documents.share.dialog.success.update'), 'success')
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : t('documents.share.dialog.error.update'), 'error')
    }
  }, [canManage, documentId, loadShares, mutationContext, runMutation, t])

  const removeShare = React.useCallback(async (share: ShareRow) => {
    if (!canManage) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(share.updatedAt),
          () => apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/shares`,
            {
              method: 'DELETE',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: share.id }),
            },
            { errorMessage: t('documents.share.dialog.error.remove') },
          ),
        ),
        context: mutationContext('documents.document_share', share.id),
        mutationPayload: { id: share.id },
      })
      setShares((current) => current.filter((row) => row.id !== share.id))
      flash(t('documents.share.dialog.success.remove'), 'success')
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : t('documents.share.dialog.error.remove'), 'error')
    }
  }, [canManage, documentId, mutationContext, runMutation, t])

  const changePrincipalType = React.useCallback((nextType: DocumentSharePrincipalType) => {
    setPrincipalType(nextType)
    setPrincipalId('')
  }, [])

  return {
    shares,
    isLoading,
    error,
    principalType,
    principalId,
    permission,
    isSubmitting,
    setPrincipalId,
    setPermission,
    changePrincipalType,
    addShare,
    changePermission,
    removeShare,
  }
}
