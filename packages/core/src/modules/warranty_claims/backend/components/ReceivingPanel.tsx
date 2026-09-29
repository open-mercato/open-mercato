"use client"

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

type ConditionGrade = 'A' | 'B' | 'C' | 'D'

type ReceivingLine = {
  id: string
  lineNo: number | null
  productName: string | null
  sku: string | null
  serialNumber: string | null
  conditionGrade: string | null
  quarantineStatus: string | null
  inspectionNotes: string | null
  updatedAt: string | null
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

type ReceivingPanelProps = {
  claimId: string
  lines: ReceivingLine[]
  canManage: boolean
  receivingCapable: boolean
  onRefresh: () => Promise<void>
}

const CONDITION_GRADES: ConditionGrade[] = ['A', 'B', 'C', 'D']

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readErrorKey(value: unknown): string | null {
  if (!isRecord(value)) return null
  return typeof value.error === 'string' && value.error.trim().length ? value.error.trim() : null
}

function toApiError(status: number, result: unknown, fallbackKey: string, t: TranslateFn): Error & { status?: number } {
  const key = readErrorKey(result) ?? fallbackKey
  return Object.assign(new Error(t(key, key)), { status })
}

function formatLineTitle(line: ReceivingLine, t: TranslateFn): string {
  const identifier = line.lineNo !== null
    ? `#${line.lineNo}`
    : t('warranty_claims.form.lines.unnamed', 'Unnamed line')
  const product = line.productName ?? line.sku ?? line.serialNumber
  return product ? `${identifier} ${product}` : identifier
}

function gradeVariant(grade: string | null): 'success' | 'info' | 'warning' | 'error' | 'neutral' {
  if (grade === 'A') return 'success'
  if (grade === 'B') return 'info'
  if (grade === 'C') return 'warning'
  if (grade === 'D') return 'error'
  return 'neutral'
}

function quarantineVariant(status: string | null): 'success' | 'warning' | 'neutral' {
  if (status === 'held') return 'warning'
  if (status === 'released') return 'success'
  return 'neutral'
}

export function ReceivingPanel({
  claimId,
  lines,
  canManage,
  receivingCapable,
  onRefresh,
}: ReceivingPanelProps) {
  const t = useT()
  const [dialogLine, setDialogLine] = React.useState<ReceivingLine | null>(null)
  const [conditionGrade, setConditionGrade] = React.useState<ConditionGrade>('A')
  const [inspectionNotes, setInspectionNotes] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: `warranty-claim-receiving:${claimId}`,
    blockedMessage: t('warranty_claims.common.saveBlocked', 'Save blocked by a mutation guard.'),
  })

  React.useEffect(() => {
    if (!dialogLine) return
    const nextGrade = CONDITION_GRADES.includes(dialogLine.conditionGrade as ConditionGrade)
      ? dialogLine.conditionGrade as ConditionGrade
      : 'A'
    setConditionGrade(nextGrade)
    setInspectionNotes(dialogLine.inspectionNotes ?? '')
    setError(null)
  }, [dialogLine])

  if (!receivingCapable || lines.length === 0) return null

  const runReceivingAction = async (line: ReceivingLine, body: Record<string, unknown>, successKey: string) => {
    setSaving(true)
    setError(null)
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(line.updatedAt),
            () => apiCall('/api/warranty_claims/receiving', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...body, updatedAt: line.updatedAt }),
            }),
          )
          if (!call.ok) throw toApiError(call.status, call.result, 'warranty_claims.receiving.error.save', t)
          return call
        },
        context: {
          formId: `warranty-claim-receiving:${claimId}:${line.id}`,
          resourceKind: 'warranty_claims.claim_line',
          resourceId: line.id,
          retryLastMutation,
        },
        mutationPayload: body,
      })
      flash(t(successKey, 'Receiving action saved.'), 'success')
      setDialogLine(null)
      await onRefresh()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh })) return
      const message = err instanceof Error && err.message
        ? err.message
        : t('warranty_claims.receiving.error.save', 'Failed to save receiving details.')
      setError(message)
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const submitGrade = async () => {
    if (!dialogLine) return
    await runReceivingAction(
      dialogLine,
      {
        lineId: dialogLine.id,
        conditionGrade,
        inspectionNotes: inspectionNotes.trim() || undefined,
      },
      'warranty_claims.receiving.flash.saved',
    )
  }

  const releaseLine = async (line: ReceivingLine) => {
    await runReceivingAction(
      line,
      { lineId: line.id, action: 'release' },
      'warranty_claims.receiving.flash.released',
    )
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('warranty_claims.receiving.title', 'Receiving and grading')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('warranty_claims.receiving.description', 'Capture received condition grades and quarantine status per line.')}
          </p>
        </div>
        {!canManage ? (
          <StatusBadge variant="neutral">
            {t('warranty_claims.receiving.readOnly', 'Read only')}
          </StatusBadge>
        ) : null}
      </div>
      {error ? (
        <div className="mt-3">
          <ErrorMessage label={error} />
        </div>
      ) : null}
      <div className="mt-3 space-y-3">
        {lines.map((line) => (
          <div key={line.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0 space-y-2">
              <div className="text-sm font-medium">{formatLineTitle(line, t)}</div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge variant={gradeVariant(line.conditionGrade)}>
                  {line.conditionGrade
                    ? t(`warranty_claims.receiving.grade.${line.conditionGrade}`, `Grade ${line.conditionGrade}`)
                    : t('warranty_claims.receiving.grade.none', 'No grade')}
                </StatusBadge>
                <StatusBadge variant={quarantineVariant(line.quarantineStatus)}>
                  {t(
                    `warranty_claims.receiving.quarantine.${line.quarantineStatus ?? 'none'}`,
                    line.quarantineStatus ?? 'none',
                  )}
                </StatusBadge>
              </div>
              {line.inspectionNotes ? (
                <p className="text-xs text-muted-foreground">{line.inspectionNotes}</p>
              ) : null}
            </div>
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setDialogLine(line)}>
                  {t('warranty_claims.receiving.actions.grade', 'Grade / Receive')}
                </Button>
                {line.quarantineStatus === 'held' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => { void releaseLine(line) }}
                  >
                    {t('warranty_claims.receiving.actions.release', 'Release')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <Dialog open={dialogLine !== null} onOpenChange={(open) => { if (!open) setDialogLine(null) }}>
        <DialogContent
          className="max-w-lg"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submitGrade()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDialogLine(null)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('warranty_claims.receiving.dialog.title', 'Grade received line')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="warranty-claim-condition-grade">
                {t('warranty_claims.receiving.fields.conditionGrade', 'Condition grade')}
              </Label>
              <Select value={conditionGrade} onValueChange={(value) => setConditionGrade(value as ConditionGrade)}>
                <SelectTrigger id="warranty-claim-condition-grade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_GRADES.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                      {t(`warranty_claims.receiving.grade.${grade}`, `Grade ${grade}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="warranty-claim-inspection-notes">
                {t('warranty_claims.receiving.fields.inspectionNotes', 'Inspection notes')}
              </Label>
              <Textarea
                id="warranty-claim-inspection-notes"
                value={inspectionNotes}
                onChange={(event) => setInspectionNotes(event.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogLine(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" disabled={saving} onClick={() => { void submitGrade() }}>
              {saving ? t('warranty_claims.common.saving', 'Saving...') : t('warranty_claims.form.submit', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
