"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, CalendarX, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { usePlural } from '../plural'
import {
  LEASES_HREF,
  LEASES_MANAGE_FEATURE,
  OPEN_PROPOSAL_STATUSES,
  applyLeaseDetailCrmAccess,
  formatDate,
  leaseNeedsBillingCancel,
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
import { useLeaseSettings } from './useLeaseSettings'

type DialogKind = 'end' | 'extend' | 'delete' | null

export function LeaseDetailPage({ leaseId }: { leaseId: string }) {
  const t = useT()
  const { plural } = usePlural()
  const locale = useLocale()
  const router = useRouter()
  const { payload: chrome } = useBackendChrome()
  const canManage = hasFeature(chrome?.grantedFeatures, LEASES_MANAGE_FEATURE)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { send } = useLeaseMutation('property-management-lease-proposal-withdraw')
  const [detail, setDetail] = React.useState<LeaseDetail | null>(null)
  const detailRef = React.useRef<LeaseDetail | null>(null)
  React.useEffect(() => {
    detailRef.current = detail
  }, [detail])
  const { settings } = useLeaseSettings({ enabled: canManage })
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogKind>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  React.useEffect(() => {
    let cancelled = false
    const loadError = t('property_management.leases.detail.loadError', 'Could not load the lease.')
    setLoading(true)
    apiCall<LeaseDetail & { error?: string }>(`/api/property_management/leases/${encodeURIComponent(leaseId)}`)
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result?.lease) {
          setDetail(applyLeaseDetailCrmAccess(call.result))
          setFailed(null)
          setNotFound(false)
        } else if (call.status === 404) {
          setDetail(null)
          setNotFound(true)
        } else {
          setFailed(call.result?.error ?? loadError)
        }
      })
      .catch((err) => {
        getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.lease_detail_load_failed' })
        if (!cancelled) setFailed(loadError)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leaseId, reloadToken, t])

  React.useEffect(() => {
    if (!detail || loading) return
    const busy = detail.lease.status === 'pending_order' || Boolean(detail.pendingChange) || detail.proposals.some((proposal) => proposal.status === 'sending')
    if (!busy || dialog) return
    const timer = setTimeout(reload, 5000)
    return () => clearTimeout(timer)
  }, [detail, dialog, loading, reload])

  const withdraw = async (proposal: LeaseProposalRow) => {
    if (!detail) return
    const confirmed = await confirm({
      title: t('property_management.leases.proposal.withdrawTitle', 'Withdraw this proposal?'),
      description: t('property_management.leases.proposal.withdrawBody', 'The quote is cancelled and the tenant can no longer approve it. A new-lease proposal releases the unit.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const lease = detailRef.current?.lease ?? detail.lease
    try {
      await send({
        leaseId: lease.id,
        optimisticLockUpdatedAt: lease.updatedAt,
        url: `/api/property_management/leases/${encodeURIComponent(lease.id)}/proposals/${encodeURIComponent(proposal.id)}`,
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
  if (notFound && !detail) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('property_management.leases.detail.notFound', 'Lease not found')}
            description={t('property_management.leases.detail.notFoundHint', 'It may have been deleted, or its building is not assigned to you.')}
            backHref={LEASES_HREF}
            backLabel={t('property_management.leases.detail.backToLeases', 'Back to leases')}
          />
        </PageBody>
      </Page>
    )
  }
  if (!detail) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={failed ?? t('property_management.common.loadError', 'Could not load the data.')}
            action={<Button type="button" variant="outline" onClick={reload}>{t('property_management.common.retry', 'Try again')}</Button>}
          />
        </PageBody>
      </Page>
    )
  }

  const { lease } = detail
  const deleted = detail.deleted === true
  const canAct = canManage && !deleted
  const changePending = Boolean(detail.pendingChange)
  const openProposal = detail.proposals.find((proposal) => OPEN_PROPOSAL_STATUSES.includes(proposal.status))
  const canChange = canAct && lease.status === 'active' && !changePending
  const ending = detail.leaseEnding === true
  const salesCancelAvailable = detail.salesCancelAvailable !== false
  const deleteNeedsCancel = leaseNeedsBillingCancel(detail)
  const canEnd = canChange && salesCancelAvailable
  const canDelete = !changePending && (salesCancelAvailable || !deleteNeedsCancel)

  return (
    <Page>
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{t('property_management.leases.detail.title', 'Lease {reference}', { reference: lease.reference })}</h1>
              <StatusBadge variant={statusVariant(lease.status)} dot>{statusLabel(t, lease.status)}</StatusBadge>
              {ending ? (
                <StatusBadge variant="warning">{plural('property_management.leases.detail.endsIn', 'Ends in {count} days', lease.daysLeft)}</StatusBadge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              {[lease.unitName, lease.buildingName, lease.companyName].filter(Boolean).join(' · ')}
            </p>
          </div>
          {canAct ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={!canEnd} onClick={() => setDialog('end')}>
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
        {failed ? (
          <Alert status="error" data-testid="pm-lease-refresh-error">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('property_management.leases.detail.refreshError', 'Could not refresh the lease, so what is shown may be out of date: {error}', { error: failed })}</span>
              <Button type="button" variant="outline" size="sm" onClick={reload}>{t('property_management.common.retry', 'Try again')}</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {deleted ? (
          <Alert status="warning" data-testid="pm-lease-deleted">
            <AlertDescription>
              {t('property_management.leases.detail.deleted', 'This lease has been deleted. It stays visible, read-only, until its billing has settled.')}
            </AlertDescription>
          </Alert>
        ) : null}
        {openProposal && openProposal.kind === 'extension' ? (
          <p className="text-sm" data-testid="pm-lease-open-proposal">
            {lease.companyName
              ? t('property_management.leases.detail.extensionSent', 'Extension proposal sent. {tenant} can approve or decline it in their portal until {date}.', {
                tenant: lease.companyName,
                date: formatDate(openProposal.respondBy, locale),
              })
              : t('property_management.leases.detail.extensionSentNoTenant', 'Extension proposal sent. The tenant can approve or decline it in their portal until {date}.', {
                date: formatDate(openProposal.respondBy, locale),
              })}
          </p>
        ) : null}
        {canAct && !salesCancelAvailable ? (
          <Alert status="information" data-testid="pm-lease-cancel-unavailable">
            <AlertDescription>
              {t('property_management.leases.detail.cancelUnavailable', 'This installation’s sales module cannot cancel recurring orders yet, so a lease cannot be ended early, and a lease with a billed order that is not already cut cannot be deleted. Leases still end automatically at term, and a proposed lease, a lease still activating without an order in flight, or a lease whose orders are all cut can still be deleted.')}
            </AlertDescription>
          </Alert>
        ) : null}
        <LeaseBillingAlerts detail={detail} />
        <LeaseSummaryCard detail={detail} />
        <LeaseHistoryCard detail={detail} canManage={canAct && !changePending} onWithdraw={(proposal) => void withdraw(proposal)} />
        {canAct ? (
          <div className="flex justify-end">
            <Button type="button" variant="destructive-outline" disabled={!canDelete} onClick={() => setDialog('delete')}>
              <Trash2 className="size-4" aria-hidden />
              {t('property_management.leases.delete.confirm', 'Delete lease')}
            </Button>
          </div>
        ) : null}
        <EndLeaseDialog lease={dialog === 'end' ? lease : null} today={settings?.today ?? null} onClose={() => setDialog(null)} onEnded={() => { setDialog(null); reload() }} />
        <ExtendLeaseDialog
          lease={dialog === 'extend' ? lease : null}
          defaultExpiryDays={settings?.proposalExpiryDays ?? null}
          onClose={() => setDialog(null)}
          onExtended={() => { setDialog(null); reload() }}
        />
        <DeleteLeaseDialog
          lease={dialog === 'delete' ? lease : null}
          onClose={() => setDialog(null)}
          onDeleted={() => { setDialog(null); router.push(LEASES_HREF) }}
          onEndInstead={canEnd ? () => setDialog('end') : undefined}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default LeaseDetailPage
