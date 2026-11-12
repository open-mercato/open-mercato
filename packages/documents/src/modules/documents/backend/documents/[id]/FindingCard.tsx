"use client"

import * as React from 'react'
import { Check, ChevronDown, Info, LocateFixed, MessageSquarePlus, OctagonAlert, RotateCcw, TriangleAlert, Undo2 } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { canApplyFinding, type DocumentFindingItem, type FindingResolution, type FindingSeverity } from './findingModel'

const SEVERITY_VARIANT: Record<FindingSeverity, StatusBadgeVariant> = {
  blocking: 'error',
  warning: 'warning',
  info: 'info',
}

const SEVERITY_ICON: Record<FindingSeverity, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  blocking: OctagonAlert,
  warning: TriangleAlert,
  info: Info,
}

const SEVERITY_ICON_CLASS: Record<FindingSeverity, string> = {
  blocking: 'text-status-error-icon',
  warning: 'text-status-warning-icon',
  info: 'text-status-info-icon',
}

export function findingCardElementId(findingId: string): string {
  return `document-finding-${findingId}`
}

function findingCardBodyId(findingId: string): string {
  return `document-finding-${findingId}-body`
}

export type FindingCardProps = {
  finding: DocumentFindingItem
  resolution: FindingResolution | undefined
  active: boolean
  expanded: boolean
  canDecide: boolean
  editorEditable: boolean
  pending: boolean
  revertable: boolean
  onLocate: (finding: DocumentFindingItem) => void
  onToggle: (finding: DocumentFindingItem) => void
  onApply: (finding: DocumentFindingItem) => void
  onKeep: (finding: DocumentFindingItem) => void
  onReopen: (finding: DocumentFindingItem) => void
  onRevert: () => void
  onNote?: (finding: DocumentFindingItem) => void
}

function locationMessageKey(finding: DocumentFindingItem, resolution: FindingResolution | undefined): string | null {
  if (finding.status !== 'open') return null
  if (finding.anchorStatus === 'unlocated' || resolution?.kind === 'unlocated') return 'documents.findings.card.unlocated'
  if (resolution?.kind === 'missing') return 'documents.findings.card.textChanged'
  if (resolution?.kind === 'located' && !resolution.matches) return 'documents.findings.card.textChanged'
  return null
}

function statusLabelKey(finding: DocumentFindingItem): string | null {
  if (finding.status === 'applied') return 'documents.findings.status.applied'
  if (finding.status === 'kept') return 'documents.findings.status.kept'
  return null
}

export function FindingCard({
  finding,
  resolution,
  active,
  expanded,
  canDecide,
  editorEditable,
  pending,
  revertable,
  onLocate,
  onToggle,
  onApply,
  onKeep,
  onReopen,
  onRevert,
  onNote,
}: FindingCardProps) {
  const t = useT()
  const SeverityIcon = SEVERITY_ICON[finding.severity]
  const locationMessage = locationMessageKey(finding, resolution)
  const located = resolution?.kind === 'located'
  const applyAllowed = canDecide && editorEditable && canApplyFinding(finding, resolution)
  const decidedLabel = statusLabelKey(finding)
  const meta = [finding.sectionLabel, finding.ruleCode].filter((value): value is string => Boolean(value && value.trim()))
  const bodyVisible = expanded || revertable
  const bodyId = findingCardBodyId(finding.id)
  const handleFocus = (event: React.FocusEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && located) onLocate(finding)
  }

  return (
    <article
      id={findingCardElementId(finding.id)}
      tabIndex={-1}
      onFocus={handleFocus}
      data-testid="documents-finding-card"
      data-finding-id={finding.id}
      data-severity={finding.severity}
      data-status={finding.status}
      data-expanded={bodyVisible ? 'true' : 'false'}
      aria-label={finding.title}
      className={cn(
        'space-y-3 rounded-md border bg-card p-3 focus-visible:outline-none focus-visible:shadow-focus',
        active ? 'border-primary' : 'border-border',
      )}
    >
      <div className="flex cursor-pointer items-start gap-2" onClick={() => onToggle(finding)} data-testid="documents-finding-card-header">
        <SeverityIcon className={cn('mt-0.5 size-4 shrink-0', SEVERITY_ICON_CLASS[finding.severity])} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={SEVERITY_VARIANT[finding.severity]}>{t(`documents.findings.severity.${finding.severity}`)}</StatusBadge>
            {decidedLabel ? <StatusBadge variant="neutral">{t(decidedLabel)}</StatusBadge> : null}
          </div>
          <h4 className="text-sm font-semibold text-foreground">
            <button
              type="button"
              className="rounded-sm text-left focus-visible:outline-none focus-visible:shadow-focus"
              aria-expanded={bodyVisible}
              aria-controls={bodyId}
            >
              {finding.title}
            </button>
          </h4>
          {meta.length > 0 ? (
            <p className="truncate font-mono text-xs text-muted-foreground">{meta.join(' · ')}</p>
          ) : null}
        </div>
        {located ? (
          <SimpleTooltip content={t('documents.findings.actions.locate')} size="sm">
            <IconButton
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('documents.findings.actions.locate')}
              onClick={(event) => {
                event.stopPropagation()
                onLocate(finding)
              }}
            >
              <LocateFixed />
            </IconButton>
          </SimpleTooltip>
        ) : null}
        <ChevronDown
          className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', !bodyVisible && '-rotate-90')}
          aria-hidden
        />
      </div>
      <div id={bodyId} hidden={!bodyVisible} className="space-y-3" data-testid="documents-finding-card-body">
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{finding.explanation}</p>
        <div className="space-y-1 rounded-md border border-border bg-muted p-2 text-sm" data-testid="documents-finding-diff">
          <p className="sr-only">{t('documents.findings.diff.original')}</p>
          <p className="whitespace-pre-wrap text-status-error-text line-through">{finding.quote}</p>
          {finding.suggestedText !== null ? (
            <>
              <p className="sr-only">{t('documents.findings.diff.suggested')}</p>
              <p className="whitespace-pre-wrap rounded-sm bg-status-success-bg px-1 text-status-success-text">
                {finding.suggestedText.length > 0 ? finding.suggestedText : t('documents.findings.diff.removePassage')}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t('documents.findings.diff.noSuggestion')}</p>
          )}
        </div>
        {locationMessage ? (
          <p className="text-xs text-status-warning-text" role="status" data-testid="documents-finding-location-message">{t(locationMessage)}</p>
        ) : null}
        {finding.status !== 'open' && finding.decisionNote ? (
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
            {t('documents.findings.card.note', { note: finding.decisionNote })}
          </p>
        ) : null}
        {revertable ? (
          <Alert
            status="error"
            style="lighter"
            action={(
              <Button type="button" size="sm" variant="outline" onClick={onRevert}>
                <Undo2 />{t('documents.findings.actions.revert')}
              </Button>
            )}
          >
            <AlertDescription>{t('documents.findings.card.applyFailed')}</AlertDescription>
          </Alert>
        ) : null}
        {canDecide ? (
          <div className="flex flex-wrap items-center gap-2">
            {finding.status === 'open' ? (
              <>
                {onNote && located ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => onNote(finding)} disabled={pending}>
                    <MessageSquarePlus />{t('documents.findings.actions.note')}
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" onClick={() => onKeep(finding)} disabled={pending}>
                  {t('documents.findings.actions.keep')}
                </Button>
                {finding.suggestedText !== null ? (
                  <Button type="button" size="sm" onClick={() => onApply(finding)} disabled={pending || !applyAllowed}>
                    <Check />{t('documents.findings.actions.apply')}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => onReopen(finding)} disabled={pending}>
                <RotateCcw />{t('documents.findings.actions.reopen')}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </article>
  )
}
