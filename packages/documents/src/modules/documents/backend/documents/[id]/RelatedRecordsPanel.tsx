"use client"

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, FileInput, Link2, Unlink } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getEntityRegistryEntry, type DocumentEntityType } from '../../../lib/entityRegistry'
import { readArrayPayload } from '../documentUi'
import { EntityPicker } from '../components/EntityPicker'
import { RecordFieldsDialog } from './RecordFieldsDialog'
import { normalizeRelatedRecord, type RelatedRecord } from './relatedRecordModel'

type RelatedRecordsPanelProps = { documentId: string; canEdit: boolean; editor: Editor | null }
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: RelatedRecord[] }

function hasInsertableValues(item: RelatedRecord): boolean {
  return Object.values(item.values).some((value) => value !== null)
}

function useEditorEditable(editor: Editor | null): boolean {
  const [editable, setEditable] = React.useState(false)
  React.useEffect(() => {
    const sync = () => setEditable(Boolean(editor && !editor.isDestroyed && editor.isEditable))
    sync()
    editor?.on('update', sync)
    editor?.on('destroy', sync)
    return () => {
      editor?.off('update', sync)
      editor?.off('destroy', sync)
    }
  }, [editor])
  return editable
}

type BacklinkItem = { id: string; title: string }
type BacklinksState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: BacklinkItem[]; total: number }

function BacklinksSection({ documentId }: { documentId: string }) {
  const t = useT()
  const [state, setState] = React.useState<BacklinksState>({ status: 'loading' })
  const requestSequence = React.useRef(0)

  const load = React.useCallback(async () => {
    const requestId = ++requestSequence.current
    setState({ status: 'loading' })
    const call = await apiCall<unknown>(
      `/api/documents?entityType=document&entityId=${encodeURIComponent(documentId)}&pageSize=10`,
      undefined,
      { fallback: null },
    )
    if (requestSequence.current !== requestId) return
    if (!call.ok) return setState({ status: 'error' })
    const items = readArrayPayload(call.result)
      .flatMap((candidate) => {
        const record = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
          ? candidate as Record<string, unknown>
          : null
        const id = typeof record?.id === 'string' ? record.id : null
        const title = typeof record?.title === 'string' && record.title.trim().length > 0 ? record.title : null
        return id && title ? [{ id, title }] : []
      })
    const payloadRecord = call.result && typeof call.result === 'object' && !Array.isArray(call.result)
      ? call.result as Record<string, unknown>
      : null
    const total = typeof payloadRecord?.total === 'number' ? payloadRecord.total : items.length
    setState({ status: 'ready', items, total })
  }, [documentId])

  React.useEffect(() => {
    void load()
    return () => { requestSequence.current += 1 }
  }, [load])

  return (
    <div className="mt-4 border-t border-border pt-3">
      <SectionHeader
        title={t('documents.relatedRecords.referencedBy.title')}
        count={state.status === 'ready' ? state.total : undefined}
      />
      <div className="mt-2">
        {state.status === 'loading' ? <LoadingMessage label={t('documents.relatedRecords.loading')} /> : null}
        {state.status === 'error' ? (
          <ErrorMessage label={t('documents.relatedRecords.error.load')} action={(
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t('documents.actions.retry')}</Button>
          )} />
        ) : null}
        {state.status === 'ready' && state.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('documents.relatedRecords.referencedBy.empty')}</p>
        ) : null}
        {state.status === 'ready' && state.items.length > 0 ? (
          <>
            <ul className="space-y-1">
              {state.items.map((item) => (
                <li key={item.id}>
                  <Link href={`/backend/documents/${encodeURIComponent(item.id)}`} className="text-sm font-medium hover:underline">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
            {state.total > state.items.length ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('documents.relatedRecords.referencedBy.more', { count: state.total - state.items.length })}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

export function RelatedRecordsPanel({ documentId, canEdit, editor }: RelatedRecordsPanelProps) {
  const t = useT()
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [recordFieldsLinkId, setRecordFieldsLinkId] = React.useState<string | null>(null)
  const reloadSequence = React.useRef(0)
  const activeReload = React.useRef<AbortController | null>(null)
  const activeDocumentId = React.useRef<string | null>(null)
  const currentDocumentIdRef = React.useRef(documentId)
  currentDocumentIdRef.current = documentId
  const editorEditable = useEditorEditable(editor)
  const canInsert = canEdit && editorEditable
  const mutationContextId = `documents-related-records:${documentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const reload = React.useCallback(async () => {
    if (currentDocumentIdRef.current !== documentId) return
    const reloadId = ++reloadSequence.current
    const controller = new AbortController()
    activeReload.current?.abort()
    activeReload.current = controller
    const isCurrent = () => currentDocumentIdRef.current === documentId
      && reloadSequence.current === reloadId
      && !controller.signal.aborted
    const documentChanged = activeDocumentId.current !== documentId
    activeDocumentId.current = documentId
    setState((current) => !documentChanged && current.status === 'ready' ? current : { status: 'loading' })
    try {
      const call = await apiCall<unknown>(
        `/api/documents/${encodeURIComponent(documentId)}/links`,
        { signal: controller.signal },
      )
      if (!isCurrent()) return
      if (!call.ok) {
        setState({ status: 'error', message: t('documents.relatedRecords.error.load') })
        return
      }
      const items = readArrayPayload(call.result, 'items', 'data')
        .map((value) => normalizeRelatedRecord(value, t('documents.relatedRecords.restricted')))
        .filter((item): item is RelatedRecord => item !== null)
      setState({ status: 'ready', items })
    } catch (error) {
      if (!isCurrent()) return
      setState({ status: 'error', message: error instanceof Error ? error.message : t('documents.relatedRecords.error.load') })
    } finally {
      if (activeReload.current === controller) activeReload.current = null
    }
  }, [documentId, t])

  React.useEffect(() => {
    void reload()
    return () => {
      reloadSequence.current += 1
      activeReload.current?.abort()
      activeReload.current = null
    }
  }, [reload])

  const handleLink = React.useCallback(async (pick: { type: DocumentEntityType; id: string; label: string; href: string }) => {
    try {
      await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(documentId)}/links`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              entityType: pick.type,
              entityId: pick.id,
              label: pick.label,
              href: pick.href,
              source: 'related-panel',
            }),
          },
          { errorMessage: t('documents.relatedRecords.error.link') },
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_entity_link',
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: { entityType: pick.type, entityId: pick.id },
      })
      if (currentDocumentIdRef.current !== documentId) return
      await reload()
      if (currentDocumentIdRef.current !== documentId) return
      flash(t('documents.relatedRecords.success.link'), 'success')
    } catch (error) {
      if (currentDocumentIdRef.current !== documentId) return
      flash(error instanceof Error ? error.message : t('documents.relatedRecords.error.link'), 'error')
    }
  }, [documentId, mutationContextId, reload, retryLastMutation, runMutation, t])

  const handleUnlink = React.useCallback(async (item: RelatedRecord) => {
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(item.updatedAt),
          () => apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/links/${encodeURIComponent(item.id)}`,
            { method: 'DELETE' },
            { errorMessage: t('documents.relatedRecords.error.unlink') },
          ),
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'documents.document_entity_link',
          resourceId: item.id,
          retryLastMutation,
        },
        mutationPayload: { linkId: item.id },
      })
      if (currentDocumentIdRef.current !== documentId) return
      await reload()
      if (currentDocumentIdRef.current !== documentId) return
      if (recordFieldsLinkId === item.id) setRecordFieldsLinkId(null)
      flash(t('documents.relatedRecords.success.unlink'), 'success')
    } catch (error) {
      if (currentDocumentIdRef.current !== documentId) return
      if (surfaceRecordConflict(error, t, { onRefresh: () => { void reload() } })) return
      flash(error instanceof Error ? error.message : t('documents.relatedRecords.error.unlink'), 'error')
    }
  }, [documentId, mutationContextId, recordFieldsLinkId, reload, retryLastMutation, runMutation, t])

  const items = state.status === 'ready' ? state.items : []
  return (
    <section className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <SectionHeader
        title={t('documents.relatedRecords.title')}
        count={items.length}
        action={canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Link2 />{t('documents.relatedRecords.actions.link')}
          </Button>
        ) : undefined}
      />
      <div className="mt-4">
        {state.status === 'loading' ? <LoadingMessage label={t('documents.relatedRecords.loading')} /> : null}
        {state.status === 'error' ? <ErrorMessage label={state.message} action={(
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>{t('documents.actions.retry')}</Button>
        )} /> : null}
        {state.status === 'ready' && items.length === 0 ? (
          <EmptyState size="sm" variant="subtle" title={t('documents.relatedRecords.empty')} icon={<Link2 className="size-5" />} />
        ) : null}
        {state.status === 'ready' && items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-md border border-border p-2.5">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <Tag variant="neutral">
                    {t(getEntityRegistryEntry(item.entityType)?.labelKey ?? 'documents.relatedRecords.restricted')}
                  </Tag>
                </div>
                <div className="mt-2 flex max-w-full flex-wrap items-center justify-end gap-0.5 border-t border-border pt-1.5">
                  {item.canOpen && hasInsertableValues(item) && canInsert ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRecordFieldsLinkId(item.id)}>
                      <FileInput />{t('documents.relatedRecords.actions.insertData')}
                    </Button>
                  ) : null}
                  {item.canOpen && item.href ? (
                    <LinkButton asChild size="sm" variant="gray">
                      <Link href={item.href}><ExternalLink />{t('documents.actions.open')}</Link>
                    </LinkButton>
                  ) : null}
                  {canEdit ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => void handleUnlink(item)}>
                      <Unlink />{t('documents.relatedRecords.actions.unlink')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <BacklinksSection documentId={documentId} />
      {canEdit ? <EntityPicker open={pickerOpen} onOpenChange={setPickerOpen} onPick={(pick) => void handleLink(pick)} excludeId={documentId} /> : null}
      <RecordFieldsDialog
        documentId={documentId}
        linkId={recordFieldsLinkId}
        editor={editor}
        canInsert={canInsert}
        onOpenChange={(open) => { if (!open) setRecordFieldsLinkId(null) }}
      />
    </section>
  )
}

export default RelatedRecordsPanel
