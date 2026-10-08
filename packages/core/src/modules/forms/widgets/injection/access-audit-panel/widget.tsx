"use client"

/**
 * Phase 2b — AccessAuditPanel injection widget.
 *
 * Mounts into the submission drawer's `submission-drawer:access-audit` spot.
 * Fetches the access-audit trail for the submission from
 * `GET /api/forms/submissions/:submissionId/access-audit` and renders each row
 * (actor / when / purpose / IP). Shows an empty state when no rows exist.
 *
 * Read-only — no mutation, so it does not need `useGuardedMutation`. Uses
 * `apiCall` (never raw fetch). Feature-gated behind `forms.view` to match the
 * server route. Re-fetches when the host drawer fires the shared refresh event
 * (e.g. after anonymization changes the trail).
 */

import * as React from 'react'
import { History } from 'lucide-react'
import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  FORMS_DRAWER_REFRESH_EVENT,
  type FormsDrawerWidgetContext,
} from '../context'
import {
  formatAuditRows,
  type AccessAuditApiRow,
  type AccessAuditPurpose,
  type FormattedAuditRow,
} from '../audit-format'

type AccessAuditPanelProps = {
  context: FormsDrawerWidgetContext
}

const PURPOSE_VARIANT: Record<AccessAuditPurpose, 'info' | 'success' | 'warning' | 'error' | 'neutral'> = {
  view: 'info',
  export: 'success',
  revert: 'warning',
  reopen: 'warning',
  anonymize: 'error',
}

export function AccessAuditPanelWidget({ context }: AccessAuditPanelProps) {
  const t = useT()
  const submissionId = typeof context?.submissionId === 'string' ? context.submissionId : null
  const [rows, setRows] = React.useState<FormattedAuditRow[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    if (!submissionId) {
      setRows([])
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    const resp = await apiCall<{ items: AccessAuditApiRow[] }>(
      `/api/forms/submissions/${encodeURIComponent(submissionId)}/access-audit`,
    )
    setRows(resp.ok && resp.result ? formatAuditRows(resp.result.items) : [])
    setIsLoading(false)
  }, [submissionId])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      void load()
    }
    window.addEventListener(FORMS_DRAWER_REFRESH_EVENT, handler)
    return () => window.removeEventListener(FORMS_DRAWER_REFRESH_EVENT, handler)
  }, [load])

  if (!submissionId) return null

  return (
    <section
      aria-label={t('forms.compliance.audit.title', { fallback: 'Access audit' })}
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
      data-forms-access-audit-panel=""
    >
      <header className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('forms.compliance.audit.title', { fallback: 'Access audit' })}
        </h3>
      </header>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Spinner className="h-4 w-4" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          {t('forms.compliance.audit.empty', { fallback: 'No access events recorded yet.' })}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-muted-foreground">{row.actorShort}</span>
                {row.timestampMs != null ? (
                  <time className="text-muted-foreground" dateTime={new Date(row.timestampMs).toISOString()}>
                    {new Date(row.timestampMs).toLocaleString()}
                  </time>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {row.ip ? <span className="font-mono text-muted-foreground">{row.ip}</span> : null}
                <Tag variant={PURPOSE_VARIANT[row.purpose]} dot>
                  {t(row.purposeKey, { fallback: row.purpose })}
                </Tag>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const widget: InjectionWidgetModule<FormsDrawerWidgetContext> = {
  metadata: {
    id: 'forms.injection.access-audit-panel',
    title: 'Forms Submission Access Audit Panel',
    description:
      'Lists the access-audit trail (who/when/purpose/IP) for a submission inside the drawer; reloads on the drawer refresh event.',
    features: ['forms.view'],
    priority: 100,
    enabled: true,
  },
  Widget: AccessAuditPanelWidget,
}

export default widget
