"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatFreightDate } from './freightOptions'
import {
  DELIVERY_NOTE_STATUS_FALLBACKS,
  EXTERNAL_WAYBILL_STATUS_FALLBACKS,
  type DeliveryNoteActionMode,
  type FreightDeliveryNoteRow,
} from './deliveryNoteOptions'
import { CreateDeliveryNoteDialog } from './CreateDeliveryNoteDialog'
import { DeliveryNoteActionDialog } from './DeliveryNoteActionDialog'

const RESOURCE = 'freight_operations/delivery-notes'
const ENTITY_ID = 'freight_operations:freight_delivery_note'
const CONTEXT_ID = 'freight_operations.delivery_notes.section'

type DeliveryNotesSectionProps = {
  freightOrderId?: string | null
  freightTripId?: string | null
  sourceLabel?: string | null
  requiresCargoDescription?: boolean
}

export function DeliveryNotesSection({
  freightOrderId,
  freightTripId,
  sourceLabel,
  requiresCargoDescription = false,
}: DeliveryNotesSectionProps) {
  const t = useT()
  const locale = useLocale()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [actionNote, setActionNote] = React.useState<FreightDeliveryNoteRow | null>(null)
  const [actionMode, setActionMode] = React.useState<DeliveryNoteActionMode | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = { pageSize: 50, sortField: 'created_at', sortDir: 'desc' }
    if (freightOrderId) out.freightOrderId = freightOrderId
    if (freightTripId) out.freightTripId = freightTripId
    return out
  }, [freightOrderId, freightTripId])

  const query = useQuery({
    queryKey: ['freight-delivery-notes', params],
    queryFn: () => fetchCrudList<FreightDeliveryNoteRow>(RESOURCE, params),
    enabled: Boolean(freightOrderId || freightTripId),
  })

  const notes = query.data?.items ?? []

  const openAction = React.useCallback((note: FreightDeliveryNoteRow, mode: DeliveryNoteActionMode) => {
    setActionNote(note)
    setActionMode(mode)
  }, [])

  const removeDraft = React.useCallback(async (note: FreightDeliveryNoteRow) => {
    const confirmed = await confirm({
      title: t('freight_operations.delivery_notes.delete.confirm', 'Delete the draft delivery note {number}?', {
        number: note.note_number,
      }),
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(note.updatedAt ?? note.updated_at ?? null),
          () => apiCallOrThrow(`/api/${RESOURCE}`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: note.id }),
          }, {
            errorMessage: t('freight_operations.delivery_notes.delete.error', 'Unable to delete the delivery note.'),
          }),
        ),
        mutationPayload: { operation: 'delivery_notes.delete', id: note.id, updatedAt: note.updatedAt ?? null },
        context: {
          formId: CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: note.id,
          retryLastMutation,
        },
      })
      flash(t('freight_operations.delivery_notes.delete.success', 'Delivery note deleted.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(
        error instanceof Error && error.message
          ? error.message
          : t('freight_operations.delivery_notes.delete.error', 'Unable to delete the delivery note.'),
        'error',
      )
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('freight_operations.delivery_notes.section.title', 'Delivery notes')}
        </h2>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          {t('freight_operations.delivery_notes.actions.create', 'New delivery note')}
        </Button>
      </div>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading', 'Loading…')}</p>
      ) : query.isError ? (
        <p className="text-sm text-status-error-text">
          {t('freight_operations.delivery_notes.error.load', 'Unable to load delivery notes.')}
        </p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('freight_operations.delivery_notes.section.empty', 'No delivery notes yet.')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/backend/freight/delivery-notes/${note.id}`}
                    className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {note.note_number}
                  </Link>
                  <Badge variant="secondary">
                    {t(
                      `freight_operations.delivery_notes.status.${note.status}`,
                      DELIVERY_NOTE_STATUS_FALLBACKS[note.status],
                    )}
                  </Badge>
                  {note.external_waybill_number ? (
                    <span className="text-xs text-muted-foreground">
                      {t('freight_operations.delivery_notes.fields.waybillShort', 'Bayan Naql')}: {note.external_waybill_number}
                    </span>
                  ) : null}
                  {note.external_waybill_status !== 'not_recorded' ? (
                    <Badge variant="secondary">
                      {t(
                        `freight_operations.delivery_notes.waybillStatus.${note.external_waybill_status}`,
                        EXTERNAL_WAYBILL_STATUS_FALLBACKS[note.external_waybill_status],
                      )}
                    </Badge>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t('freight_operations.delivery_notes.section.issued', 'Issued')}: {formatFreightDate(note.issued_at, locale)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {note.status === 'draft' ? (
                  <>
                    <Button type="button" size="sm" onClick={() => openAction(note, 'issue')}>
                      {t('freight_operations.delivery_notes.issue.submit', 'Issue')}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => { void removeDraft(note) }}>
                      {t('freight_operations.delivery_notes.actions.delete', 'Delete')}
                    </Button>
                  </>
                ) : null}
                {note.status === 'issued' ? (
                  <Button type="button" size="sm" onClick={() => openAction(note, 'deliver')}>
                    {t('freight_operations.delivery_notes.actions.recordDelivery', 'Record delivery')}
                  </Button>
                ) : null}
                {(note.status === 'issued' || note.status === 'delivered') &&
                note.external_waybill_status !== 'recorded' ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => openAction(note, 'waybill')}>
                    {t('freight_operations.delivery_notes.actions.recordWaybill', 'Record waybill')}
                  </Button>
                ) : null}
                {note.external_waybill_status === 'recorded' ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => openAction(note, 'waybill_cancel')}>
                    {t('freight_operations.delivery_notes.actions.cancelWaybill', 'Cancel waybill')}
                  </Button>
                ) : null}
                {note.status === 'draft' || note.status === 'issued' ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => openAction(note, 'cancel')}>
                    {t('freight_operations.delivery_notes.actions.cancel', 'Cancel')}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link href={`/backend/freight/delivery-notes/${note.id}`}>
                    {t('freight_operations.delivery_notes.actions.view', 'View')}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CreateDeliveryNoteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        freightOrderId={freightOrderId}
        freightTripId={freightTripId}
        sourceLabel={sourceLabel ?? null}
        requiresCargoDescription={requiresCargoDescription}
        onCreated={() => { void query.refetch() }}
      />
      <DeliveryNoteActionDialog
        note={actionNote}
        mode={actionMode}
        onOpenChange={(open) => {
          if (!open) {
            setActionNote(null)
            setActionMode(null)
          }
        }}
        onCompleted={() => { void query.refetch() }}
      />
      {ConfirmDialogElement}
    </section>
  )
}
