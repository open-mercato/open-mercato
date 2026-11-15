"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DistributionsPanel } from '../../../../ui/admin/forms/[id]/distributions/DistributionsPanel'

export default function FormDistributionsPage({ params }: { params?: { id?: string } }) {
  const formId = params?.id ?? ''
  return (
    <Page>
      <PageBody>
        <DistributionsPanel formId={formId} />
      </PageBody>
    </Page>
  )
}
