'use client'

/**
 * The "Would do" report (spec section 8.2) — an ordered list of every side
 * effect a dry run suppressed.
 *
 * Severity pairs its DS token with an icon AND an `sr-only` name, per the
 * section 4.6 rule that status is never colour-only.
 */

import * as React from 'react'
import { AlertTriangle, Ban, Bot, CircleCheck, ShieldAlert, UserCheck } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import type { WouldDoEntry, WouldDoEntryKind } from '../../lib/dry-run'

export type WouldDoReportPayload = {
  isDryRun: boolean
  entries: WouldDoEntry[]
  stoppedByRefusal: boolean
}

const KIND_ICON: Record<WouldDoEntryKind, React.ComponentType<{ className?: string }>> = {
  activity: CircleCheck,
  refusal: Ban,
  userTask: UserCheck,
  businessRule: ShieldAlert,
}

const SEVERITY_STYLE: Record<string, { dot: string; text: string }> = {
  error: { dot: 'bg-status-error-icon', text: 'text-status-error-icon' },
  warning: { dot: 'bg-status-warning-icon', text: 'text-status-warning-icon' },
  info: { dot: 'bg-status-info-icon', text: 'text-status-info-icon' },
}

export function WouldDoReport({ report }: { report: WouldDoReportPayload | null }) {
  const t = useT()

  if (!report || !report.isDryRun) return null

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t('workflows.dryRun.report.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('workflows.dryRun.report.description')}</p>
      </div>

      {report.stoppedByRefusal && (
        <Alert status="warning" icon={<AlertTriangle aria-hidden="true" />}>
          <AlertTitle>{t('workflows.dryRun.report.stoppedTitle')}</AlertTitle>
          <AlertDescription>{t('workflows.dryRun.report.stoppedDescription')}</AlertDescription>
        </Alert>
      )}

      {report.entries.length === 0 ? (
        <p className="rounded-lg border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
          {t('workflows.dryRun.report.empty')}
        </p>
      ) : (
        <ol className="space-y-2">
          {report.entries.map((entry) => {
            const Icon = KIND_ICON[entry.kind] ?? Bot
            const severity = SEVERITY_STYLE[entry.severity] ?? SEVERITY_STYLE.info
            return (
              <li key={entry.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start gap-2">
                  <span className={`mt-1 size-2.5 shrink-0 rounded-full ${severity.dot}`} aria-hidden="true" />
                  <Icon className={`mt-0.5 size-4 shrink-0 ${severity.text}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="sr-only">
                        {t(`workflows.dryRun.report.severity.${entry.severity}`)}
                      </span>
                      <span className="text-sm font-medium">
                        {t(`workflows.dryRun.report.kind.${entry.kind}`)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{entry.subject}</span>
                      {entry.stepId ? (
                        <span className="text-overline text-muted-foreground">{entry.stepId}</span>
                      ) : null}
                    </div>
                    <JsonDisplay data={entry.detail} maxInitialDepth={1} />
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
