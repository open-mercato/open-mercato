"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, CalendarX, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import {
  LEASES_HREF,
  LEASES_MANAGE_FEATURE,
  OPEN_PROPOSAL_STATUSES,
  formatDate,
  readErrorMessage,
  statusLabel,
  statusVariant,
  type LeaseDetail,
  type LeaseProposalRow,
} from './leaseModel'
import { LeaseSummaryCard } from './LeaseSummaryCard'
import { LeaseBillingAlerts } from './LeaseBillingAlerts'
import { LeaseHistoryCard } from './LeaseHistoryCard'
import { EndLeaseDialog } from './EndLeaseDialog'
import { ExtendLeaseDialog } from './ExtendLeaseDialog'
import { DeleteLeaseDialog } from './DeleteLeaseDialog'
import { useLeaseMutation } from './useLeaseMutation'

type DialogKind = 'end' | 'extend' | 'delete' | null

export function LeaseDetailPage({ leaseId }: { leaseId: string }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const { payload: chrome } = useBackendChrome()
  const canManage = hasFeature(chrome?.grantedFeatures, LEASES_MANAGE_FEATURE)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { send } = useLeaseMutation('property-management-lease-proposal-withdraw')
  const [detail, setDetail] = React.useState<LeaseDetail | null>(null)
  const [expiryDays, setExpiryDays] = React.useState(14)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState<string | null>(null)
  const [dialog, setDialog] = React.useState<DialogKind>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    void apiCall<LeaseDetail & { error?: string }>(`/api/property_management/leases/${encodeURIComponent(leaseId)}`).then((call) => {
      if (cancelled) return
      if (call.ok && call.result?.lease) {
        setDetail(call.result)
        setFailed(null)
      } else {
        setFailed(call.result?.error ?? t('property_management.leases.detail.loadError', 'Could not load the lease.'))
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [leaseId, reloadToken, t])

  React.useEffect(() => {
    let cancelled = false
    void apiCall<{ proposalExpiryDays?: number }>('/api/property_management/settings', undefined, { fallback: {} }).then((call) => {
      if (!cancelled && call.ok && typeof call.result?.proposalExpiryDays === 'number') setExpiryDays(call.result.proposalExpiryDays)
    })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!detail) return
    const busy = detail.lease.status === 'pending_order' || Boolean(detail.pendingChange) || detail.proposals.some((proposal) => proposal.status === 'sending')
    if (!busy) return
    const timer = setTimeout(reload, 5000)
    return () => clearTimeout(timer)
  }, [detail, reload])

  const withdraw = async (proposal: LeaseProposalRow) => {
    if (!detail) return
    const confirmed = await confirm({
      title: t('property_management.leases.proposal.withdrawTitle', 'Withdraw this proposal?'),
      description: t('property_management.leases.proposal.withdrawBody', 'The quote is cancelled and the tenant can no longer approve it. A new-lease proposal releases the unit.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await send({
        leaseId: detail.lease.id,
        optimisticLockUpdatedAt: detail.lease.updatedAt,
        url: `/api/property_management/leases/${encodeURIComponent(detail.lease.id)}/proposals/${encodeURIComponent(proposal.id)}`,
        method: 'DELETE',
        errorMessage: t('property_management.leases.proposal.withdrawError', 'Could not withdraw the proposal.'),
      })
      flash(t('property_management.leases.proposal.withdrawn', 'Proposal withdrawn.'), 'success')
      reload()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: reload })) return
      flash(readErrorMessage(err, t('property_management.leases.proposal.withdrawError', 'Could not withdraw the proposal.')), 'error')
    }
  }

  if (loading && !detail) {
    return <Page><PageBody><LoadingMessage label={t('property_management.common.loading', 'Loading…')} /></PageBody></Page>
  }
  if (!detail) {
    return <Page><PageBody><ErrorMessage label={failed ?? t('property_management.common.loadError', 'Could not load the data.')} /></PageBody></Page>
  }

  const { lease } = detail
  const changePending = Boolean(detail.pendingChange)
  const openProposal = detail.proposals.find((proposal) => OPEN_PROPOSAL_STATUSES.includes(proposal.status))
  const canChange = canManage && lease.status === 'active' && !changePending
  const ending = lease.status === 'active' && lease.daysLeft >= 0 && lease.daysLeft <= 60

  return (
    <Page>
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{t('property_management.leases.detail.title', 'Lease {reference}', { reference: lease.reference })}</h1>
              <StatusBadge variant={statusVariant(lease.status)} dot>{statusLabel(t, lease.status)}</StatusBadge>
              {ending ? (
                <StatusBadge variant="warning">{t('property_management.leases.detail.endsIn', 'Ends in {days} days', { days: lease.daysLeft })}</StatusBadge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {[lease.unitName, lease.buildingName, lease.companyName].filter(Boolean).join(' · ')}
            </p>
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={!canChange} onClick={() => setDialog('end')}>
                <CalendarX className="size-4" aria-hidden />
                {t('property_management.leases.detail.end', 'End lease')}
              </Button>
              <Button type="button" disabled={!canChange || Boolean(openProposal)} onClick={() => setDialog('extend')}>
                <CalendarPlus className="size-4" aria-hidden />
                {t('property_management.leases.detail.extend', 'Extend lease')}
              </Button>
            </div>
          ) : null}
        </div>
        {openProposal && openProposal.kind === 'extension' ? (
          <p className="text-sm" data-testid="pm-lease-open-proposal">
            {t('property_management.leases.detail.extensionSent', 'Extension proposal sent. {tenant} can approve or decline it in their portal until {date}.', {
              tenant: lease.companyName ?? '',
              date: formatDate(openProposal.respondBy, locale),
            })}
          </p>
        ) : null}
        <LeaseBillingAlerts detail={detail} />
        <LeaseSummaryCard detail={detail} />
        <LeaseHistoryCard detail={detail} canManage={canManage && !changePending} onWithdraw={(proposal) => void withdraw(proposal)} />
        {canManage ? (
          <div className="flex justify-end">
            <Button type="button" variant="destructive-outline" disabled={changePending} onClick={() => setDialog('delete')}>
              <Trash2 className="size-4" aria-hidden />
              {t('property_management.leases.delete.confirm', 'Delete lease')}
            </Button>
          </div>
        ) : null}
        <EndLeaseDialog lease={dialog === 'end' ? lease : null} onClose={() => setDialog(null)} onEnded={() => { setDialog(null); reload() }} />
        <ExtendLeaseDialog
          lease={dialog === 'extend' ? lease : null}
          defaultExpiryDays={expiryDays}
          onClose={() => setDialog(null)}
          onExtended={() => { setDialog(null); reload() }}
        />
        <DeleteLeaseDialog
          lease={dialog === 'delete' ? lease : null}
          onClose={() => setDialog(null)}
          onDeleted={() => { setDialog(null); router.push(LEASES_HREF) }}
          onEndInstead={() => setDialog('end')}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default LeaseDetailPage
