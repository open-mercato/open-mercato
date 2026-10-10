"use client"

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { XRAY_PAGE_BASE } from '../../lib/client/xray/api'
import { useXrayPermissions } from '../../lib/client/xray/hooks'
import { XraySuggestionsSection } from './XraySuggestionsSection'

/** Automation suggestions of every process the viewer may analyse. */
export function XraySuggestionsPageClient() {
  const t = useT()
  const permissions = useXrayPermissions()
  return (
    <div className="space-y-6" data-testid="xray-suggestions-page">
      <PageHeader
        title={t('insights.xray.ui.suggestions.title')}
        description={t('insights.xray.ui.suggestions.description')}
        actions={(
          <Button asChild variant="outline">
            <Link href={XRAY_PAGE_BASE}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('insights.xray.ui.process.backToList')}
            </Link>
          </Button>
        )}
      />
      <XraySuggestionsSection permissions={permissions} />
    </div>
  )
}
