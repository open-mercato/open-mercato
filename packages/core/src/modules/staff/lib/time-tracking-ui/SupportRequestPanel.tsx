"use client"

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SUPPORT_PORTAL_STATUS_VARIANT, type SupportTicketView } from './supportTicketData'

export function supportPortalStatusLabel(
  t: ReturnType<typeof useT>,
  status: SupportTicketView['portalStatus'],
): string {
  if (status === 'resolved') return t('staff.support.tickets.status.resolved', 'Resolved')
  if (status === 'in_progress') return t('staff.support.tickets.status.inProgress', 'In progress')
  return t('staff.support.tickets.status.received', 'Received')
}

type SupportRequestPanelProps = {
  ticket: SupportTicketView
}

/**
 * The customer request behind a portal ticket, as the customer wrote it. The task
 * title and description above are staff-editable working copies; the portal only
 * ever shows this original.
 */
export function SupportRequestPanel({ ticket }: SupportRequestPanelProps) {
  const t = useT()
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: t('staff.time_tracking.taskDrawer.support.reference', 'Ticket'), value: ticket.supportReference },
    {
      label: t('staff.time_tracking.taskDrawer.support.customer', 'Customer'),
      value: ticket.customerName ?? t('staff.time_tracking.taskDrawer.support.unknown', 'Unknown'),
    },
    {
      label: t('staff.time_tracking.taskDrawer.support.reporter', 'Reported by'),
      value: ticket.reporterName ?? t('staff.time_tracking.taskDrawer.support.unknown', 'Unknown'),
    },
    { label: t('staff.time_tracking.taskDrawer.support.category', 'Category'), value: ticket.categoryLabel },
    {
      label: t('staff.time_tracking.taskDrawer.support.routedVia', 'Routed by'),
      value:
        ticket.routedVia === 'category'
          ? t('staff.time_tracking.taskDrawer.support.routedViaCategory', 'Category rule')
          : t('staff.time_tracking.taskDrawer.support.routedViaFallback', 'Fallback project'),
    },
    {
      label: t('staff.time_tracking.taskDrawer.support.portalStatus', 'Customer sees'),
      value: (
        <StatusBadge variant={SUPPORT_PORTAL_STATUS_VARIANT[ticket.portalStatus]} dot>
          {supportPortalStatusLabel(t, ticket.portalStatus)}
        </StatusBadge>
      ),
    },
  ]
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted px-4 py-3"
      data-testid="task-drawer-support-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('staff.time_tracking.taskDrawer.support.title', 'Customer request')}
        </h3>
        {ticket.unnotifiedAt ? (
          <Badge variant="warning" size="sm">
            {t('staff.support.tickets.nobodyNotified', 'Nobody notified')}
          </Badge>
        ) : null}
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      {ticket.requestSubject || ticket.requestBody ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            {t('staff.time_tracking.taskDrawer.support.originalRequest', 'Original request')}
          </span>
          {ticket.requestSubject ? (
            <p className="text-sm font-medium text-foreground">{ticket.requestSubject}</p>
          ) : null}
          {ticket.requestBody ? (
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{ticket.requestBody}</p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground" data-testid="task-drawer-support-hint">
        {t(
          'staff.time_tracking.taskDrawer.support.titleHint',
          'The customer sees their original request, not the task title and description.',
        )}
      </p>
    </section>
  )
}

export default SupportRequestPanel
