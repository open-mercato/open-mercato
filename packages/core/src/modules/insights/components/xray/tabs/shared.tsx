"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import type { XrayFilterState } from '../../../lib/client/xray/api'
import type { XrayResourceState } from '../../../lib/client/xray/hooks'
import type { XrayWindowState } from '../../../lib/client/xray/window'
import { XrayErrorNotice } from '../XrayErrorNotice'

export type XrayTabProps = {
  processKey: string
  window: XrayWindowState
  filters: XrayFilterState
  onClearActorFilters: () => void
}

export type XrayTabResourceProps<TBody> = {
  resource: XrayResourceState<TBody>
  onClearActorFilters?: () => void
  loadingLabelKey?: string
  children: (data: TBody) => React.ReactNode
}

/** The loading → error → ready flow of one tab's analytics read. */
export function XrayTabResource<TBody>({ resource, onClearActorFilters, loadingLabelKey = 'insights.xray.ui.loading', children }: XrayTabResourceProps<TBody>) {
  const t = useT()
  if (resource.loading && !resource.data) return <LoadingMessage label={t(loadingLabelKey)} />
  if (resource.error) {
    return <XrayErrorNotice error={resource.error} onClearActorFilters={onClearActorFilters} onRetry={resource.reload} />
  }
  if (!resource.data) return null
  return (
    <div className="space-y-4" aria-busy={resource.loading}>
      {children(resource.data)}
    </div>
  )
}
