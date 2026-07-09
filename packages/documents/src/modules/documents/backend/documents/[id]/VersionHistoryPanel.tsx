"use client"

import * as React from 'react'
import { Clock, History, RotateCcw, Save } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type DocumentTier = 'owner' | 'editor' | 'commenter' | 'viewer'

type DocumentVersion = {
  id: string
  label: string | null
  createdByLabel: string | null
  createdAt: string
}

type VersionHistoryPanelProps = {
  documentId: string
  tier: DocumentTier
  onRestored?: () => void
}

type VersionsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; versions: DocumentVersion[] }

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

function readNullableString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (value === null) return null
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function normalizeVersion(value: unknown): DocumentVersion | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const createdAt = readString(record, 'createdAt', 'created_at')
  if (!id || !createdAt) return null
  return {
    id,
    label: readNullableString(record, 'label'),
    createdByLabel: readNullableString(record, 'createdByLabel', 'created_by_label'),
    createdAt,
  }
}

function readVersionItems(payload: unknown): DocumentVersion[] {
  if (Array.isArray(payload)) return payload.map(normalizeVersion).filter((version): version is DocumentVersion => version !== null)
  const record = readRecord(payload)
  if (!record) return []
  const candidates = [record.items, record.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(normalizeVersion).filter((version): version is DocumentVersion => version !== null)
    }
  }
  return []
}

function canEditVersions(tier: DocumentTier): boolean {
  return tier === 'editor' || tier === 'owner'
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

export function VersionHistoryPanel({ documentId, tier, onRestored }: VersionHistoryPanelProps) {
  const t = useT()
  const labelInputId = React.useId()
  const [state, setState] = React.useState<VersionsState>({ status: 'loading' })
  const [label, setLabel] = React.useState('')
  const [isCreating, setIsCreating] = React.useState(false)
  const [restoringVersionId, setRestoringVersionId] = React.useState<string | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const mutationContextId = `documents-versions:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked'),
  })

  const reload = React.useCallback(async () => {
    setState((current) => current.status === 'ready' ? current : { status: 'loading' })
    try {
      const call = await apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/versions`)
      if (!call.ok) {
        setState({ status: 'error', message: t('documents.versions.error.load') })
        return
      }
      setState({ status: 'ready', versions: readVersionItems(call.result) })
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : t('documents.versions.error.load') })
    }
  }, [documentId, t])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const canEdit = canEditVersions(tier)

  const handleSnapshot = React.useCallback(async () => {
    if (!canEdit) return
    setIsCreating(true)
    const trimmedLabel = label.trim()
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/versions`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ label: trimmedLabel.length > 0 ? trimmedLabel : null }),
            },
            { errorMessage: t('documents.versions.error.save') },
          )
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_version',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { label: trimmedLabel.length > 0 ? trimmedLabel : null },
      })
      setLabel('')
      await reload()
      flash(t('documents.versions.snapshot.created'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.versions.error.save'), 'error')
    } finally {
      setIsCreating(false)
    }
  }, [canEdit, documentId, label, mutationContextId, reload, retryLastMutation, runMutation, t])

  const handleRestore = React.useCallback(async (version: DocumentVersion) => {
    if (!canEdit) return
    const confirmed = await confirm({
      title: t('documents.versions.restore.confirmTitle'),
      text: t('documents.versions.restore.confirmBody'),
      confirmText: t('documents.versions.actions.restore'),
      variant: 'default',
    })
    if (!confirmed) return
    setRestoringVersionId(version.id)
    try {
      await runMutation({
        operation: async () => {
          await apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(version.id)}/restore`,
            { method: 'POST' },
            { errorMessage: t('documents.versions.error.restore') },
          )
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_version',
          resourceId: version.id,
          retryLastMutation,
        },
        mutationPayload: { action: 'restore', versionId: version.id },
      })
      await reload()
      onRestored?.()
      flash(t('documents.versions.restored'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.versions.error.restore'), 'error')
    } finally {
      setRestoringVersionId(null)
    }
  }, [canEdit, confirm, documentId, mutationContextId, onRestored, reload, retryLastMutation, runMutation, t])

  const versions = state.status === 'ready' ? state.versions : []

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2">
        <History className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{t('documents.versions.title')}</h2>
      </div>

      <div className="space-y-4">
        {canEdit ? (
          <form
            className="space-y-3 rounded-lg border border-border bg-muted/20 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSnapshot()
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void handleSnapshot()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setLabel('')
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor={labelInputId}>{t('documents.versions.snapshot.labelPlaceholder')}</Label>
              <Input
                id={labelInputId}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t('documents.versions.snapshot.labelPlaceholder')}
                disabled={isCreating}
              />
            </div>
            <Button type="submit" disabled={isCreating}>
              <Save />
              {t('documents.versions.actions.snapshot')}
            </Button>
          </form>
        ) : null}

        {state.status === 'loading' ? (
          <LoadingMessage label={t('documents.versions.loading')} />
        ) : state.status === 'error' ? (
          <ErrorMessage label={state.message} />
        ) : versions.length === 0 ? (
          <EmptyState
            size="sm"
            variant="subtle"
            title={t('documents.versions.empty')}
            icon={<History className="size-5" />}
          />
        ) : (
          <div className="space-y-3">
            {versions.map((version) => (
              <article key={version.id} className="space-y-3 rounded-lg border border-border bg-background p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{version.label ?? t('documents.versions.snapshot.defaultLabel')}</p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="size-3" aria-hidden="true" />
                    {formatDateTime(version.createdAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">{version.createdByLabel ?? t('documents.users.unknown')}</p>
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRestore(version)}
                    disabled={restoringVersionId === version.id}
                  >
                    <RotateCcw />
                    {t('documents.versions.actions.restore')}
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
      {ConfirmDialogElement}
    </section>
  )
}

export default VersionHistoryPanel
