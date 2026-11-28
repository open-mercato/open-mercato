"use client"

import * as React from 'react'
import { getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
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
  scopeVersion: number
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
  const scopeVersion = useOrganizationScopeVersion()
  const creatorId = createdByUserId?.trim() || null
  const reusableOwnerName = creatorId && creatorId === ownerUserId?.trim()
    ? normalizeName(ownerName)
    : null
  const [lookup, setLookup] = React.useState<LookupState | null>(null)

  React.useEffect(() => {
    if (!creatorId || reusableOwnerName) return

    const controller = new AbortController()
    const isCurrentScope = () => !controller.signal.aborted && getCurrentOrganizationScopeVersion() === scopeVersion
    setLookup({ creatorId, scopeVersion, pending: true, name: null })
    void resolveAuthorUserNames([creatorId], controller.signal)
      .then(({ names }) => {
        if (!isCurrentScope()) return
        setLookup({ creatorId, scopeVersion, pending: false, name: normalizeName(names.get(creatorId)) })
      })
      .catch(() => {
        if (!isCurrentScope()) return
        setLookup({ creatorId, scopeVersion, pending: false, name: null })
      })

    return () => controller.abort()
  }, [creatorId, reusableOwnerName, scopeVersion])

  const value = !creatorId
    ? t('customers.detail.createdBy.unknown')
    : reusableOwnerName
      ? reusableOwnerName
      : lookup?.creatorId !== creatorId || lookup.scopeVersion !== scopeVersion || lookup.pending
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
