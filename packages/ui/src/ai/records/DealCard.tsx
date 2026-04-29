"use client"

import * as React from 'react'
import { Briefcase, Building2, CalendarDays, CircleDollarSign, User } from 'lucide-react'
import { KeyValueList, RecordCardShell, TagRow, statusToTagVariant } from './RecordCardShell'
import type { DealRecordPayload } from './types'

function formatAmount(amount: string | number | null | undefined, currency?: string | null): string | null {
  if (amount === null || amount === undefined || amount === '') return null
  const value = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(value)) {
    return typeof amount === 'string' ? amount : null
  }
  const code = currency && currency.length === 3 ? currency.toUpperCase() : undefined
  try {
    if (code) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value)
    }
  } catch {
    // fall through to fallback
  }
  const formatted = new Intl.NumberFormat().format(value)
  return code ? `${formatted} ${code}` : formatted
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export interface DealCardProps extends DealRecordPayload {}

export function DealCard(props: DealCardProps) {
  const status = props.status
    ? { label: props.status, variant: statusToTagVariant(props.status) }
    : null
  const stage = props.stage && props.stage !== props.status ? props.stage : null
  const amount = formatAmount(props.amount, props.currency)
  const closeDate = formatDate(props.closeDate)

  const items = [
    stage ? { label: 'Stage', value: stage } : null,
    amount ? { label: 'Amount', value: <span className="font-medium">{amount}</span> } : null,
    closeDate ? { label: 'Close', value: closeDate } : null,
    props.companyName ? { label: 'Company', value: props.companyName } : null,
    props.personName ? { label: 'Contact', value: props.personName } : null,
    props.ownerName ? { label: 'Owner', value: props.ownerName } : null,
  ].filter(Boolean) as { label: string; value: React.ReactNode }[]

  const subtitleParts: string[] = []
  if (props.companyName) subtitleParts.push(props.companyName)
  if (props.personName && !props.companyName) subtitleParts.push(props.personName)
  if (amount) subtitleParts.push(amount)

  return (
    <RecordCardShell
      kindLabel="Deal"
      kindIcon={<Briefcase className="size-4" aria-hidden />}
      title={props.title}
      subtitle={subtitleParts.join(' • ')}
      status={status}
      href={props.href}
      id={props.id}
      className={props.className}
      dataKind="deal"
    >
      <div className="space-y-2">
        <KeyValueList items={items} />
        {props.description ? (
          <p className="line-clamp-2 text-muted-foreground">{props.description}</p>
        ) : null}
        {props.tags && props.tags.length > 0 ? <TagRow tags={props.tags} /> : null}
      </div>
    </RecordCardShell>
  )
}

export default DealCard

// Re-export icons consumers may want when extending the layout
export { Briefcase, Building2, CalendarDays, CircleDollarSign, User }
