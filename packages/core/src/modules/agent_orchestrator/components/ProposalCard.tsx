"use client"

import * as React from 'react'
import { TriangleAlert, Info } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatConfidence, type ProposalView } from './types'
import { dispositionLabelKey, dispositionVariant, proposalVerdict } from './cockpitStatus'

export type DisposeKind = 'approved' | 'edited' | 'rejected'

export type ProposalActionsConfig = {
  /** Whether the operator can dispose (RBAC `proposals.dispose`). */
  canDispose: boolean
  /** Whether a write is currently in flight (buttons disabled). */
  busy?: boolean
  onApprove: () => void
  onEdit: (payload: unknown, reason: string) => void
  onReject: (reason: string) => void
}

export type ProposalCardProps = {
  /** Persisted proposal (caseload detail). */
  proposal?: ProposalView | null
  /**
   * Ad-hoc proposal payload (playground actionable result). When provided
   * without `proposal`, the card renders read-only with disabled actions.
   */
  adHoc?: {
    agentId: string
    confidence: number | null
    payload: unknown
    rationale?: string | null
  }
  /** Disposition action wiring. Omit for a fully read-only card (playground). */
  actions?: ProposalActionsConfig
  /** Opens the Agent I/O drawer. */
  onInspect?: () => void
  /** Human-readable agent name; falls back to the agent id when omitted. */
  agentLabel?: string
}

function stringifyPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

type PayloadField = { key: string; kind: 'string' | 'number' | 'boolean'; value: string | number | boolean }

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

// A flat object of primitives renders as friendly form fields; anything nested
// (objects/arrays) falls back to the raw JSON editor so we never lose data.
function toPayloadFields(payload: unknown): PayloadField[] | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const entries = Object.entries(payload as Record<string, unknown>)
  if (entries.length === 0 || !entries.every(([, value]) => isPrimitive(value))) return null
  return entries.map(([key, value]) => ({
    key,
    kind: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
    value: value === null ? '' : (value as string | number | boolean),
  }))
}

function fieldsToPayload(fields: PayloadField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => {
      if (field.kind === 'number') return [field.key, Number(field.value)]
      if (field.kind === 'boolean') return [field.key, field.value === true || field.value === 'true']
      return [field.key, field.value]
    }),
  )
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function ProposalCard({ proposal, adHoc, actions, onInspect, agentLabel }: ProposalCardProps) {
  const t = useT()
  const [mode, setMode] = React.useState<'view' | 'edit' | 'reject'>('view')
  const [payloadText, setPayloadText] = React.useState('')
  const [payloadFields, setPayloadFields] = React.useState<PayloadField[]>([])
  const [isComplexPayload, setIsComplexPayload] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [localError, setLocalError] = React.useState<string | null>(null)

  const agentId = proposal?.agentId ?? adHoc?.agentId ?? ''
  const confidence = proposal?.confidence ?? adHoc?.confidence ?? null
  const payload = proposal?.payload ?? adHoc?.payload ?? null
  const rationale = adHoc?.rationale ?? null
  const confidenceLabel = formatConfidence(confidence)
  const verdict = proposalVerdict(confidence)
  const busy = actions?.busy ?? false
  const canDispose = actions?.canDispose ?? false
  const isPending = (proposal?.disposition ?? 'pending') === 'pending'

  const startEdit = React.useCallback(() => {
    const fields = toPayloadFields(payload)
    if (fields) {
      setPayloadFields(fields)
      setIsComplexPayload(false)
    } else {
      setPayloadText(stringifyPayload(payload))
      setIsComplexPayload(true)
    }
    setReason('')
    setLocalError(null)
    setMode('edit')
  }, [payload])

  const updateField = React.useCallback((index: number, value: string | boolean) => {
    setPayloadFields((fields) => fields.map((field, i) => (i === index ? { ...field, value } : field)))
  }, [])

  const startReject = React.useCallback(() => {
    setReason('')
    setLocalError(null)
    setMode('reject')
  }, [])

  const cancel = React.useCallback(() => {
    setMode('view')
    setLocalError(null)
  }, [])

  const submitEdit = React.useCallback(() => {
    if (!actions) return
    if (!reason.trim()) {
      setLocalError(t('agent_orchestrator.proposal.reject.reasonRequired'))
      return
    }
    let parsed: unknown
    if (isComplexPayload) {
      try {
        parsed = JSON.parse(payloadText)
      } catch {
        setLocalError(t('agent_orchestrator.proposal.edit.invalidJson'))
        return
      }
    } else {
      parsed = fieldsToPayload(payloadFields)
    }
    actions.onEdit(parsed, reason.trim())
  }, [actions, isComplexPayload, payloadText, payloadFields, reason, t])

  const submitReject = React.useCallback(() => {
    if (!actions) return
    if (!reason.trim()) {
      setLocalError(t('agent_orchestrator.proposal.reject.reasonRequired'))
      return
    }
    actions.onReject(reason.trim())
  }, [actions, reason, t])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (mode === 'edit') submitEdit()
        else if (mode === 'reject') submitReject()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    },
    [mode, submitEdit, submitReject, cancel],
  )

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Proposal header — clean card; the violet avatar ring signals the AI source. */}
      <div className="flex items-center gap-3 rounded-t-lg border-b border-border bg-card p-4">
        <Avatar label={agentLabel || agentId || 'AI'} size="md" ring />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {t('agent_orchestrator.proposal.proposes', undefined, { agent: agentLabel || agentId })}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">{agentId}</p>
        </div>
        {confidenceLabel ? (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              {t('agent_orchestrator.proposal.confidence')}
            </p>
            <p className="font-mono text-sm font-semibold text-brand-violet">{confidenceLabel}</p>
          </div>
        ) : null}
        {proposal ? (
          <StatusBadge variant={dispositionVariant(proposal.disposition)} dot>
            {t(dispositionLabelKey(proposal.disposition))}
          </StatusBadge>
        ) : null}
      </div>

      <div className="space-y-5 p-4">
        {/* Verdict block — confidence-driven, not a static "approve" banner. */}
        <NoticeBanner icon={TriangleAlert} tone="warning">{t(verdict.labelKey)}</NoticeBanner>

        {rationale ? <p className="text-sm text-muted-foreground">{rationale}</p> : null}

        {/* Proposed actions / payload */}
        <section className="space-y-2">
          <SectionHeader title={t('agent_orchestrator.proposal.actionsHeading')} />
          <JsonDisplay data={payload} />
        </section>

        {/* Inspect run */}
        {onInspect ? (
          <Button type="button" variant="outline" size="sm" onClick={onInspect}>
            {t('agent_orchestrator.proposal.ioHeading')}
          </Button>
        ) : null}

        {/* Gate — the "approve/edit/reject" warning only renders where those
            buttons exist (Caseload, pending). In read-only mode (the Playground
            preview) the proposal is saved but not disposable here, so point to
            Caseload instead of promising buttons. Already-disposed proposals show
            no gate. */}
        {actions && isPending ? (
          <NoticeBanner icon={Info}>{t('agent_orchestrator.proposal.gate')}</NoticeBanner>
        ) : !actions ? (
          <NoticeBanner icon={Info}>{t('agent_orchestrator.proposal.gateReadonly')}</NoticeBanner>
        ) : null}

        {/* Disposition reason on already-disposed proposals */}
        {proposal && !isPending && proposal.dispositionReason ? (
          <p className="text-sm text-muted-foreground">{proposal.dispositionReason}</p>
        ) : null}

        {/* Inline edit / reject editors */}
        {mode === 'edit' ? (
          <section className="space-y-3" onKeyDown={handleKeyDown}>
            <SectionHeader title={t('agent_orchestrator.proposal.edit.heading')} />
            {isComplexPayload ? (
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="ao-edit-payload">
                  {t('agent_orchestrator.proposal.edit.payloadLabel')}
                </label>
                <Textarea
                  id="ao-edit-payload"
                  value={payloadText}
                  onChange={(event) => setPayloadText(event.target.value)}
                  rows={8}
                  className="font-mono"
                />
              </div>
            ) : (
              <div className="space-y-3">
                {payloadFields.map((field, index) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-sm font-medium" htmlFor={`ao-edit-field-${index}`}>
                      {humanizeKey(field.key)}
                    </label>
                    {field.kind === 'boolean' ? (
                      <div>
                        <Switch
                          id={`ao-edit-field-${index}`}
                          checked={field.value === true}
                          onCheckedChange={(checked) => updateField(index, checked)}
                        />
                      </div>
                    ) : (
                      <Input
                        id={`ao-edit-field-${index}`}
                        type={field.kind === 'number' ? 'number' : 'text'}
                        value={String(field.value)}
                        onChange={(event) => updateField(index, event.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="ao-edit-reason">
                {t('agent_orchestrator.proposal.edit.reasonLabel')}
              </label>
              <Textarea
                id="ao-edit-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('agent_orchestrator.proposal.edit.reasonPlaceholder')}
                rows={2}
              />
            </div>
            {localError ? (
              <Alert status="error" style="light">
                {localError}
              </Alert>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="button" onClick={submitEdit} disabled={busy}>
                {t('agent_orchestrator.proposal.actions.saveEdit')}
              </Button>
              <Button type="button" variant="outline" onClick={cancel} disabled={busy}>
                {t('agent_orchestrator.proposal.actions.cancelEdit')}
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                <KbdShortcut keys={['⌘', 'Enter']} />
              </span>
            </div>
          </section>
        ) : null}

        {mode === 'reject' ? (
          <section className="space-y-3" onKeyDown={handleKeyDown}>
            <SectionHeader title={t('agent_orchestrator.proposal.reject.heading')} />
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="ao-reject-reason">
                {t('agent_orchestrator.proposal.reject.reasonLabel')}
              </label>
              <Textarea
                id="ao-reject-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('agent_orchestrator.proposal.reject.reasonPlaceholder')}
                rows={3}
              />
            </div>
            {localError ? (
              <Alert status="error" style="light">
                {localError}
              </Alert>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="button" variant="destructive" onClick={submitReject} disabled={busy}>
                {t('agent_orchestrator.proposal.reject.confirm')}
              </Button>
              <Button type="button" variant="outline" onClick={cancel} disabled={busy}>
                {t('agent_orchestrator.proposal.actions.cancelEdit')}
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                <KbdShortcut keys={['⌘', 'Enter']} />
              </span>
            </div>
          </section>
        ) : null}

        {/* Primary actions footer (only for pending + dispose-capable) */}
        {mode === 'view' && actions && isPending ? (
          <div className="flex items-center gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="destructive"
              onClick={startReject}
              disabled={!canDispose || busy}
            >
              {t('agent_orchestrator.proposal.actions.reject')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={startEdit}
              disabled={!canDispose || busy}
            >
              {t('agent_orchestrator.proposal.actions.edit')}
            </Button>
            <Button
              type="button"
              className="ml-auto"
              onClick={() => actions.onApprove()}
              disabled={!canDispose || busy}
            >
              {t('agent_orchestrator.proposal.actions.approve')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function NoticeBanner({ icon: Icon, tone, children }: { icon: React.ComponentType<{ className?: string }>; tone?: 'warning'; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm text-foreground">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone === 'warning' ? 'text-status-warning-text' : 'text-muted-foreground'}`} />
      <span>{children}</span>
    </div>
  )
}

export default ProposalCard
