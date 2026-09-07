"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
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
  const [pendingShareIds, setPendingShareIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const submitInFlight = React.useRef(false)
  const shareMutationsInFlight = React.useRef(new Set<string>())
  const loadSequence = React.useRef(0)
  const activeLoad = React.useRef<AbortController | null>(null)
  const activeDialogContext = React.useRef({ documentId, open, generation: 0 })
  if (activeDialogContext.current.documentId !== documentId || activeDialogContext.current.open !== open) {
    activeDialogContext.current = {
      documentId,
      open,
      generation: activeDialogContext.current.generation + 1,
    }
  }
  const dialogContextGeneration = activeDialogContext.current.generation
  const isActiveDialogContext = React.useCallback(() => (
    activeDialogContext.current.generation === dialogContextGeneration
      && activeDialogContext.current.open
  ), [dialogContextGeneration])
  const mutationContextId = `documents-share-dialog:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<ShareMutationContext>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked'),
  })

  const mutationContext = React.useCallback((resourceKind: string, resourceId: string) => ({
    formId: mutationContextId,
    resourceKind,
    resourceId,
    retryLastMutation,
  }), [mutationContextId, retryLastMutation])

  const loadShares = React.useCallback(async () => {
    if (!isActiveDialogContext()) return
    const loadId = ++loadSequence.current
    const controller = new AbortController()
    activeLoad.current?.abort()
    activeLoad.current = controller
    const isCurrent = () => isActiveDialogContext()
      && loadSequence.current === loadId
      && !controller.signal.aborted
    setIsLoading(true)
    setError(null)
    const fallback: SharesResponse = { items: [] }
    try {
      const call = await apiCall<SharesResponse>(
        `/api/documents/${encodeURIComponent(documentId)}/shares`,
        { signal: controller.signal },
        { fallback },
      )
      if (!isCurrent()) return
      if (!call.ok) {
        setError(t('documents.share.dialog.error.load'))
        return
      }
      setShares(readShareItems(call.result ?? fallback, t('documents.share.removedPrincipal')))
    } catch (caught) {
      if (isCurrent()) {
        setError(caught instanceof Error ? caught.message : t('documents.share.dialog.error.load'))
      }
    } finally {
      if (activeLoad.current === controller) activeLoad.current = null
      if (isCurrent()) setIsLoading(false)
    }
  }, [documentId, isActiveDialogContext, t])

  React.useEffect(() => {
    if (!open) {
      loadSequence.current += 1
      activeLoad.current?.abort()
      activeLoad.current = null
      setIsLoading(false)
      return
    }
    void loadShares()
    return () => {
      loadSequence.current += 1
      activeLoad.current?.abort()
      activeLoad.current = null
    }
  }, [loadShares, open])

  const beginShareMutation = React.useCallback((shareId: string) => {
    if (shareMutationsInFlight.current.has(shareId)) return false
    shareMutationsInFlight.current.add(shareId)
    setPendingShareIds((current) => new Set(current).add(shareId))
    return true
  }, [])

  const finishShareMutation = React.useCallback((shareId: string) => {
    shareMutationsInFlight.current.delete(shareId)
    setPendingShareIds((current) => {
      if (!current.has(shareId)) return current
      const next = new Set(current)
      next.delete(shareId)
      return next
    })
  }, [])

  const addShare = React.useCallback(async () => {
    const trimmedPrincipal = principalId.trim()
    if (!trimmedPrincipal || !canManage || submitInFlight.current || !isActiveDialogContext()) return
    submitInFlight.current = true
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
      if (!isActiveDialogContext()) return
      setPrincipalId('')
      setPermission('viewer')
      await loadShares()
      if (!isActiveDialogContext()) return
      flash(t('documents.share.dialog.success.add'), 'success')
    } catch (caught) {
      if (!isActiveDialogContext()) return
      flash(caught instanceof Error ? caught.message : t('documents.share.dialog.error.add'), 'error')
    } finally {
      submitInFlight.current = false
      setIsSubmitting(false)
    }
  }, [canManage, documentId, isActiveDialogContext, loadShares, mutationContext, permission, principalId, principalType, runMutation, t])

  const changePermission = React.useCallback(async (
    share: ShareRow,
    nextPermission: DocumentSharePermission,
  ) => {
    if (!canManage || share.permission === nextPermission || !isActiveDialogContext() || !beginShareMutation(share.id)) return
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
      if (!isActiveDialogContext()) return
      setShares((current) => current.map((row) => (
        row.id === share.id ? { ...row, permission: nextPermission } : row
      )))
      await loadShares()
      if (!isActiveDialogContext()) return
      flash(t('documents.share.dialog.success.update'), 'success')
    } catch (caught) {
      if (!isActiveDialogContext()) return
      if (!surfaceRecordConflict(caught, t, { onRefresh: () => { void loadShares() } })) {
        flash(caught instanceof Error ? caught.message : t('documents.share.dialog.error.update'), 'error')
      }
    } finally {
      finishShareMutation(share.id)
    }
  }, [beginShareMutation, canManage, documentId, finishShareMutation, isActiveDialogContext, loadShares, mutationContext, runMutation, t])

  const removeShare = React.useCallback(async (share: ShareRow) => {
    if (!canManage || !isActiveDialogContext() || !beginShareMutation(share.id)) return
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
      if (!isActiveDialogContext()) return
      setShares((current) => current.filter((row) => row.id !== share.id))
      flash(t('documents.share.dialog.success.remove'), 'success')
    } catch (caught) {
      if (!isActiveDialogContext()) return
      if (!surfaceRecordConflict(caught, t, { onRefresh: () => { void loadShares() } })) {
        flash(caught instanceof Error ? caught.message : t('documents.share.dialog.error.remove'), 'error')
      }
    } finally {
      finishShareMutation(share.id)
    }
  }, [beginShareMutation, canManage, documentId, finishShareMutation, isActiveDialogContext, loadShares, mutationContext, runMutation, t])

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
    pendingShareIds,
    setPrincipalId,
    setPermission,
    changePrincipalType,
    addShare,
    reload: loadShares,
    changePermission,
    removeShare,
  }
}
