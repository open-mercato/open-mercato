"use client"

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

export type XeroCompanyLink = { externalUrl: string; linkedSince: string | null }
export type XeroCompanyBadgeContext = { companyId?: string | null }

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(locale || undefined)
}

/** "Xero · linked since {date}" with a link to the Contact in Xero; nothing without a link or on any error (App Spec US-2.2). */
export default function XeroCompanyBadgeWidget({ context }: InjectionWidgetComponentProps<XeroCompanyBadgeContext>) {
  const t = useT()
  const locale = useLocale()
  const companyId = typeof context?.companyId === 'string' && context.companyId.length > 0 ? context.companyId : null
  const [link, setLink] = React.useState<XeroCompanyLink | null>(null)

  React.useEffect(() => {
    setLink(null)
    if (!companyId) return
    let cancelled = false
    void apiCall<{ link: XeroCompanyLink | null }>(`/api/sync_xero/companies/${encodeURIComponent(companyId)}`, undefined, { fallback: null })
      .then((call) => {
        if (!cancelled && call.ok) setLink(call.result?.link ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (!link) return null
  const since = formatDate(link.linkedSince, locale)
  return (
    <div className="inline-flex items-center gap-1" data-testid="sync-xero-company-badge">
      <Badge variant="info">{since ? t('sync_xero.badge.linkedSince', { date: since }) : t('sync_xero.badge.linked')}</Badge>
      <IconButton asChild variant="ghost" size="xs" aria-label={t('sync_xero.badge.open')}>
        <a href={link.externalUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink />
        </a>
      </IconButton>
    </div>
  )
}
