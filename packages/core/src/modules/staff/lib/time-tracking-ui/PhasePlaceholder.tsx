"use client"

import * as React from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type PhasePlaceholderProps = {
  titleKey: string
  titleFallback: string
}

export function PhasePlaceholder({ titleKey, titleFallback }: PhasePlaceholderProps) {
  const t = useT()
  return (
    <Page>
      <PageHeader title={t(titleKey, titleFallback)} />
      <PageBody>
        <EmptyState
          title={t('staff.time_tracking.placeholder.title', 'Coming in a later phase')}
          description={t(
            'staff.time_tracking.placeholder.description',
            'This screen is part of the time tracking rollout and is not available yet.'
          )}
        />
      </PageBody>
    </Page>
  )
}

export default PhasePlaceholder
