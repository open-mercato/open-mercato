"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
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
import { ABSTRACT_LINE_RESOLUTION_FALLBACKS, ABSTRACT_LINE_RESOLUTION_VALUES } from '../lib/freightEnums'
import { formatFreightAmount } from './freightOptions'
import type { AbstractLineRow } from './AbstractLinesSection'
import type { AbstractActionTarget } from './AbstractActionDialog'

const CONTEXT_ID = 'freight_operations.abstracts.resolve'

export type ResolutionDraft = {
  resolution: string
  resolutionNote: string
  adjustedAmountNet: string
}

export function buildResolutionPayload(
  lines: AbstractLineRow[],
  drafts: Record<string, ResolutionDraft>,
): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const draft = drafts[line.id]
    return {
      lineId: line.id,
      resolution: draft?.resolution ?? 'rejected_dispute',
      resolutionNote: (draft?.resolutionNote ?? '').trim(),
      ...(draft?.resolution === 'adjusted' ? { adjustedAmountNet: draft.adjustedAmountNet.trim() } : {}),
    }
  })
}

/**
 * Settles every disputed line at once — the command only releases the abstract
 * to `approved` when no line is still disputed, so the dialog must decide all of
 * them. `adjusted` needs the agreed amount; the rest only need the reasoning.
 */
export function AbstractResolveDialog({
  target,
  disputedLines,
  currencyCode,
  open,
  onOpenChange,
  onResolved,
}: {
  target: AbstractActionTarget | null
  disputedLines: AbstractLineRow[]
  currencyCode: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onResolved: () => void
}) {
  const t = useT()
  const [drafts, setDrafts] = React.useState<Record<string, ResolutionDraft>>({})
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    if (!open) return
    const next: Record<string, ResolutionDraft> = {}
    for (const line of disputedLines) {
      next[line.id] = {
        resolution: 'rejected_dispute',
        resolutionNote: '',
        adjustedAmountNet: line.total_net_amount ?? '',
      }
    }
    setDrafts(next)
    setError(null)
  }, [disputedLines, open])

  const update = React.useCallback((lineId: string, patch: Partial<ResolutionDraft>) => {
    setDrafts((prev) => {
      const base: ResolutionDraft = { resolution: 'rejected_dispute', resolutionNote: '', adjustedAmountNet: '' }
      return { ...prev, [lineId]: { ...base, ...prev[lineId], ...patch } }
    })
  }, [])

  const submit = React.useCallback(async () => {
    if (!target) return
    const payload = buildResolutionPayload(disputedLines, drafts)
    const missingNote = payload.some((entry) => !String(entry.resolutionNote ?? '').length)
    if (missingNote) {
      setError(t('freight_operations.abstracts.resolve.noteRequired', 'Every resolution needs a note.'))
      return
    }
    const missingAmount = payload.some((entry) => entry.resolution === 'adjusted' && !String(entry.adjustedAmountNet ?? '').trim())
    if (missingAmount) {
      setError(t('freight_operations.abstracts.resolve.amountRequired', 'An adjusted line needs the agreed amount.'))
      return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(target.updatedAt ?? target.updated_at ?? null),
          () => apiCallOrThrow('/api/freight_operations/abstracts/resolve', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: target.id, resolutions: payload }),
          }, { errorMessage: t('freight_operations.abstracts.resolve.error', 'Unable to resolve the disputes.') }),
        ),
        mutationPayload: { operation: 'abstracts.resolve', id: target.id, updatedAt: target.updatedAt ?? null },
        context: { formId: CONTEXT_ID, resourceKind: 'freight_operations:freight_trip_abstract', resourceId: target.id, retryLastMutation },
      })
      flash(t('freight_operations.abstracts.resolve.success', 'Disputes resolved.'), 'success')
      onResolved()
    } catch (caught) {
      setError(caught instanceof Error && caught.message
        ? caught.message
        : t('freight_operations.abstracts.resolve.error', 'Unable to resolve the disputes.'))
    }
  }, [disputedLines, drafts, onResolved, retryLastMutation, runMutation, t, target])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => { void submit() },
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.abstracts.resolve.title', 'Resolve the disputes')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.abstracts.resolve.description', 'Removing or accepting a disputed line releases its trip back for a later abstract. The abstract is approved once no line is left disputed.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {disputedLines.map((line) => {
            const draft = drafts[line.id] ?? { resolution: 'rejected_dispute', resolutionNote: '', adjustedAmountNet: '' }
            return (
              <div key={line.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {line.description ?? line.route_code_snapshot ?? `#${line.line_number}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {`${line.origin} → ${line.destination} · ${formatFreightAmount(line.total_gross_amount, currencyCode)}`}
                    {line.dispute_note ? ` · ${line.dispute_note}` : ''}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Select value={draft.resolution} onValueChange={(value) => update(line.id, { resolution: value })}>
                    <SelectTrigger aria-label={t('freight_operations.abstracts.resolve.resolution', 'Resolution')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ABSTRACT_LINE_RESOLUTION_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`freight_operations.abstracts.line_resolution.${value}`, ABSTRACT_LINE_RESOLUTION_FALLBACKS[value] ?? value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {draft.resolution === 'adjusted' ? (
                    <Input
                      type="number"
                      value={draft.adjustedAmountNet}
                      onChange={(event) => update(line.id, { adjustedAmountNet: event.target.value })}
                      placeholder={t('freight_operations.abstracts.resolve.adjustedAmount', 'Agreed net amount')}
                      aria-label={t('freight_operations.abstracts.resolve.adjustedAmount', 'Agreed net amount')}
                    />
                  ) : null}
                  <Input
                    value={draft.resolutionNote}
                    onChange={(event) => update(line.id, { resolutionNote: event.target.value })}
                    placeholder={t('freight_operations.abstracts.resolve.note', 'Why this resolution')}
                    aria-label={t('freight_operations.abstracts.resolve.note', 'Why this resolution')}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {error ? <p className="text-sm text-status-error-text">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('freight_operations.abstracts.resolve.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => { void submit() }}>
            {t('freight_operations.abstracts.resolve.submit', 'Resolve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
