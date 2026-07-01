"use client"

import * as React from 'react'
import { CheckCircle2, Clock3, Siren, Users } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'

type EscalationTarget = {
  type: string
  id: string
  label?: string
}

type EscalationRecipient = {
  userId: string
  label?: string
}

type EscalationLastTargets = {
  targets?: EscalationTarget[]
  recipients?: EscalationRecipient[]
  resolvedAt?: string
}

type EscalationPreviewResponse = {
  nextLevel: number
  stepCount: number
  willExhaust: boolean
  targets: EscalationTarget[]
  recipients: EscalationRecipient[]
}

type EscalationMutationResponse = {
  ok?: boolean
  incidentId?: string | null
  updatedAt?: string | null
  escalationLevel?: number | null
  escalationStepCount?: number | null
  escalationStatus?: string | null
  nextEscalationAt?: string | null
  pagedTargets?: EscalationTarget[]
  recipients?: EscalationRecipient[]
}

type EscalationMutationContext = Record<string, unknown> & {
  formId: string
  resourceKind: 'incidents.incident'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type EscalationStatus = 'inactive' | 'active' | 'acknowledged' | 'exhausted'

type EscalationPanelProps = {
  incidentId: string
  updatedAt?: string | null
  escalationStatus: string | null
  escalationLevel: number | null
  escalationRepeatsDone?: number | null
  nextEscalationAt: string | null
  escalationLastTargets: EscalationLastTargets | null
  canManage: boolean
  onChanged: () => void | Promise<void>
}

const escalationStatusVariant: Record<EscalationStatus, StatusBadgeVariant> = {
  active: 'warning',
  exhausted: 'error',
  acknowledged: 'success',
  inactive: 'neutral',
}

function normalizeEscalationStatus(status: string | null): EscalationStatus {
  if (status === 'active' || status === 'acknowledged' || status === 'exhausted') return status
  return 'inactive'
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function targetDisplayLabel(target: EscalationTarget): string {
  const label = target.label?.trim()
  return label && label.length > 0 ? label : target.type
}

function summarizeTargets(
  t: ReturnType<typeof useT>,
  targets: readonly EscalationTarget[] | null | undefined,
  recipients: readonly EscalationRecipient[] | null | undefined,
): string {
  if (targets && targets.length > 0) {
    return targets.map(targetDisplayLabel).join(', ')
  }
  const recipientCount = recipients?.length ?? 0
  return recipientCount > 0
    ? t('incidents.incident.detail.escalation.recipients', { count: recipientCount })
    : ''
}

function formatFutureRelative(value: string, t: ReturnType<typeof useT>): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('incidents.common.notSet')
  const diffMs = date.getTime() - Date.now()
  if (diffMs <= 0) return t('incidents.incident.detail.escalation.relative.now')
  const minutes = Math.ceil(diffMs / 60_000)
  if (minutes < 60) {
    return t('incidents.incident.detail.escalation.relative.minutes', { count: minutes })
  }
  return t('incidents.incident.detail.escalation.relative.hours', { count: Math.ceil(minutes / 60) })
}

function isEscalationExhaustedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const record = err as Record<string, unknown>
  if (record.status !== 409) return false
  const body = record.body && typeof record.body === 'object'
    ? record.body as Record<string, unknown>
    : null
  const candidates = [record.error, record.message, body?.error]
  return candidates.some((value) => typeof value === 'string' && value.includes('escalation_exhausted'))
}

export function EscalationPanel({
  incidentId,
  updatedAt,
  escalationStatus,
  escalationLevel,
  nextEscalationAt,
  escalationLastTargets,
  canManage,
  onChanged,
}: EscalationPanelProps) {
  const t = useT()
  const [preview, setPreview] = React.useState<EscalationPreviewResponse | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [previewPending, setPreviewPending] = React.useState(false)
  const [confirmPending, setConfirmPending] = React.useState(false)
  const status = normalizeEscalationStatus(escalationStatus)
  const contextId = React.useMemo(() => `incident-escalation:${incidentId}`, [incidentId])
  const { runMutation, retryLastMutation } = useGuardedMutation<EscalationMutationContext>({
    contextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo<EscalationMutationContext>(() => ({
    formId: contextId,
    resourceKind: 'incidents.incident',
    resourceId: incidentId,
    retryLastMutation,
  }), [contextId, incidentId, retryLastMutation])

  const fetchPreview = React.useCallback(async (): Promise<EscalationPreviewResponse | null> => {
    const result = await apiCall<EscalationPreviewResponse>(
      `/api/incidents/${encodeURIComponent(incidentId)}/escalate/preview`,
    )
    if (!result.ok || !result.result) return null
    return result.result
  }, [incidentId])

  React.useEffect(() => {
    setPreview(null)
  }, [incidentId, escalationStatus])

  React.useEffect(() => {
    if (status !== 'active') return
    let active = true
    fetchPreview()
      .then((nextPreview) => {
        if (active && nextPreview) setPreview(nextPreview)
      })
      .catch(() => {
        // Best-effort only: the card still has current incident state without the next-step preview.
      })
    return () => {
      active = false
    }
  }, [fetchPreview, status])

  const stateLabel = React.useMemo(() => {
    if (status === 'inactive') return t('incidents.incident.detail.escalation.state.inactive')
    if (status === 'acknowledged') return t('incidents.incident.detail.escalation.state.acknowledged')
    if (status === 'exhausted') return t('incidents.incident.detail.escalation.state.exhausted')
    const level = Math.max(0, escalationLevel ?? 0) + 1
    const stepCount = positiveNumber(preview?.stepCount)
    const levelLabel = stepCount
      ? t('incidents.incident.detail.escalation.levelOf', { level, count: stepCount })
      : t('incidents.incident.detail.escalation.level', { level })
    return `${t('incidents.incident.detail.escalation.state.active')} — ${levelLabel}`
  }, [escalationLevel, preview?.stepCount, status, t])

  const notifiedSummary = React.useMemo(() => summarizeTargets(
    t,
    escalationLastTargets?.targets,
    escalationLastTargets?.recipients,
  ), [escalationLastTargets?.recipients, escalationLastTargets?.targets, t])

  const nextSummary = React.useMemo(() => preview
    ? summarizeTargets(t, preview.targets, preview.recipients)
    : '', [preview, t])

  const nextLine = React.useMemo(() => {
    if (status !== 'active' || !nextEscalationAt) return null
    const base = t('incidents.incident.detail.escalation.next', {
      when: formatFutureRelative(nextEscalationAt, t),
    })
    return nextSummary ? `${base} → ${nextSummary}` : base
  }, [nextEscalationAt, nextSummary, status, t])

  const openPreviewDialog = React.useCallback(async () => {
    if (previewPending || status === 'exhausted') return
    setPreviewPending(true)
    try {
      const result = await apiCallOrThrow<EscalationPreviewResponse>(
        `/api/incidents/${encodeURIComponent(incidentId)}/escalate/preview`,
        undefined,
        { errorMessage: t('incidents.incident.detail.escalation.escalateError') },
      )
      if (!result.result) {
        flash(t('incidents.incident.detail.escalation.escalateError'), 'error')
        return
      }
      setPreview(result.result)
      setDialogOpen(true)
    } catch {
      flash(t('incidents.incident.detail.escalation.escalateError'), 'error')
    } finally {
      setPreviewPending(false)
    }
  }, [incidentId, previewPending, status, t])

  const handleConfirm = React.useCallback(async () => {
    if (!preview || confirmPending) return
    setConfirmPending(true)
    try {
      await runMutation({
        operation: async () => apiCallOrThrow<EscalationMutationResponse>(
          `/api/incidents/${encodeURIComponent(incidentId)}/escalate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...buildOptimisticLockHeader(updatedAt),
            },
            body: '{}',
          },
          { errorMessage: t('incidents.incident.detail.escalation.escalateError') },
        ),
        context: mutationContext,
        mutationPayload: { incidentId, action: 'escalate' },
      })
      flash(t('incidents.incident.detail.escalation.escalateSuccess'), 'success')
      await onChanged()
      setDialogOpen(false)
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: () => { void onChanged() } })) return
      if (isEscalationExhaustedError(err)) {
        flash(t('incidents.incident.detail.escalation.exhaustedToast'), 'error')
        setDialogOpen(false)
        void onChanged()
        return
      }
      flash(t('incidents.incident.detail.escalation.escalateError'), 'error')
    } finally {
      setConfirmPending(false)
    }
  }, [confirmPending, incidentId, mutationContext, onChanged, preview, runMutation, t, updatedAt])

  const handleDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleConfirm()
    }
    if (event.key === 'Escape' && !confirmPending) {
      setDialogOpen(false)
    }
  }, [confirmPending, handleConfirm])

  const stateIcon = status === 'acknowledged'
    ? <CheckCircle2 aria-hidden="true" className="size-4 text-muted-foreground" />
    : <Siren aria-hidden="true" className="size-4 text-muted-foreground" />

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <SectionHeader title={t('incidents.incident.detail.escalation.title')} />

      <div className="flex items-center gap-2">
        {stateIcon}
        <StatusBadge variant={escalationStatusVariant[status]} dot>
          {stateLabel}
        </StatusBadge>
      </div>

      {notifiedSummary ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users aria-hidden="true" className="size-4 shrink-0" />
          <span>
            {t('incidents.incident.detail.escalation.notified')}: {notifiedSummary}
          </span>
        </p>
      ) : null}

      {nextLine ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock3 aria-hidden="true" className="size-4 shrink-0" />
          <span>{nextLine}</span>
        </p>
      ) : null}

      {canManage && status !== 'exhausted' ? (
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openPreviewDialog()}
            disabled={previewPending || confirmPending}
          >
            <Siren aria-hidden="true" />
            {t('incidents.incident.detail.escalation.escalateNow')}
          </Button>
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!confirmPending) setDialogOpen(open)
      }}>
        <DialogContent className="sm:max-w-lg" onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('incidents.incident.detail.escalation.preview.title')}</DialogTitle>
            <DialogDescription>
              {preview?.willExhaust
                ? t('incidents.incident.detail.escalation.preview.willExhaust')
                : preview
                  ? t('incidents.incident.detail.escalation.preview.body', {
                      level: preview.nextLevel + 1,
                      count: preview.stepCount,
                    })
                  : t('incidents.incident.detail.escalation.escalateNow')}
            </DialogDescription>
          </DialogHeader>

          {preview && !preview.willExhaust ? (
            <div className="space-y-2">
              {preview.targets.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {preview.targets.map((target) => (
                    <li
                      key={`${target.type}:${target.id}`}
                      className="rounded-full border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {targetDisplayLabel(target)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.recipients.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  ({t('incidents.incident.detail.escalation.recipients', { count: preview.recipients.length })})
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={confirmPending}
            >
              {t('incidents.common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirmPending || !preview}
            >
              {t('incidents.incident.detail.escalation.preview.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
