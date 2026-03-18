"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Link2, User, Building, Mail, Phone, FileText, CheckCircle } from 'lucide-react'

type TransactionDetailContext = {
  transactionId: string | null
  detail: {
    transaction: Record<string, unknown>
    paymentLink?: {
      id: string
      token: string
      url: string
      title: string
      description: string | null
      status: string
      linkMode: string
      passwordProtected: boolean
      completedAt: string | null
      createdAt: string | null
      updatedAt: string | null
    } | null
    paymentLinkCustomerData?: {
      customerEmail?: string
      firstName?: string
      lastName?: string
      phone?: string
      companyName?: string
      acceptedTerms?: boolean
      customFormFields?: Record<string, unknown>
      customerCreated?: boolean
      customerHandlingMode?: string
      personEntityId?: string
      companyEntityId?: string
    } | null
  } | null
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-zinc-200 text-zinc-900',
}

function DetailRow({ icon, label, value, mono }: { icon?: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <tr className="border-b last:border-0">
      <th className="w-44 bg-muted/25 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
      </th>
      <td className={`px-4 py-2 ${mono ? 'break-all font-mono text-[13px]' : 'break-words text-sm'}`}>
        {value}
      </td>
    </tr>
  )
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

export default function TransactionDetailCustomerDataWidget({
  context,
}: InjectionWidgetComponentProps<Record<string, unknown>, unknown>) {
  const t = useT()
  const ctx = context as unknown as TransactionDetailContext | undefined
  const detail = ctx?.detail as Record<string, unknown> | null
  const paymentLink = detail?.paymentLink as TransactionDetailContext['detail'] extends null ? never : NonNullable<TransactionDetailContext['detail']>['paymentLink']
  const customerData = detail?.paymentLinkCustomerData as TransactionDetailContext['detail'] extends null ? never : NonNullable<TransactionDetailContext['detail']>['paymentLinkCustomerData']

  if (!paymentLink && !customerData) {
    return (
      <div className="rounded-lg border bg-muted/15 p-6 text-center text-sm text-muted-foreground">
        {t('payment_link_pages.transactionDetail.noData', 'No payment link data available for this transaction.')}
      </div>
    )
  }

  const customFormFields = customerData?.customFormFields
  const hasCustomFields = customFormFields && typeof customFormFields === 'object' && Object.keys(customFormFields).length > 0

  return (
    <div className="space-y-6">
      {paymentLink ? (
        <section className="space-y-3 rounded-xl border bg-muted/15 p-4">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('payment_link_pages.transactionDetail.paymentLink', 'Payment Link')}</h3>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody>
                <DetailRow
                  label={t('payment_link_pages.transactionDetail.linkTitle', 'Title')}
                  value={paymentLink.title}
                />
                {paymentLink.description ? (
                  <DetailRow
                    label={t('payment_link_pages.transactionDetail.linkDescription', 'Description')}
                    value={paymentLink.description}
                  />
                ) : null}
                <DetailRow
                  label={t('payment_link_pages.transactionDetail.linkStatus', 'Status')}
                  value={
                    <Badge variant="secondary" className={STATUS_STYLES[paymentLink.status] ?? ''}>
                      {paymentLink.status}
                    </Badge>
                  }
                />
                <DetailRow
                  label={t('payment_link_pages.transactionDetail.linkMode', 'Mode')}
                  value={paymentLink.linkMode === 'multi' ? t('payment_link_pages.transactionDetail.multiUse', 'Multi-use') : t('payment_link_pages.transactionDetail.singleUse', 'Single-use')}
                />
                <DetailRow
                  label={t('payment_link_pages.transactionDetail.linkUrl', 'URL')}
                  value={
                    <a href={paymentLink.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">
                      {paymentLink.url}
                    </a>
                  }
                  mono
                />
                <DetailRow
                  label={t('payment_link_pages.transactionDetail.linkToken', 'Token')}
                  value={paymentLink.token}
                  mono
                />
                {paymentLink.passwordProtected ? (
                  <DetailRow
                    label={t('payment_link_pages.transactionDetail.passwordProtected', 'Password')}
                    value={t('payment_link_pages.transactionDetail.passwordProtectedYes', 'Password-protected')}
                  />
                ) : null}
                <DetailRow
                  label={t('payment_link_pages.transactionDetail.linkCreatedAt', 'Created')}
                  value={formatDateTime(paymentLink.createdAt)}
                />
                {paymentLink.completedAt ? (
                  <DetailRow
                    label={t('payment_link_pages.transactionDetail.linkCompletedAt', 'Completed')}
                    value={formatDateTime(paymentLink.completedAt)}
                  />
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {customerData ? (
        <section className="space-y-3 rounded-xl border bg-muted/15 p-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('payment_link_pages.transactionDetail.customerData', 'Customer Data')}</h3>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody>
                {customerData.customerEmail ? (
                  <DetailRow
                    icon={<Mail className="h-3.5 w-3.5" />}
                    label={t('payment_link_pages.transactionDetail.email', 'Email')}
                    value={customerData.customerEmail}
                  />
                ) : null}
                {customerData.firstName ? (
                  <DetailRow
                    icon={<User className="h-3.5 w-3.5" />}
                    label={t('payment_link_pages.transactionDetail.firstName', 'First name')}
                    value={customerData.firstName}
                  />
                ) : null}
                {customerData.lastName ? (
                  <DetailRow
                    icon={<User className="h-3.5 w-3.5" />}
                    label={t('payment_link_pages.transactionDetail.lastName', 'Last name')}
                    value={customerData.lastName}
                  />
                ) : null}
                {customerData.phone ? (
                  <DetailRow
                    icon={<Phone className="h-3.5 w-3.5" />}
                    label={t('payment_link_pages.transactionDetail.phone', 'Phone')}
                    value={customerData.phone}
                  />
                ) : null}
                {customerData.companyName ? (
                  <DetailRow
                    icon={<Building className="h-3.5 w-3.5" />}
                    label={t('payment_link_pages.transactionDetail.companyName', 'Company')}
                    value={customerData.companyName}
                  />
                ) : null}
                {customerData.acceptedTerms !== undefined ? (
                  <DetailRow
                    icon={<CheckCircle className="h-3.5 w-3.5" />}
                    label={t('payment_link_pages.transactionDetail.termsAccepted', 'Terms accepted')}
                    value={customerData.acceptedTerms
                      ? t('common.yes', 'Yes')
                      : t('common.no', 'No')}
                  />
                ) : null}
                {customerData.customerHandlingMode ? (
                  <DetailRow
                    label={t('payment_link_pages.transactionDetail.handlingMode', 'Customer handling')}
                    value={customerData.customerHandlingMode.replace(/_/g, ' ')}
                  />
                ) : null}
                {customerData.customerCreated !== undefined ? (
                  <DetailRow
                    label={t('payment_link_pages.transactionDetail.customerCreated', 'Customer created')}
                    value={customerData.customerCreated
                      ? t('common.yes', 'Yes')
                      : t('common.no', 'No')}
                  />
                ) : null}
                {customerData.personEntityId ? (
                  <DetailRow
                    label={t('payment_link_pages.transactionDetail.personId', 'Person ID')}
                    value={customerData.personEntityId}
                    mono
                  />
                ) : null}
                {customerData.companyEntityId ? (
                  <DetailRow
                    label={t('payment_link_pages.transactionDetail.companyId', 'Company ID')}
                    value={customerData.companyEntityId}
                    mono
                  />
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {hasCustomFields ? (
        <section className="space-y-3 rounded-xl border bg-muted/15 p-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{t('payment_link_pages.transactionDetail.customFields', 'Custom Form Fields')}</h3>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <tbody>
                {Object.entries(customFormFields!).map(([key, value]) => (
                  <DetailRow
                    key={key}
                    label={key}
                    value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
