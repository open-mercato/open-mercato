"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import { useExplainResourceDescriptor } from '../lib/client/useExplainDescriptors'
import { WhyExplanation } from './WhyExplanation'

export const WHY_PAGE_QUERY_KEYS = ['resourceKind', 'resourceId', 'field', 'itemId'] as const

function readParam(params: URLSearchParams | null, key: (typeof WHY_PAGE_QUERY_KEYS)[number]): string | null {
  const value = params?.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null
}

export type WhyPageClientProps = {
  missingRecordState?: React.ReactNode
}

export function WhyPageClient({ missingRecordState }: WhyPageClientProps = {}) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const resourceKind = readParam(searchParams, 'resourceKind')
  const resourceId = readParam(searchParams, 'resourceId')
  const field = readParam(searchParams, 'field')
  const itemId = readParam(searchParams, 'itemId')
  const { descriptor } = useExplainResourceDescriptor(resourceKind && resourceId ? resourceKind : null)

  const selectField = React.useCallback((next: string | null) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (next) params.set('field', next)
    else params.delete('field')
    params.delete('itemId')
    router.replace(`${pathname ?? ''}?${params.toString()}`)
  }, [pathname, router, searchParams])

  if (!resourceKind || !resourceId) {
    if (missingRecordState) return <>{missingRecordState}</>
    return (
      <TabEmptyState
        title={t('insights.why.page.missingParams.title')}
        description={t('insights.why.page.missingParams.description')}
      />
    )
  }

  return (
    <div className="space-y-4" data-testid="insights-why-page">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{t('insights.why.page.heading')}</h2>
        {descriptor ? (
          <p className="text-sm text-muted-foreground">
            {t('insights.why.drawer.descriptionFor', { resource: t(descriptor.labelKey) })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('insights.why.drawer.description')}</p>
        )}
      </div>
      <WhyExplanation
        key={`${resourceKind}:${resourceId}`}
        resourceKind={resourceKind}
        resourceId={resourceId}
        field={field}
        itemId={itemId}
        onSelectField={selectField}
      />
    </div>
  )
}

export default WhyPageClient
