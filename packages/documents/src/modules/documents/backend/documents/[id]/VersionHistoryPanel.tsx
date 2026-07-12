"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Clock, Eye, History, Save } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  normalizeDocumentContent,
  readArrayPayload,
} from '../documentUi'
import { resolveVersionRestoreCapability, type DocumentTier } from './componentCapabilities'
import { restoreVersionWithObservedContentToken } from './restoreVersion'
import type { VersionPreview } from './VersionPreviewDialog'
import { normalizeVersion, type DocumentVersion } from './versionHistoryModel'

const VersionPreviewDialog = dynamic(
  () => import('./VersionPreviewDialog').then((module) => module.VersionPreviewDialog),
  { ssr: false, loading: () => null },
)

type VersionsState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; versions: DocumentVersion[] }
type VersionHistoryPanelProps = {
  documentId: string
  /** Legacy compatibility; an explicit capability projection takes precedence. */
  tier?: DocumentTier
  canRestore?: boolean
  contentUpdatedAt?: string | null
  onRestored?: () => void
}

export { resolveVersionRestoreCapability } from './componentCapabilities'
export { normalizeVersion } from './versionHistoryModel'

export function VersionHistoryPanel({
  documentId,
  tier,
  canRestore,
  contentUpdatedAt,
  onRestored,
}: VersionHistoryPanelProps) {
  const t = useT()
  const mayRestore = resolveVersionRestoreCapability(canRestore, tier)
  const labelInputId = React.useId()
  const [state, setState] = React.useState<VersionsState>({ status: 'loading' })
  const [label, setLabel] = React.useState('')
  const [isCreating, setIsCreating] = React.useState(false)
  const [restoringVersionId, setRestoringVersionId] = React.useState<string | null>(null)
  const [previewVersionId, setPreviewVersionId] = React.useState<string | null>(null)
  const observedContentUpdatedAt = React.useRef<string | null>(contentUpdatedAt ?? null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const mutationContextId = `documents-versions:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const reload = React.useCallback(async () => {
    setState((current) => current.status === 'ready' ? current : { status: 'loading' })
    try {
      const call = await apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/versions`)
      if (!call.ok) return setState({ status: 'error', message: t('documents.versions.error.load') })
      setState({
        status: 'ready',
        versions: readArrayPayload(call.result, 'items', 'data')
          .map((version) => normalizeVersion(version, t('documents.users.unknown')))
          .filter((version): version is DocumentVersion => version !== null),
      })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : t('documents.versions.error.load') })
    }
  }, [documentId, t])

  React.useEffect(() => { void reload() }, [reload])

  React.useEffect(() => {
    if (contentUpdatedAt !== undefined) {
      observedContentUpdatedAt.current = contentUpdatedAt
      return
    }

    // Legacy deep-import callers do not have the additive contentUpdatedAt
    // prop. Observe a token when the panel mounts, never immediately before a
    // restore, so a collaborator edit after this read correctly produces 409.
    let active = true
    void apiCall<unknown>(`/api/documents/${encodeURIComponent(documentId)}/content`)
      .then((call) => {
        if (active && call.ok) {
          observedContentUpdatedAt.current = normalizeDocumentContent(call.result).updatedAt
        }
      })
      .catch(() => { if (active) observedContentUpdatedAt.current = null })
    return () => { active = false }
  }, [contentUpdatedAt, documentId])

  const handleSnapshot = React.useCallback(async () => {
    if (!mayRestore) return
    setIsCreating(true)
    const nextLabel = label.trim() || null
    try {
      await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(documentId)}/versions`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: nextLabel }) },
          { errorMessage: t('documents.versions.error.save') },
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document_version', resourceId: documentId, retryLastMutation },
        mutationPayload: { label: nextLabel },
      })
      setLabel('')
      await reload()
      flash(t('documents.versions.snapshot.created'), 'success')
    } catch (error) {
      flash(error instanceof Error ? error.message : t('documents.versions.error.save'), 'error')
    } finally { setIsCreating(false) }
  }, [documentId, label, mayRestore, mutationContextId, reload, retryLastMutation, runMutation, t])

  const handleRestore = React.useCallback(async (version: VersionPreview) => {
    if (!mayRestore) return
    const confirmed = await confirm({
      title: t('documents.versions.restore.confirmTitle'),
      text: t('documents.versions.restore.confirmBody'),
      confirmText: t('documents.versions.actions.restore'),
      variant: 'default',
    })
    if (!confirmed) return
    setRestoringVersionId(version.id)
    try {
      const call = await runMutation({
        operation: () => restoreVersionWithObservedContentToken({
          documentId,
          versionId: version.id,
          contentUpdatedAt: observedContentUpdatedAt.current,
          errorMessage: t('documents.versions.error.restore'),
        }),
        context: { formId: mutationContextId, resourceKind: 'documents.document_version', resourceId: version.id, retryLastMutation },
        mutationPayload: { action: 'restore', versionId: version.id },
      })
      observedContentUpdatedAt.current = normalizeDocumentContent(call.result).updatedAt
      setPreviewVersionId(null)
      await reload()
      onRestored?.()
      flash(t('documents.versions.restored'), 'success')
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: onRestored })) {
        flash(error instanceof Error ? error.message : t('documents.versions.error.restore'), 'error')
      }
    } finally { setRestoringVersionId(null) }
  }, [confirm, documentId, mayRestore, mutationContextId, onRestored, reload, retryLastMutation, runMutation, t])

  const versions = state.status === 'ready' ? state.versions : []
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center gap-2"><History className="size-4 text-muted-foreground" aria-hidden="true" /><h2 className="text-sm font-semibold">{t('documents.versions.title')}</h2></div>
      <div className="space-y-4">
        {mayRestore ? (
          <form className="space-y-3 rounded-lg border border-border bg-muted/20 p-3" onSubmit={(event) => { event.preventDefault(); void handleSnapshot() }} onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void handleSnapshot() }
            if (event.key === 'Escape') setLabel('')
          }}>
            <Label htmlFor={labelInputId}>{t('documents.versions.snapshot.labelPlaceholder')}</Label>
            <Input id={labelInputId} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t('documents.versions.snapshot.labelPlaceholder')} disabled={isCreating} />
            <Button type="submit" disabled={isCreating}><Save />{t('documents.versions.actions.snapshot')}</Button>
          </form>
        ) : null}
        {state.status === 'loading' ? <LoadingMessage label={t('documents.versions.loading')} /> : null}
        {state.status === 'error' ? <ErrorMessage label={state.message} /> : null}
        {state.status === 'ready' && versions.length === 0 ? <EmptyState size="sm" variant="subtle" title={t('documents.versions.empty')} icon={<History className="size-5" />} /> : null}
        {versions.map((version) => (
          <article key={version.id} className="space-y-3 rounded-lg border border-border bg-background p-3">
            <p className="text-sm font-medium">{version.label ?? t('documents.versions.snapshot.defaultLabel')}</p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="size-3" aria-hidden="true" />{new Date(version.createdAt).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{version.creatorLabel || t('documents.users.unknown')}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setPreviewVersionId(version.id)}><Eye />{t('documents.versions.actions.preview')}</Button>
          </article>
        ))}
      </div>
      {previewVersionId ? <VersionPreviewDialog documentId={documentId} versionId={previewVersionId} canRestore={mayRestore} isRestoring={restoringVersionId !== null} onOpenChange={(open) => { if (!open) setPreviewVersionId(null) }} onRestore={(version) => void handleRestore(version)} /> : null}
      {ConfirmDialogElement}
    </section>
  )
}

export default VersionHistoryPanel
