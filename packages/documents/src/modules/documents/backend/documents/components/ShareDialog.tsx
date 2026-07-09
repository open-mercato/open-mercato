"use client"

import * as React from 'react'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PrincipalPicker } from './PrincipalPicker'

type DocumentSharePrincipalType = 'user' | 'role'
type DocumentSharePermission = 'viewer' | 'commenter' | 'editor'

type ShareRow = {
  id: string
  principalType: DocumentSharePrincipalType
  principalId: string
  principalLabel: string
  permission: DocumentSharePermission
  updatedAt?: string | null
}

type SharesResponse = {
  items?: unknown[]
  data?: unknown[]
  shares?: unknown[]
}

type ShareDialogProps = {
  documentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  canManage?: boolean
}

const SHARE_PERMISSIONS: DocumentSharePermission[] = ['viewer', 'commenter', 'editor']
const PRINCIPAL_TYPES: DocumentSharePrincipalType[] = ['user', 'role']

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function readPrincipalType(value: string | null): DocumentSharePrincipalType {
  return value === 'role' ? 'role' : 'user'
}

function readPermission(value: string | null): DocumentSharePermission {
  if (value === 'commenter' || value === 'editor') return value
  return 'viewer'
}

function normalizeShare(value: unknown): ShareRow | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const principalId = readString(record, 'principalId', 'principal_id')
  if (!id || !principalId) return null
  const principalType = readPrincipalType(readString(record, 'principalType', 'principal_type'))
  const permission = readPermission(readString(record, 'permission', 'tier'))
  const label =
    readString(record, 'principalLabel', 'principal_label', 'principalEmail', 'principal_email', 'name', 'email') ??
    principalId
  return {
    id,
    principalId,
    principalType,
    principalLabel: label,
    permission,
    updatedAt: readString(record, 'updatedAt', 'updated_at'),
  }
}

function readShareItems(payload: SharesResponse | unknown[] | null): ShareRow[] {
  if (Array.isArray(payload)) return payload.map(normalizeShare).filter((row): row is ShareRow => row !== null)
  const record = readRecord(payload)
  if (!record) return []
  const candidates = [record.items, record.data, record.shares]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(normalizeShare).filter((row): row is ShareRow => row !== null)
    }
  }
  return []
}

export function ShareDialog({ documentId, open, onOpenChange, canManage = true }: ShareDialogProps) {
  const t = useT()
  const principalInputId = React.useId()
  const [shares, setShares] = React.useState<ShareRow[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [principalType, setPrincipalType] = React.useState<DocumentSharePrincipalType>('user')
  const [principalId, setPrincipalId] = React.useState('')
  const [permission, setPermission] = React.useState<DocumentSharePermission>('viewer')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const mutationContextId = `documents-share-dialog:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

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
      setShares(readShareItems(call.result ?? fallback))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('documents.share.dialog.error.load'))
    } finally {
      setIsLoading(false)
    }
  }, [documentId, t])

  React.useEffect(() => {
    if (!open) return
    void loadShares()
  }, [loadShares, open])

  const handleAddShare = React.useCallback(async () => {
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
              body: JSON.stringify({
                principalType,
                principalId: trimmedPrincipal,
                permission,
              }),
            },
            { errorMessage: t('documents.share.dialog.error.add') },
          )
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_share',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: {
          principalType,
          principalId: trimmedPrincipal,
          permission,
        },
      })
      setPrincipalId('')
      setPermission('viewer')
      await loadShares()
      flash(t('documents.share.dialog.success.add'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.share.dialog.error.add'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    canManage,
    documentId,
    loadShares,
    mutationContextId,
    permission,
    principalId,
    principalType,
    retryLastMutation,
    runMutation,
    t,
  ])

  const handlePermissionChange = React.useCallback(async (share: ShareRow, nextPermission: DocumentSharePermission) => {
    if (!canManage || share.permission === nextPermission) return
    try {
      await runMutation({
        operation: async () => {
          await withScopedApiRequestHeaders(
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
          )
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_share',
          resourceId: share.id,
          retryLastMutation,
        },
        mutationPayload: { id: share.id, permission: nextPermission },
      })
      setShares((previous) =>
        previous.map((row) => row.id === share.id ? { ...row, permission: nextPermission } : row),
      )
      await loadShares()
      flash(t('documents.share.dialog.success.update'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.share.dialog.error.update'), 'error')
    }
  }, [canManage, documentId, loadShares, mutationContextId, retryLastMutation, runMutation, t])

  const handleRemoveShare = React.useCallback(async (share: ShareRow) => {
    if (!canManage) return
    try {
      await runMutation({
        operation: async () => {
          await withScopedApiRequestHeaders(
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
          )
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_share',
          resourceId: share.id,
          retryLastMutation,
        },
        mutationPayload: { id: share.id },
      })
      setShares((previous) => previous.filter((row) => row.id !== share.id))
      flash(t('documents.share.dialog.success.remove'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.share.dialog.error.remove'), 'error')
    }
  }, [canManage, documentId, mutationContextId, retryLastMutation, runMutation, t])

  const submitAddShare = React.useCallback((event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    void handleAddShare()
  }, [handleAddShare])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void handleAddShare()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('documents.share.dialog.title')}</DialogTitle>
          <DialogDescription>{t('documents.share.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <form className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 md:grid-cols-3" onSubmit={submitAddShare}>
            <div className="space-y-2">
              <Label htmlFor={principalInputId}>{t('documents.share.dialog.principal')}</Label>
              <PrincipalPicker
                id={principalInputId}
                principalType={principalType}
                value={principalId || null}
                onChange={(id) => setPrincipalId(id ?? '')}
                disabled={!canManage || isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('documents.share.dialog.principalType')}</Label>
              <Select
                value={principalType}
                onValueChange={(value) => {
                  setPrincipalType(readPrincipalType(value))
                  setPrincipalId('')
                }}
                disabled={!canManage || isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRINCIPAL_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`documents.share.principalTypes.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('documents.share.dialog.permission')}</Label>
              <Select
                value={permission}
                onValueChange={(value) => setPermission(readPermission(value))}
                disabled={!canManage || isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHARE_PERMISSIONS.map((tier) => (
                    <SelectItem key={tier} value={tier}>
                      {t(`documents.permissions.${tier}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Button type="submit" disabled={!canManage || isSubmitting || principalId.trim().length === 0}>
                {t('documents.share.dialog.add')}
              </Button>
            </div>
          </form>

          {!canManage ? (
            <p className="rounded border border-status-info-border bg-status-info-bg px-3 py-2 text-sm text-status-info-text">
              {t('documents.share.dialog.readOnly')}
            </p>
          ) : null}

          {isLoading ? (
            <LoadingMessage label={t('documents.share.dialog.loading')} />
          ) : error ? (
            <ErrorMessage label={error} />
          ) : shares.length === 0 ? (
            <p className="rounded border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {t('documents.share.dialog.empty')}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('documents.share.dialog.current')}</p>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {shares.map((share) => (
                  <div
                    key={share.id}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{share.principalLabel}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t(`documents.share.principalTypes.${share.principalType}`)} - {share.principalId}
                      </p>
                    </div>
                    <div className="md:w-48">
                    <Select
                      value={share.permission}
                      onValueChange={(value) => void handlePermissionChange(share, readPermission(value))}
                      disabled={!canManage}
                    >
                      <SelectTrigger aria-label={t('documents.share.dialog.permission')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHARE_PERMISSIONS.map((tier) => (
                          <SelectItem key={tier} value={tier}>
                            {t(`documents.permissions.${tier}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    </div>
                    <Button
                      type="button"
                      variant="destructive-outline"
                      onClick={() => void handleRemoveShare(share)}
                      disabled={!canManage}
                    >
                      {t('documents.actions.unshare')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('documents.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
