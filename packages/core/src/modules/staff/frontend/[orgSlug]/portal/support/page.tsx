"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { replaceWithPageReload } from '@open-mercato/shared/lib/navigation/pageReload'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { usePortalAppEvent } from '@open-mercato/ui/portal/hooks/usePortalAppEvent'
import {
  PORTAL_SUPPORT_STATUS_VARIANTS,
  PORTAL_SUPPORT_UPDATED_EVENT,
  formatPortalDate,
  isPortalSupportAccountNotLinked,
  portalSupportStatusLabel,
  type PortalSupportOptions,
  type PortalSupportStatus,
  type PortalSupportTicketList,
  type PortalSupportTicketListItem,
} from '@open-mercato/core/modules/staff/lib/support-ui/portalSupport'
import { PortalSupportNotLinked } from '@open-mercato/core/modules/staff/lib/support-ui/PortalSupportNotLinked'

type Props = { params: { orgSlug: string } }

const PAGE_SIZE = 20
const ALL_STATUSES = 'all'

export default function PortalSupportTicketsPage({ params }: Props) {
  const t = useT()
  const locale = useLocale()
  const { auth } = usePortalContext()
  const { user, loading } = auth

  const [tickets, setTickets] = React.useState<PortalSupportTicketListItem[]>([])
  const [options, setOptions] = React.useState<PortalSupportOptions | null>(null)
  const [status, setStatus] = React.useState<string>(ALL_STATUSES)
  const [page, setPage] = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notLinked, setNotLinked] = React.useState(false)

  React.useEffect(() => {
    if (!loading && !user) replaceWithPageReload(`/${params.orgSlug}/portal/login`)
  }, [loading, user, params.orgSlug])

  const loadSeqRef = React.useRef(0)

  const load = React.useCallback(async (options: { silent?: boolean } = {}) => {
    if (!user) return
    const requestSeq = loadSeqRef.current + 1
    loadSeqRef.current = requestSeq
    const isStale = () => requestSeq !== loadSeqRef.current
    if (!options.silent) setIsLoading(true)
    setError(null)
    try {
      const statusQuery = status === ALL_STATUSES ? '' : `&status=${encodeURIComponent(status)}`
      const [list, opts] = await Promise.all([
        apiCall<PortalSupportTicketList>(`/api/staff/portal/support-tickets?page=${page}&pageSize=${PAGE_SIZE}${statusQuery}`, {
          credentials: 'include',
        }),
        apiCall<PortalSupportOptions>('/api/staff/portal/support-tickets/options', { credentials: 'include' }),
      ])
      if (isStale()) return
      if (isPortalSupportAccountNotLinked(list)) {
        setNotLinked(true)
        setTickets([])
        setOptions(null)
        return
      }
      setNotLinked(false)
      if (!list.ok) {
        setError(t('staff.portal.support.loadFailed', 'Could not load your support tickets.'))
        if (!options.silent) setTickets([])
        return
      }
      setTickets(list.result?.items ?? [])
      setTotalPages(Math.max(1, list.result?.totalPages ?? 1))
      setOptions(opts.ok ? opts.result : null)
    } catch (err) {
      if (isStale()) return
      getTelemetryRuntime()?.reportError(err, { module: 'staff', code: 'staff.portal_support_list_failed' })
      setError(t('staff.portal.support.loadFailed', 'Could not load your support tickets.'))
      if (!options.silent) setTickets([])
    } finally {
      if (!isStale()) setIsLoading(false)
    }
  }, [user, page, status, t])

  React.useEffect(() => {
    void load()
  }, [load])

  usePortalAppEvent(PORTAL_SUPPORT_UPDATED_EVENT, () => {
    void load({ silent: true })
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner />
      </div>
    )
  }
  if (!user) return null

  const canCreate = options?.canCreate === true
  const noCategories = options !== null && (options.categories ?? []).length === 0
  const newTicketHref = `/${params.orgSlug}/portal/support/new`

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title={t('staff.portal.support.title', 'Support')}
        description={t('staff.portal.support.description', 'Ask for help and follow the progress of your requests.')}
        action={
          canCreate && !notLinked ? (
            <Button asChild>
              <Link href={newTicketHref}>
                <Plus className="mr-2 h-4 w-4" />
                {t('staff.portal.support.newTicket', 'New ticket')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {notLinked ? <PortalSupportNotLinked /> : null}

      {notLinked ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{t('staff.portal.support.filter.status', 'Status')}</span>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-48" aria-label={t('staff.portal.support.filter.status', 'Status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>{t('staff.portal.support.filter.all', 'All statuses')}</SelectItem>
              {(['received', 'in_progress', 'resolved'] as PortalSupportStatus[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {portalSupportStatusLabel(t, value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error ? (
        <ErrorMessage
          label={error}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              {t('staff.portal.support.retry', 'Try again')}
            </Button>
          }
        />
      ) : null}

      {notLinked ? null : isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState
          variant="subtle"
          size="lg"
          title={
            noCategories
              ? t('staff.portal.support.unavailableTitle', 'Support requests are not available yet')
              : t('staff.portal.support.emptyTitle', 'No support tickets yet')
          }
          description={
            noCategories
              ? t('staff.portal.support.unavailableDescription', 'Please contact us directly until support requests are enabled.')
              : t('staff.portal.support.emptyDescription', 'When you file a ticket, you can follow it here.')
          }
          actions={
            canCreate ? (
              <Button asChild>
                <Link href={newTicketHref}>{t('staff.portal.support.newTicket', 'New ticket')}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <PortalCard key={ticket.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/${params.orgSlug}/portal/support/${ticket.id}`}
                    className="text-base font-medium text-foreground hover:underline"
                  >
                    {ticket.subject}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {ticket.supportReference} · {ticket.category.label}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge variant={PORTAL_SUPPORT_STATUS_VARIANTS[ticket.portalStatus] ?? 'neutral'} dot>
                    {portalSupportStatusLabel(t, ticket.portalStatus)}
                  </StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    {t('staff.portal.support.lastActivityAt', 'Last activity: {date}', {
                      date: formatPortalDate(ticket.lastActivityAt, locale),
                    })}
                  </span>
                </div>
              </div>
            </PortalCard>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            {t('staff.portal.support.previous', 'Previous')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('staff.portal.support.pageIndicator', 'Page {page} / {total}', { page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            {t('staff.portal.support.next', 'Next')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
