"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveAuthorUserNames } from './authorUserLookup'

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type CreatedByFactProps = {
  createdByUserId: string | null | undefined
  ownerUserId?: string | null
  ownerName?: string | null
  variant?: 'header' | 'highlight'
}

type LookupState = {
  creatorId: string
  pending: boolean
  name: string | null
}

function normalizeName(value: string | null | undefined): string | null {
  const name = value?.trim() ?? ''
  return name && !UUID_SHAPE.test(name) ? name : null
}

export function CreatedByFact({
  createdByUserId,
  ownerUserId,
  ownerName,
  variant = 'header',
}: CreatedByFactProps) {
  const t = useT()
  const creatorId = createdByUserId?.trim() || null
  const reusableOwnerName = creatorId && creatorId === ownerUserId?.trim()
    ? normalizeName(ownerName)
    : null
  const [lookup, setLookup] = React.useState<LookupState | null>(null)

  React.useEffect(() => {
    if (!creatorId || reusableOwnerName) return

    const controller = new AbortController()
    let active = true
    setLookup({ creatorId, pending: true, name: null })
    void resolveAuthorUserNames([creatorId], controller.signal)
      .then(({ names }) => {
        if (!active) return
        setLookup({ creatorId, pending: false, name: normalizeName(names.get(creatorId)) })
      })
      .catch(() => {
        if (!active) return
        setLookup({ creatorId, pending: false, name: null })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [creatorId, reusableOwnerName])

  const value = !creatorId
    ? t('customers.detail.createdBy.unknown')
    : reusableOwnerName
      ? reusableOwnerName
      : lookup?.creatorId !== creatorId || lookup.pending
        ? '—'
        : lookup.name ?? t('customers.detail.createdBy.unknown')
  const label = t('customers.detail.createdBy.label')

  if (variant === 'highlight') {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="break-words text-sm text-foreground">{value}</p>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
    </div>
  )
}
