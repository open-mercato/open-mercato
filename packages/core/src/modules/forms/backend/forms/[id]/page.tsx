"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormStudio } from './FormStudio'

export default function FormStudioPage({ params }: { params?: { id?: string } }) {
  const formId = params?.id ?? ''
  if (!formId) return null
  return (
    <Page>
      <PageBody>
        <FormStudio formId={formId} />
      </PageBody>
    </Page>
  )
}
