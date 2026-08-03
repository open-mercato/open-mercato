"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function SalesChannelsDisabledNotice() {
  const t = useT()
  return (
    <Page>
      <PageBody>
        <div className="rounded-lg border bg-muted/50 p-6 text-sm text-muted-foreground">
          {t(
            'sales.channels.disabledNotice',
            'Sales channels are disabled for this tenant. Enable the "Sales Channels" feature toggle to manage them.',
          )}
        </div>
      </PageBody>
    </Page>
  )
}
