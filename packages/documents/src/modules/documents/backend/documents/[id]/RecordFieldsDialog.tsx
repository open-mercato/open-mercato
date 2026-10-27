"use client"

import * as React from 'react'
import { Link2 } from 'lucide-react'
import type { Editor } from '@tiptap/core'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getEntityRegistryEntry } from '../../../lib/entityRegistry'
import {
  insertRecordFieldSnapshot,
  type RecordFieldSnapshot,
} from '../../../lib/recordFieldInsertion'
import { readArrayPayload } from '../documentUi'
import { normalizeRelatedRecord, type RelatedRecord } from './relatedRecordModel'

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; record: RelatedRecord | null }

type RecordFieldsDialogProps = {
  documentId: string
  linkId: string | null
  editor: Editor | null
  canInsert: boolean
  onOpenChange: (open: boolean) => void
}

export function RecordFieldsDialog({
  documentId,
  linkId,
  editor,
  canInsert,
  onOpenChange,
}: RecordFieldsDialogProps) {
  const t = useT()
  const open = linkId !== null && canInsert
  const [state, setState] = React.useState<LoadState>({ status: 'idle' })
  const [selectedFields, setSelectedFields] = React.useState<Set<string>>(() => new Set())
  const [loadAttempt, setLoadAttempt] = React.useState(0)

  React.useEffect(() => {
    if (linkId !== null && !canInsert) onOpenChange(false)
  }, [canInsert, linkId, onOpenChange])

  React.useEffect(() => {
    if (!open || !linkId) {
      setState({ status: 'idle' })
      setSelectedFields(new Set())
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    setSelectedFields(new Set())
    void apiCall<unknown>(
      `/api/documents/${encodeURIComponent(documentId)}/links`,
      { cache: 'no-store', signal: controller.signal },
    ).then((call) => {
      if (controller.signal.aborted) return
      if (!call.ok) {
        setState({ status: 'error' })
        return
      }
      const record = readArrayPayload(call.result, 'items', 'data')
        .map((value) => normalizeRelatedRecord(value, t('documents.relatedRecords.restricted')))
        .find((item): item is RelatedRecord => item?.id === linkId) ?? null
      setState({ status: 'ready', record })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: 'error' })
    })
    return () => controller.abort()
  }, [documentId, linkId, loadAttempt, open, t])

  const retry = React.useCallback(() => {
    setState({ status: 'loading' })
    setLoadAttempt((current) => current + 1)
  }, [])

  const fields = React.useMemo<RecordFieldSnapshot[]>(() => {
    if (state.status !== 'ready' || !state.record?.canOpen) return []
    const entry = getEntityRegistryEntry(state.record.entityType)
    if (!entry) return []
    return entry.tokenFields.flatMap((tokenField) => {
      const value = state.record?.values[tokenField.field]
      return value ? [{
        field: tokenField.field,
        label: t(tokenField.labelKey),
        value,
      }] : []
    })
  }, [state, t])

  const selected = React.useMemo(
    () => fields.filter((field) => selectedFields.has(field.field)),
    [fields, selectedFields],
  )
  const insert = React.useCallback(() => {
    if (!canInsert || !editor?.isEditable || selected.length === 0) return
    if (insertRecordFieldSnapshot(editor, selected)) onOpenChange(false)
  }, [canInsert, editor, onOpenChange, selected])
  const setOpen = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen) onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg" onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onOpenChange(false)
          return
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          insert()
        }
      }}>
        <DialogHeader>
          <DialogTitle>{t('documents.relatedRecords.actions.insertData')}</DialogTitle>
          <DialogDescription>{t('documents.relatedRecords.fields.snapshotDisclosure')}</DialogDescription>
        </DialogHeader>

        {state.status === 'loading' ? <LoadingMessage label={t('documents.relatedRecords.loading')} /> : null}
        {state.status === 'error' ? (
          <ErrorMessage
            label={t('documents.relatedRecords.error.load')}
            action={<Button type="button" size="sm" variant="outline" onClick={retry}>{t('documents.actions.retry')}</Button>}
          />
        ) : null}
        {state.status === 'ready' && fields.length === 0 ? (
          <EmptyState
            size="sm"
            variant="subtle"
            title={t('documents.relatedRecords.fields.empty')}
            icon={<Link2 className="size-5" />}
          />
        ) : null}
        {state.status === 'ready' && fields.length > 0 ? (
          <div className="space-y-3">
            {fields.map((field) => (
              <CheckboxField
                key={field.field}
                label={field.label}
                description={field.value}
                checked={selectedFields.has(field.field)}
                onCheckedChange={(checked) => setSelectedFields((current) => {
                  const next = new Set(current)
                  if (checked === true) next.add(field.field)
                  else next.delete(field.field)
                  return next
                })}
              />
            ))}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('documents.actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={insert}
            disabled={!canInsert || !editor?.isEditable || selected.length === 0}
          >
            {t('documents.relatedRecords.fields.insertSelected')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
