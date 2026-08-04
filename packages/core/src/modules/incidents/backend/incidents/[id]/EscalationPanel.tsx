"use client"

import * as React from 'react'
import { CheckCircle2, Clock3, Eye, Siren, Users } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveCatalogLabel } from '../../../lib/catalogLabels'
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
import {
  EscalationPathPreview,
  type EscalationPreviewStep,
  type EscalationPreviewTarget,
} from '../components/EscalationPathPreview'
import { useUserLabels } from '../components/useUserLabels'

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

type EscalationPolicyApiRecord = {
  id?: string | null
  name?: string | null
  key?: string | null
  steps?: unknown
  repeatCount?: number | string | null
  repeat_count?: number | string | null
}

type EscalationPolicy = {
  id: string
  name: string
  steps: EscalationPreviewStep[]
  repeatCount: number
}

type EscalationPoliciesResponse = {
  items?: EscalationPolicyApiRecord[]
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
  escalationPolicyId?: string | null
  escalationStatus: string | null
  escalationLevel: number | null
  escalationRepeatsDone?: number | null
  nextEscalationAt: string | null
  escalationLastTargets: EscalationLastTargets | null
  canManage: boolean
  canEscalate: boolean
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

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numericValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function normalizePreviewTarget(raw: unknown): EscalationPreviewTarget | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const type = record.type
  const id = stringValue(record.id)
  if (!id) return null
  if (type !== 'user' && type !== 'team' && type !== 'role') return null
  return { type, id }
}

function normalizePolicyStep(raw: unknown): EscalationPreviewStep | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const rawTargets = Array.isArray(record.targets) ? record.targets : []
  return {
    delayMinutes: nonNegativeInteger(numericValue(record.delayMinutes ?? record.delay_minutes, 0)),
    targets: rawTargets
      .map(normalizePreviewTarget)
      .filter((target): target is EscalationPreviewTarget => target !== null),
  }
}

function normalizePolicy(record: EscalationPolicyApiRecord): EscalationPolicy | null {
  const id = stringValue(record.id)
  if (!id) return null
  const rawSteps = Array.isArray(record.steps) ? record.steps : []
  return {
    id,
    name: stringValue(record.name) ?? stringValue(record.key) ?? id,
    steps: rawSteps
      .map(normalizePolicyStep)
      .filter((step): step is EscalationPreviewStep => step !== null),
    repeatCount: nonNegativeInteger(numericValue(record.repeatCount ?? record.repeat_count, 0)),
  }
}

function targetDisplayLabel(target: EscalationTarget, userLabels: Record<string, string>): string {
  const label = target.label?.trim()
  if (label && label.length > 0) return label
  if (target.type === 'user') return userLabels[target.id] ?? target.id
  return target.type
}

function recipientDisplayLabel(recipient: EscalationRecipient, userLabels: Record<string, string>): string {
  const label = recipient.label?.trim()
  if (label && label.length > 0) return label
  return userLabels[recipient.userId] ?? recipient.userId
}

function summarizeTargets(
  targets: readonly EscalationTarget[] | null | undefined,
  recipients: readonly EscalationRecipient[] | null | undefined,
  userLabels: Record<string, string>,
): string {
  if (targets && targets.length > 0) {
    return targets.map((target) => targetDisplayLabel(target, userLabels)).join(', ')
  }
  return recipients && recipients.length > 0
    ? recipients.map((recipient) => recipientDisplayLabel(recipient, userLabels)).join(', ')
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
  escalationPolicyId,
  escalationStatus,
  escalationLevel,
  nextEscalationAt,
  escalationLastTargets,
  canManage,
  canEscalate,
  onChanged,
}: EscalationPanelProps) {
  const t = useT()
  const [preview, setPreview] = React.useState<EscalationPreviewResponse | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [policy, setPolicy] = React.useState<EscalationPolicy | null>(null)
  const [policyDialogOpen, setPolicyDialogOpen] = React.useState(false)
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
  const userIdsToResolve = React.useMemo(() => {
    const ids: string[] = []
    const collectTarget = (target: EscalationTarget) => {
      if (target.type === 'user' && !target.label?.trim()) ids.push(target.id)
    }
    const collectRecipient = (recipient: EscalationRecipient) => {
      if (!recipient.label?.trim()) ids.push(recipient.userId)
    }
    escalationLastTargets?.targets?.forEach(collectTarget)
    escalationLastTargets?.recipients?.forEach(collectRecipient)
    preview?.targets.forEach(collectTarget)
    policy?.steps.forEach((step) => step.targets.forEach((target) => {
      if (target.type === 'user') ids.push(target.id)
    }))
    preview?.recipients.forEach(collectRecipient)
    return ids
  }, [
    escalationLastTargets?.recipients,
    escalationLastTargets?.targets,
    policy?.steps,
    preview?.recipients,
    preview?.targets,
  ])
  const userLabels = useUserLabels(userIdsToResolve)

  const [policyTargetLabels, setPolicyTargetLabels] = React.useState<{ roles: Record<string, string>; teams: Record<string, string> }>({ roles: {}, teams: {} })

  const roleLabels = React.useMemo(() => {
    const labels: Record<string, string> = {}
    const collect = (target: EscalationTarget) => {
      const label = target.label?.trim()
      if (target.type === 'role' && label) labels[target.id] = label
    }
    escalationLastTargets?.targets?.forEach(collect)
    preview?.targets.forEach(collect)
    return { ...policyTargetLabels.roles, ...labels }
  }, [escalationLastTargets?.targets, preview?.targets, policyTargetLabels.roles])

  const teamLabels = React.useMemo(() => {
    const labels: Record<string, string> = {}
    const collect = (target: EscalationTarget) => {
      const label = target.label?.trim()
      if (target.type === 'team' && label) labels[target.id] = label
    }
    escalationLastTargets?.targets?.forEach(collect)
    preview?.targets.forEach(collect)
    return { ...policyTargetLabels.teams, ...labels }
  }, [escalationLastTargets?.targets, preview?.targets, policyTargetLabels.teams])

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

  React.useEffect(() => {
    const policyId = escalationPolicyId?.trim()
    setPolicy(null)
    if (!policyId) return
    let active = true
    apiCall<EscalationPoliciesResponse>(
      `/api/incidents/escalation-policies?id=${encodeURIComponent(policyId)}&page=1&pageSize=1`,
      undefined,
      { fallback: { items: [] } },
    )
      .then((result) => {
        if (!active) return
        const nextPolicy = result.ok && result.result?.items?.[0]
          ? normalizePolicy(result.result.items[0])
          : null
        setPolicy(nextPolicy)
      })
      .catch(() => {
        if (active) setPolicy(null)
      })
    return () => {
      active = false
    }
  }, [escalationPolicyId])


  React.useEffect(() => {
    const steps = policy?.steps ?? []
    const roleIds = new Set<string>()
    const teamIds = new Set<string>()
    steps.forEach((step) => {
      step.targets.forEach((target) => {
        if (target.type === 'role') roleIds.add(target.id)
        if (target.type === 'team') teamIds.add(target.id)
      })
    })
    if (!roleIds.size && !teamIds.size) {
      setPolicyTargetLabels({ roles: {}, teams: {} })
      return
    }
    let active = true
    const loadLabels = async () => {
      const roles: Record<string, string> = {}
      const teams: Record<string, string> = {}
      if (roleIds.size) {
        const result = await apiCall<{ items?: Array<{ id?: string; key?: string; label?: string }> }>(
          '/api/incidents/roles?isActive=true&pageSize=100',
          undefined,
          { fallback: { items: [] } },
        )
        if (result.ok) {
          for (const role of result.result?.items ?? []) {
            if (role.id && roleIds.has(role.id)) {
              roles[role.id] = resolveCatalogLabel(t, 'role', role.key ?? null, role.label ?? role.id)
            }
          }
        }
      }
      if (teamIds.size) {
        const result = await apiCall<{ items?: Array<{ id?: string; name?: string }> }>(
          `/api/staff/teams?ids=${encodeURIComponent([...teamIds].join(','))}`,
          undefined,
          { fallback: { items: [] } },
        )
        if (result.ok) {
          for (const team of result.result?.items ?? []) {
            if (team.id && team.name) teams[team.id] = team.name
          }
        }
      }
      if (active) setPolicyTargetLabels({ roles, teams })
    }
    loadLabels().catch(() => {
      if (active) setPolicyTargetLabels({ roles: {}, teams: {} })
    })
    return () => {
      active = false
    }
  }, [policy?.steps, t])

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
    escalationLastTargets?.targets,
    escalationLastTargets?.recipients,
    userLabels,
  ), [escalationLastTargets?.recipients, escalationLastTargets?.targets, userLabels])

  const nextSummary = React.useMemo(() => preview
    ? summarizeTargets(preview.targets, preview.recipients, userLabels)
    : '', [preview, userLabels])
  const previewRecipientLabels = React.useMemo(() => (
    preview?.recipients.map((recipient) => recipientDisplayLabel(recipient, userLabels)) ?? []
  ), [preview?.recipients, userLabels])

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

  const handlePolicyDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') setPolicyDialogOpen(false)
  }, [])

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

      {policy || (canEscalate && status !== 'exhausted') ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {policy ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPolicyDialogOpen(true)}
              className="whitespace-nowrap"
            >
              <Eye aria-hidden="true" />
              {t('incidents.ai.policy.view', 'View policy')}
            </Button>
          ) : null}
          {canEscalate && status !== 'exhausted' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openPreviewDialog()}
            disabled={previewPending || confirmPending}
            className="whitespace-nowrap"
          >
            <Siren aria-hidden="true" />
            {t('incidents.incident.detail.escalation.escalateNow')}
          </Button>
          ) : null}
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
                      {targetDisplayLabel(target, userLabels)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.recipients.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  ({previewRecipientLabels.join(', ')})
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
              className="whitespace-nowrap"
            >
              {t('incidents.common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirmPending || !preview}
              className="whitespace-nowrap"
            >
              {t('incidents.incident.detail.escalation.preview.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
        <DialogContent className="sm:max-w-lg" onKeyDown={handlePolicyDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{policy?.name ?? t('incidents.ai.policy.title', 'Escalation policy')}</DialogTitle>
            <DialogDescription>
              {t('incidents.ai.policy.description', 'Active escalation policy for this incident.')}
            </DialogDescription>
          </DialogHeader>

          {policy && policy.steps.length > 0 ? (
            <EscalationPathPreview
              steps={policy.steps}
              repeatCount={policy.repeatCount}
              userLabels={userLabels}
              roleLabels={roleLabels}
              teamLabels={teamLabels}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('incidents.ai.policy.empty', 'No escalation steps are configured.')}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPolicyDialogOpen(false)}
              className="whitespace-nowrap"
            >
              {t('incidents.ai.policy.close', 'Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
