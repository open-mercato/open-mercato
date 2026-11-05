"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import {
  PORTAL_SUPPORT_STATUS_VARIANTS,
  PORTAL_SUPPORT_UPDATED_EVENT,
  isPortalSupportAccountNotLinked,
  portalSupportStatusLabel,
  type PortalSupportOptions,
  type PortalSupportTicketList,
  type PortalSupportTicketListItem,
} from '@open-mercato/core/modules/staff/lib/support-ui/portalSupport'
import { PortalSupportNotLinked } from '@open-mercato/core/modules/staff/lib/support-ui/PortalSupportNotLinked'

function readOrgSlug(context: unknown): string {
  if (!context || typeof context !== 'object') return ''
  const value = (context as Record<string, unknown>).orgSlug
  return typeof value === 'string' ? value : ''
}

const MAX_ITEMS = 5

function activityTime(item: PortalSupportTicketListItem): number {
  const value = item.lastActivityAt ?? item.updatedAt ?? item.createdAt
  return value ? new Date(value).getTime() || 0 : 0
}

export default function PortalSupportTicketsWidget({ context }: InjectionWidgetComponentProps) {
  const t = useT()
  const orgSlug = readOrgSlug(context)
  const [items, setItems] = React.useState<PortalSupportTicketListItem[]>([])
  const [openCount, setOpenCount] = React.useState(0)
  const [canCreate, setCanCreate] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [notLinked, setNotLinked] = React.useState(false)

  const loadSeqRef = React.useRef(0)

  const load = React.useCallback(async () => {
    const requestSeq = loadSeqRef.current + 1
    loadSeqRef.current = requestSeq
    const isStale = () => requestSeq !== loadSeqRef.current
    try {
      const [received, inProgress, options] = await Promise.all([
        apiCall<PortalSupportTicketList>(`/api/staff/portal/support-tickets?status=received&pageSize=${MAX_ITEMS}`, { credentials: 'include' }),
        apiCall<PortalSupportTicketList>(`/api/staff/portal/support-tickets?status=in_progress&pageSize=${MAX_ITEMS}`, { credentials: 'include' }),
        apiCall<PortalSupportOptions>('/api/staff/portal/support-tickets/options', { credentials: 'include' }),
      ])
      if (isStale()) return
      const accountNotLinked = isPortalSupportAccountNotLinked(received)
      setNotLinked(accountNotLinked)
      if (accountNotLinked) {
        setLoadFailed(false)
        return
      }
      if (!received.ok || !inProgress.ok) {
        setLoadFailed(true)
        return
      }
      setLoadFailed(false)
      const merged = [...(received.result?.items ?? []), ...(inProgress.result?.items ?? [])]
        .sort((left, right) => activityTime(right) - activityTime(left))
        .slice(0, MAX_ITEMS)
      setItems(merged)
      setOpenCount((received.result?.total ?? 0) + (inProgress.result?.total ?? 0))
      setCanCreate(options.ok && options.result?.canCreate === true)
    } catch {
      if (!isStale()) setLoadFailed(true)
    } finally {
      if (!isStale()) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  usePortalAppEvent(PORTAL_SUPPORT_UPDATED_EVENT, () => {
    void load()
  }, [load])

  if (loading) {
    return <LoadingMessage label={t('staff.portal.support.widget.loading', 'Loading your tickets…')} />
  }

  if (notLinked) {
    return (
      <div data-testid="portal-support-widget">
        <PortalSupportNotLinked size="sm" />
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div data-testid="portal-support-widget">
        <ErrorMessage
          label={t('staff.portal.support.loadFailed', 'Could not load your support tickets.')}
          action={(
            <Button size="sm" variant="outline" onClick={() => { void load() }}>
              {t('staff.portal.support.widget.retry', 'Try again')}
            </Button>
          )}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="portal-support-widget">
      <p className="text-sm text-muted-foreground">
        {t('staff.portal.support.widget.openCount', 'Open tickets: {count}', { count: String(openCount) })}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('staff.portal.support.widget.empty', 'No open tickets.')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <Link href={`/${orgSlug}/portal/support/${item.id}`} className="min-w-0 truncate text-sm text-foreground hover:underline">
                {item.supportReference} · {item.subject}
              </Link>
              <StatusBadge variant={PORTAL_SUPPORT_STATUS_VARIANTS[item.portalStatus] ?? 'neutral'}>
                {portalSupportStatusLabel(t, item.portalStatus)}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {canCreate ? (
          <Button size="sm" asChild>
            <Link href={`/${orgSlug}/portal/support/new`}>{t('staff.portal.support.newTicket', 'New ticket')}</Link>
          </Button>
        ) : null}
        <Button size="sm" variant="outline" asChild>
          <Link href={`/${orgSlug}/portal/support`}>{t('staff.portal.support.widget.viewAll', 'View all')}</Link>
        </Button>
      </div>
    </div>
  )
}
