"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatFreightAmount } from './freightOptions'
import type { AbstractLineRow } from './AbstractLinesSection'
import type { AbstractActionTarget } from './AbstractActionDialog'

const CONTEXT_ID = 'freight_operations.abstracts.respond'

export type RespondDraft = { disputed: boolean; note: string }

export function buildRespondPayload(
  lines: AbstractLineRow[],
  drafts: Record<string, RespondDraft>,
): { acceptedLineIds: string[]; disputedLines: Array<{ lineId: string; note: string }> } {
  const acceptedLineIds: string[] = []
  const disputedLines: Array<{ lineId: string; note: string }> = []
  for (const line of lines) {
    const draft = drafts[line.id]
    if (draft?.disputed) disputedLines.push({ lineId: line.id, note: draft.note.trim() })
    else acceptedLineIds.push(line.id)
  }
  return { acceptedLineIds, disputedLines }
}

/**
 * Records what the customer answered outside the portal. Every line defaults to
 * accepted — the operator ticks exactly the ones the customer disputed, and a
 * disputed line must carry the customer's reason: the abstract cannot leave this
 * dialog in a disputed state without one.
 */
export function AbstractRespondDialog({
  target,
  lines,
  currencyCode,
  open,
  onOpenChange,
  onResponded,
}: {
  target: AbstractActionTarget | null
  lines: AbstractLineRow[]
  currencyCode: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onResponded: () => void
}) {
  const t = useT()
  const [drafts, setDrafts] = React.useState<Record<string, RespondDraft>>({})
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!open) return
    const next: Record<string, RespondDraft> = {}
    for (const line of lines) next[line.id] = { disputed: false, note: '' }
    setDrafts(next)
    setError(null)
  }, [open, lines])

  const update = React.useCallback((lineId: string, patch: Partial<RespondDraft>) => {
    setDrafts((prev) => {
      const base: RespondDraft = { disputed: false, note: '' }
      return { ...prev, [lineId]: { ...base, ...prev[lineId], ...patch } }
    })
  }, [])

  const submit = React.useCallback(async () => {
    if (!target) return
    const payload = buildRespondPayload(lines, drafts)
    const missingNote = payload.disputedLines.some((entry) => !entry.note.length)
    if (missingNote) {
      setError(t('freight_operations.abstracts.respond.noteRequired', 'Every disputed line needs the customer\'s reason.'))
      return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(target.updatedAt ?? target.updated_at ?? null),
          () => apiCallOrThrow('/api/freight_operations/abstracts/respond', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: target.id, ...payload }),
          }, { errorMessage: t('freight_operations.abstracts.respond.error', 'Unable to record the response.') }),
        ),
        mutationPayload: { operation: 'abstracts.respond', id: target.id, updatedAt: target.updatedAt ?? null },
        context: { formId: CONTEXT_ID, resourceKind: 'freight_operations:freight_trip_abstract', resourceId: target.id, retryLastMutation },
      })
      flash(t('freight_operations.abstracts.respond.success', 'Customer response recorded.'), 'success')
      onResponded()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.abstracts.respond.error', 'Unable to record the response.'))
    }
  }, [drafts, lines, onResponded, retryLastMutation, runMutation, t, target])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.abstracts.respond.title', 'Record the customer response')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.abstracts.respond.description', 'Tick the lines the customer disputed. Everything unticked is recorded as accepted.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {lines.map((line) => {
            const draft = drafts[line.id] ?? { disputed: false, note: '' }
            return (
              <div key={line.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={draft.disputed}
                    onCheckedChange={(checked) => update(line.id, { disputed: checked === true })}
                    aria-label={t('freight_operations.abstracts.respond.disputeLine', 'Dispute this line')}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">
                      {line.description ?? line.route_code_snapshot ?? `#${line.line_number}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {`${line.origin} → ${line.destination} · ${formatFreightAmount(line.total_gross_amount, currencyCode)}`}
                    </span>
                  </span>
                </label>
                {draft.disputed ? (
                  <Input
                    value={draft.note}
                    onChange={(event) => update(line.id, { note: event.target.value })}
                    placeholder={t('freight_operations.abstracts.respond.notePlaceholder', "The customer's reason")}
                    aria-label={t('freight_operations.abstracts.respond.note', 'Dispute note')}
                  />
                ) : null}
              </div>
            )
          })}
        </div>

        {error ? <p className="text-sm text-status-error-text">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.abstracts.respond.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }}>
            {t('freight_operations.abstracts.respond.submit', 'Record response')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
