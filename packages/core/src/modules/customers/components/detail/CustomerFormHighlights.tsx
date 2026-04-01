"use client"

import * as React from 'react'
import { Info } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CompanyOverview, PersonOverview } from '../formConfig'

type HighlightItemProps = {
  label: string
  value: string | null | undefined
  href?: string
  hint?: string | null
}

function HighlightItem({ label, value, href, hint }: HighlightItemProps) {
  const display = typeof value === 'string' && value.trim().length ? value.trim() : '—'
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {hint && display === '—' ? (
          <span title={hint} className="cursor-help">
            <Info className="h-3 w-3" />
          </span>
        ) : null}
      </div>
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
  const isLegacy = data.interactionMode !== 'canonical'
  const nextInteractionHint = isLegacy
    ? t('customers.companies.detail.highlights.nextInteractionLegacyHint', 'Available when unified interactions are enabled. Create tasks with a due date to see the next planned interaction.')
    : t('customers.companies.detail.highlights.nextInteractionHint', 'Shows the nearest planned interaction. Create a task with a due date to populate this.')
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <HighlightItem
        label={t('customers.companies.detail.highlights.primaryEmail', 'Email')}
        value={company.primaryEmail}
        href={company.primaryEmail ? `mailto:${company.primaryEmail}` : undefined}
      />
      <HighlightItem
        label={t('customers.companies.detail.highlights.primaryPhone', 'Phone')}
        value={company.primaryPhone != null ? String(company.primaryPhone) : null}
        href={company.primaryPhone ? `tel:${company.primaryPhone}` : undefined}
      />
      <HighlightItem
        label={t('customers.companies.detail.highlights.status', 'Status')}
        value={company.status}
      />
      <HighlightItem
        label={t('customers.companies.detail.highlights.nextInteraction', 'Next interaction')}
        value={formatNextInteraction(company.nextInteractionAt, company.nextInteractionName)}
        hint={nextInteractionHint}
      />
    </div>
  )
}

export function PersonHighlightsSummary({ data }: { data: PersonOverview }) {
  const t = useT()
  const { person, company } = data
  const isLegacy = data.interactionMode !== 'canonical'
  const nextInteractionHint = isLegacy
    ? t('customers.people.detail.highlights.nextInteractionLegacyHint', 'Available when unified interactions are enabled. Create tasks with a due date to see the next planned interaction.')
    : t('customers.people.detail.highlights.nextInteractionHint', 'Shows the nearest planned interaction. Create a task with a due date to populate this.')
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <HighlightItem
        label={t('customers.people.detail.highlights.primaryEmail', 'Email')}
        value={person.primaryEmail}
        href={person.primaryEmail ? `mailto:${person.primaryEmail}` : undefined}
      />
      <HighlightItem
        label={t('customers.people.detail.highlights.primaryPhone', 'Phone')}
        value={person.primaryPhone != null ? String(person.primaryPhone) : null}
        href={person.primaryPhone ? `tel:${person.primaryPhone}` : undefined}
      />
      <HighlightItem
        label={t('customers.people.detail.highlights.status', 'Status')}
        value={person.status}
      />
      <HighlightItem
        label={t('customers.people.detail.highlights.nextInteraction', 'Next interaction')}
        value={formatNextInteraction(person.nextInteractionAt, person.nextInteractionName)}
        hint={nextInteractionHint}
      />
      <HighlightItem
        label={t('customers.people.detail.highlights.company', 'Company')}
        value={company?.displayName}
      />
    </div>
  )
}
