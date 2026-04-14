"use client"

import * as React from 'react'
import Link from 'next/link'
import {
  Building2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  Hash,
  MapPin,
  TrendingUp,
  Zap,
  Tag as TagIcon,
  Users,
} from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { renderDictionaryIcon } from '../../../dictionaries/components/dictionaryAppearance'
import type { CustomerDictionaryDisplayEntry, CustomerDictionaryMap } from '../../lib/dictionaries'
import { formatFallbackLabel } from './utils'

export type EnrichedCompanyData = {
  linkId: string
  companyId: string
  displayName: string
  isPrimary: boolean
  subtitle: string | null
  profile: {
    industry: string | null
    sizeBucket: string | null
    legalName: string | null
    domain: string | null
    websiteUrl: string | null
  } | null
  billing: {
    bankName: string | null
    bankAccountMasked: string | null
    paymentTerms: string | null
    preferredCurrency: string | null
  } | null
  primaryAddress: { formatted: string } | null
  tags: Array<{ id: string; label: string; color: string | null }>
  roles: Array<{ id: string; roleValue: string }>
  activeDeal: {
    title: string
    valueAmount: string | null
    valueCurrency: string | null
  } | null
  lastContactAt: string | null
  clv: { amount: number; currency: string } | null
  status: string | null
  lifecycleStage: string | null
  temperature: string | null
  renewalQuarter: string | null
}

type CompanyCardProps = {
  data: EnrichedCompanyData
  personName: string
  statusMap?: CustomerDictionaryMap | undefined
  lifecycleMap?: CustomerDictionaryMap | undefined
  temperatureMap?: CustomerDictionaryMap | undefined
  renewalQuarterMap?: CustomerDictionaryMap | undefined
  roleMap?: CustomerDictionaryMap | undefined
}

function copyToClipboard(text: string, t: ReturnType<typeof useT>) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      flash(t('customers.companies.detail.copied', 'Copied to clipboard'), 'success')
    })
    .catch(() => {})
}

function formatRelativeTime(isoDate: string, t: ReturnType<typeof useT>): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) {
    return `${t('customers.companies.detail.relativeTime.today', 'today')}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  }
  if (diffDays === 1) return t('customers.companies.detail.relativeTime.oneDayAgo', '1 day ago')
  if (diffDays < 7) return t('customers.companies.detail.relativeTime.daysAgo', '{{days}} days ago', { days: diffDays })
  if (diffDays < 30) return t('customers.companies.detail.relativeTime.weeksAgo', '{{weeks}} wk. ago', { weeks: Math.floor(diffDays / 7) })
  return t('customers.companies.detail.relativeTime.monthsAgo', '{{months}} mo. ago', { months: Math.floor(diffDays / 30) })
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      notation: amount >= 1_000_000 ? 'compact' : 'standard',
    }).format(amount)
  } catch {
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)} M ${currency}`
    if (amount >= 1_000) return `${Math.round(amount / 1000)}k ${currency}`
    return `${amount} ${currency}`
  }
}

function ColorBadge({
  value,
  map,
  fallbackIcon,
}: {
  value: string
  map: Record<string, CustomerDictionaryDisplayEntry> | undefined
  fallbackIcon?: React.ReactNode
}) {
  const entry = map?.[value]
  const color = entry?.color ?? null
  const icon = entry?.icon ?? null
  const label = entry?.label ?? formatFallbackLabel(value)
  const colorStyle: React.CSSProperties | undefined = color
    ? { color, borderColor: color, backgroundColor: `${color}1A` }
    : undefined
  return (
    <Badge
      variant="outline"
      className="rounded-[4px] gap-1.5 text-[11px] font-medium"
      style={colorStyle}
    >
      {icon ? renderDictionaryIcon(icon, 'size-2.5') : fallbackIcon ?? null}
      {label}
    </Badge>
  )
}

function StatusDotBadge({
  value,
  map,
}: {
  value: string
  map: Record<string, CustomerDictionaryDisplayEntry> | undefined
}) {
  const entry = map?.[value]
  const color = entry?.color ?? null
  const label = entry?.label ?? formatFallbackLabel(value)
  const colorStyle: React.CSSProperties | undefined = color
    ? { color, borderColor: color, backgroundColor: `${color}1A` }
    : undefined
  return (
    <Badge
      variant="outline"
      className="rounded-[4px] gap-1.5 text-[11px] font-medium"
      style={colorStyle}
    >
      <span
        className="size-1.5 rounded-full"
        style={color ? { backgroundColor: color } : undefined}
      />
      {label}
    </Badge>
  )
}

function BillingRow({
  icon: Icon,
  label,
  value,
  showCopy = true,
  showDottedLine = true,
  t,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  showCopy?: boolean
  showDottedLine?: boolean
  t: ReturnType<typeof useT>
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 min-h-[22px]">
      <Icon className="size-[11px] shrink-0 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground font-medium shrink-0">{label}:</span>
      {showDottedLine && <div className="mx-1 hidden flex-1 border-b border-dotted border-border/50 sm:block" />}
      <span className="min-w-0 break-words text-[12px] font-medium text-foreground">{value}</span>
      {showCopy && (
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0"
          onClick={() => copyToClipboard(value, t)}
          aria-label={t('customers.companies.detail.copy', 'Copy')}
        >
          <Copy className="size-[10px]" />
        </IconButton>
      )}
    </div>
  )
}

export function CompanyCard({
  data,
  personName,
  statusMap,
  lifecycleMap,
  temperatureMap,
  renewalQuarterMap,
  roleMap,
}: CompanyCardProps) {
  const t = useT()

  const hasBillingSection =
    data.profile?.legalName ||
    data.primaryAddress?.formatted ||
    data.billing?.bankName ||
    data.billing?.bankAccountMasked ||
    data.billing?.paymentTerms ||
    data.billing?.preferredCurrency

  const dealValue =
    data.activeDeal?.valueAmount && data.activeDeal?.valueCurrency
      ? `${data.activeDeal.valueAmount} ${data.activeDeal.valueCurrency}`
      : null

  return (
    <div className="min-w-0 overflow-hidden rounded-[18px] border border-border/60 bg-card">
      {/* Header */}
      <div className="flex flex-col gap-3 px-[22px] py-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-muted">
            <Building2 className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-words text-base font-bold">{data.displayName}</span>
              {data.isPrimary && (
                <Badge variant="default" className="rounded-[4px] px-1.5 py-0 text-[10px] font-bold uppercase tracking-wider">
                  PRIMARY
                </Badge>
              )}
            </div>
            {data.subtitle && (
              <p className="break-words text-sm text-muted-foreground">{data.subtitle}</p>
            )}
          </div>
        </div>
        <div className="self-start sm:self-auto">
          <Link href={`/backend/customers/companies-v2/${data.companyId}`}>
            <IconButton variant="ghost" size="sm" type="button">
              <ExternalLink className="size-4" />
            </IconButton>
          </Link>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/60" />

      {/* Body */}
      <div className="px-[22px] py-[18px] space-y-4">
        {/* Info badges */}
        <div className="flex flex-wrap gap-1.5">
          {data.profile?.industry && (
            <Badge variant="outline" className="rounded-[4px] gap-1.5 text-[11px] font-medium">
              <TagIcon className="size-2.5" />
              {data.profile.industry}
            </Badge>
          )}
          {data.profile?.sizeBucket && (
            <Badge variant="outline" className="rounded-[4px] gap-1.5 text-[11px] font-medium">
              <Users className="size-2.5" />
              {data.profile.sizeBucket} {t('customers.companies.detail.employees', 'employees')}
            </Badge>
          )}
          {data.status && <StatusDotBadge value={data.status} map={statusMap} />}
          {data.renewalQuarter && (
            <ColorBadge
              value={data.renewalQuarter}
              map={renewalQuarterMap}
              fallbackIcon={<Clock className="size-2.5" />}
            />
          )}
          {data.temperature && (
            <ColorBadge
              value={data.temperature}
              map={temperatureMap}
              fallbackIcon={<Zap className="size-2.5" />}
            />
          )}
        </div>

        {/* Roles */}
        {data.roles.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t('customers.companies.detail.roleInCompany', 'ROLE OF {{name}} IN THIS COMPANY', { name: personName.toUpperCase() })}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {data.roles.map((role) => (
                <ColorBadge
                  key={role.id}
                  value={role.roleValue}
                  map={roleMap}
                />
              ))}
            </div>
          </div>
        )}

        {/* Stats divider */}
        <div className="border-t border-border/60" />

        {/* Stats row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              {t('customers.companies.detail.activeDeal', 'ACTIVE DEAL')}
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[12px] font-medium text-foreground">
              {data.activeDeal ? (
                <>
                  <Building2 className="size-3 shrink-0" />
                  <span className="min-w-0 break-words">
                    {data.activeDeal.title}
                    {dealValue ? ` · ${dealValue}` : ''}
                  </span>
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              {t('customers.companies.detail.lastContact', 'LAST CONTACT')}
            </span>
            <span className="flex min-w-0 items-center gap-1 break-words text-[12px] font-medium text-foreground">
              {data.lastContactAt ? (
                <>
                  <Clock className="size-3 shrink-0" />
                  {formatRelativeTime(data.lastContactAt, t)}
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
              CLV
            </span>
            <span className="flex min-w-0 items-center gap-1 break-words text-[12px] font-medium text-foreground">
              {data.clv ? (
                <>
                  <TrendingUp className="size-3 shrink-0" />
                  {formatCurrency(data.clv.amount, data.clv.currency)}
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
        </div>

        {/* Billing section */}
        {hasBillingSection && (
          <>
            <div className="border-t border-border/60" />
            <div className="rounded-[12px] bg-muted/40 border border-border/40 px-[14px] py-[12px] space-y-1.5">
              {data.profile?.legalName && (
                <BillingRow icon={FileText} label={t('customers.companies.detail.billing.name', 'Name')} value={data.profile.legalName} t={t} />
              )}
              {data.primaryAddress?.formatted && (
                <BillingRow
                  icon={MapPin}
                  label={t('customers.companies.detail.billing.address', 'Address')}
                  value={data.primaryAddress.formatted}
                  t={t}
                />
              )}
              {(data.billing?.bankName || data.billing?.bankAccountMasked) && (
                <BillingRow
                  icon={CreditCard}
                  label="Bank / IBAN"
                  value={[data.billing?.bankName, data.billing?.bankAccountMasked]
                    .filter(Boolean)
                    .join(' · ')}
                  t={t}
                />
              )}
              {data.billing?.paymentTerms && (
                <BillingRow
                  icon={Clock}
                  label={t('customers.companies.detail.billing.paymentTerms', 'Payment terms')}
                  value={data.billing.paymentTerms}
                  showCopy={false}
                  showDottedLine={false}
                  t={t}
                />
              )}
              {data.billing?.preferredCurrency && (
                <BillingRow
                  icon={Hash}
                  label={t('customers.companies.detail.billing.currency', 'Currency')}
                  value={data.billing.preferredCurrency}
                  showCopy={false}
                  showDottedLine={false}
                  t={t}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
