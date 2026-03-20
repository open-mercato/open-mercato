"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CompanyOverview, PersonOverview } from '../formConfig'

type HighlightItemProps = {
  label: string
  value: string | null | undefined
  href?: string
}

function HighlightItem({ label, value, href }: HighlightItemProps) {
  const display = value && value.trim().length ? value.trim() : '—'
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {href && display !== '—' ? (
        <a href={href} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
          {display}
        </a>
      ) : (
        <div className="text-sm font-medium">{display}</div>
      )}
    </div>
  )
}

function formatNextInteraction(at: string | null | undefined, name: string | null | undefined): string | null {
  if (!at) return null
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return null
  const formatted = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  return name && name.trim().length ? `${formatted} — ${name.trim()}` : formatted
}

export function CompanyHighlightsSummary({ data }: { data: CompanyOverview }) {
  const t = useT()
  const { company } = data
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <HighlightItem
        label={t('customers.companies.detail.highlights.primaryEmail', 'Email')}
        value={company.primaryEmail}
        href={company.primaryEmail ? `mailto:${company.primaryEmail}` : undefined}
      />
      <HighlightItem
        label={t('customers.companies.detail.highlights.primaryPhone', 'Phone')}
        value={company.primaryPhone}
        href={company.primaryPhone ? `tel:${company.primaryPhone}` : undefined}
      />
      <HighlightItem
        label={t('customers.companies.detail.highlights.status', 'Status')}
        value={company.status}
      />
      <HighlightItem
        label={t('customers.companies.detail.highlights.nextInteraction', 'Next interaction')}
        value={formatNextInteraction(company.nextInteractionAt, company.nextInteractionName)}
      />
    </div>
  )
}

export function PersonHighlightsSummary({ data }: { data: PersonOverview }) {
  const t = useT()
  const { person, company } = data
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <HighlightItem
        label={t('customers.people.detail.highlights.primaryEmail', 'Email')}
        value={person.primaryEmail}
        href={person.primaryEmail ? `mailto:${person.primaryEmail}` : undefined}
      />
      <HighlightItem
        label={t('customers.people.detail.highlights.primaryPhone', 'Phone')}
        value={person.primaryPhone}
        href={person.primaryPhone ? `tel:${person.primaryPhone}` : undefined}
      />
      <HighlightItem
        label={t('customers.people.detail.highlights.status', 'Status')}
        value={person.status}
      />
      <HighlightItem
        label={t('customers.people.detail.highlights.company', 'Company')}
        value={company?.displayName}
      />
    </div>
  )
}
