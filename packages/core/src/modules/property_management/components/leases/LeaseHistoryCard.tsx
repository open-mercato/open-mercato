"use client"

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import {
  OPEN_PROPOSAL_STATUSES,
  canSeeSales,
  formatDate,
  formatMoney,
  salesDocumentLink,
  type LeaseDetail,
  type LeaseProposalRow,
  type LeaseVersionRow,
} from './leaseModel'
import { SalesDocumentLinkView } from './SalesDocumentLinkView'

type HistoryRow =
  | { kind: 'version'; at: string; version: LeaseVersionRow }
  | { kind: 'proposal'; at: string; proposal: LeaseProposalRow }

type LeaseHistoryCardProps = {
  detail: LeaseDetail
  canManage: boolean
  onWithdraw: (proposal: LeaseProposalRow) => void
}

function InvoicesCell({ version, visible }: { version: LeaseVersionRow; visible: boolean }) {
  const t = useT()
  const invoices = version.invoices
  if (!visible || !invoices) {
    return <span className="text-muted-foreground" data-testid={`pm-lease-invoices-hidden-${version.id}`}>{t('property_management.leases.salesAccess.invoicesHidden', 'Viewing invoices needs access to sales invoices')}</span>
  }
  if (version.state !== 'in_force' && !invoices.length) {
    return <span className="text-muted-foreground">{t('property_management.leases.history.notInForce', 'None yet — not in force')}</span>
  }
  if (version.recurrence && version.recurrence.invoicesAvailable === false) {
    return <span className="text-muted-foreground">{t('property_management.leases.history.invoicesUnavailable', 'Invoices are not available yet')}</span>
  }
  if (!invoices.length) {
    return <span className="text-muted-foreground">{t('property_management.leases.history.noInvoices', 'No invoices yet')}</span>
  }
  return (
    <ul className="space-y-1">
      {invoices.map((invoice) => (
        <li key={`${version.id}-${invoice.periodIndex}`}>
          {invoice.invoiceId ? <span>{invoice.invoiceNumber ?? invoice.invoiceId}</span> : null}
          {invoice.creditMemoNumber ? <span className="text-muted-foreground"> · {invoice.creditMemoNumber}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export function LeaseHistoryCard({ detail, canManage, onWithdraw }: LeaseHistoryCardProps) {
  const t = useT()
  const locale = useLocale()
  const ordersVisible = canSeeSales(detail, 'orders')
  const quotesVisible = canSeeSales(detail, 'quotes')
  const invoicesVisible = canSeeSales(detail, 'invoices')
  const rows = React.useMemo<HistoryRow[]>(() => {
    const versions: HistoryRow[] = detail.versions
      .filter((version) => !(version.state === 'pending' && detail.proposals.some((proposal) => proposal.status !== 'approved' && proposal.startsOn === version.startsOn && proposal.endsOn === version.endsOn)))
      .map((version) => ({ kind: 'version', at: version.createdAt, version }))
    const proposals: HistoryRow[] = detail.proposals.map((proposal) => ({ kind: 'proposal', at: proposal.createdAt, proposal }))
    return [...versions, ...proposals].sort((left, right) => right.at.localeCompare(left.at))
  }, [detail.proposals, detail.versions])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('property_management.leases.history.title', 'History')}</CardTitle>
        <CardDescription>{t('property_management.leases.history.description', 'Every version of the lease’s product, term and rate, its proposals, and the invoices billed under each version')}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">{t('property_management.leases.history.date', 'Date')}</th>
              <th className="py-2 pr-4">{t('property_management.leases.history.event', 'Event')}</th>
              <th className="py-2 pr-4">{t('property_management.leases.history.term', 'Term')}</th>
              <th className="py-2 pr-4">{t('property_management.leases.history.rate', 'Rate')}</th>
              <th className="py-2 pr-4">{t('property_management.leases.history.documents', 'Sales documents')}</th>
              <th className="py-2">{t('property_management.leases.history.invoices', 'Invoices')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => row.kind === 'version' ? (
              <tr key={row.version.id} className="border-t border-border align-top">
                <td className="py-2 pr-4">{formatDate(row.version.createdAt, locale)}</td>
                <td className="py-2 pr-4">
                  <span className="flex flex-wrap items-center gap-1">
                    {t(`property_management.leases.history.event.${row.version.event}`, row.version.event)}
                    {row.version.state !== 'in_force' ? (
                      <StatusBadge variant={row.version.state === 'reverted' ? 'neutral' : 'warning'}>
                        {t(`property_management.leases.history.state.${row.version.state}`, row.version.state)}
                      </StatusBadge>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{row.version.productName}</span>
                </td>
                <td className="py-2 pr-4">{formatDate(row.version.startsOn, locale)} — {formatDate(row.version.endsOn, locale)}</td>
                <td className="py-2 pr-4">{formatMoney(row.version.monthlyRate, row.version.currencyCode, locale)}</td>
                <td className="py-2 pr-4">
                  <SalesDocumentLinkView
                    link={salesDocumentLink('orders', row.version.salesOrderId, row.version.salesOrderNumber, ordersVisible)}
                    hiddenLabel={t('property_management.leases.salesAccess.orderHidden', 'Created — viewing it needs access to sales orders')}
                    testId={`pm-lease-version-order-${row.version.id}`}
                  />
                </td>
                <td className="py-2"><InvoicesCell version={row.version} visible={invoicesVisible} /></td>
              </tr>
            ) : (
              <tr key={row.proposal.id} className="border-t border-border align-top">
                <td className="py-2 pr-4">{formatDate(row.proposal.createdAt, locale)}</td>
                <td className="py-2 pr-4">
                  <span className="flex flex-wrap items-center gap-1">
                    {row.proposal.kind === 'extension'
                      ? t('property_management.leases.history.extensionProposal', 'Extension proposal')
                      : t('property_management.leases.history.leaseProposal', 'Lease proposal')}
                    <StatusBadge variant={OPEN_PROPOSAL_STATUSES.includes(row.proposal.status) ? 'info' : 'neutral'}>
                      {t(`property_management.leases.proposalStatus.${row.proposal.status}`, row.proposal.status)}
                    </StatusBadge>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t('property_management.leases.list.respondBy', 'Respond by {date}', { date: formatDate(row.proposal.respondBy, locale) })}
                  </span>
                </td>
                <td className="py-2 pr-4">{formatDate(row.proposal.startsOn, locale)} — {formatDate(row.proposal.endsOn, locale)}</td>
                <td className="py-2 pr-4">{formatMoney(row.proposal.monthlyRate, row.proposal.currencyCode, locale)}</td>
                <td className="py-2 pr-4">
                  <SalesDocumentLinkView
                    link={salesDocumentLink('quotes', row.proposal.salesQuoteId, row.proposal.salesQuoteNumber, quotesVisible)}
                    hiddenLabel={t('property_management.leases.salesAccess.quoteHidden', 'Created — viewing it needs access to sales quotes')}
                    testId={`pm-lease-proposal-quote-${row.proposal.id}`}
                  />
                </td>
                <td className="py-2">
                  <span className="text-muted-foreground">{t('property_management.leases.history.proposalNotBilled', 'None — proposals are not billed')}</span>
                  {canManage && OPEN_PROPOSAL_STATUSES.includes(row.proposal.status) ? (
                    <Button type="button" variant="outline" size="sm" className="mt-2 block" onClick={() => onWithdraw(row.proposal)}>
                      {t('property_management.leases.proposal.withdraw', 'Withdraw proposal')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export default LeaseHistoryCard
