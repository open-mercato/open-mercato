'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AccessLogItem } from './AccessLogsTable'
import { CollapsibleJsonSection, formatDate } from '../lib/display-helpers'
import {
  ACCESS_LOG_OUTCOME_VARIANTS,
  collectAccessLogContextDetails,
  readAccessLogDurationMs,
  readAccessLogOutcome,
  truncateForDisplay,
} from '../lib/accessLogContext'

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  )
}

export function AccessLogDetailsDialog({ item, onClose }: { item: AccessLogItem; onClose: () => void }) {
  const t = useT()
  const noneLabel = t('audit_logs.common.none')
  const outcome = readAccessLogOutcome(item.context)
  const durationMs = readAccessLogDurationMs(item.context)
  const contextDetails = React.useMemo(() => collectAccessLogContextDetails(item.context), [item.context])
  const hasContext = !!item.context && Object.keys(item.context).length > 0

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="lg" closeAriaLabel={t('audit_logs.access.details.close')}>
        <DialogHeader>
          <DialogTitle className="break-words">{truncateForDisplay(item.resourceKind)}</DialogTitle>
          <DialogDescription>{formatDate(item.createdAt)}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DetailRow label={t('audit_logs.access.details.resource_id')}>
            {item.resourceId ? truncateForDisplay(item.resourceId) : noneLabel}
          </DetailRow>
          <DetailRow label={t('audit_logs.access.columns.access')}>{item.accessType || noneLabel}</DetailRow>
          <DetailRow label={t('audit_logs.access.columns.user')}>{item.actorUserName || item.actorUserId || noneLabel}</DetailRow>
          <DetailRow label={t('audit_logs.access.columns.outcome')}>
            {outcome ? (
              <StatusBadge variant={ACCESS_LOG_OUTCOME_VARIANTS[outcome]} dot>
                {t(`audit_logs.access.outcome.${outcome}`)}
              </StatusBadge>
            ) : noneLabel}
          </DetailRow>
          <DetailRow label={t('audit_logs.access.columns.duration')}>
            {durationMs === null ? noneLabel : t('audit_logs.access.duration_ms', { value: durationMs })}
          </DetailRow>
          <DetailRow label={t('audit_logs.access.columns.tenant')}>{item.tenantName || item.tenantId || noneLabel}</DetailRow>
          <DetailRow label={t('audit_logs.access.columns.organization')}>{item.organizationName || item.organizationId || noneLabel}</DetailRow>
          <DetailRow label={t('audit_logs.access.columns.fields')}>
            {item.fields?.length ? truncateForDisplay(item.fields.join(', ')) : noneLabel}
          </DetailRow>
          {contextDetails.map((row) => (
            <DetailRow key={row.key} label={t(`audit_logs.access.details.context_keys.${row.key}`)}>
              <span className="font-mono text-xs">{row.value}</span>
            </DetailRow>
          ))}
        </dl>
        {hasContext ? (
          <CollapsibleJsonSection label={t('audit_logs.access.details.raw_context')} value={item.context} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
