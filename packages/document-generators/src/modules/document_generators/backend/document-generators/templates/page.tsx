"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TemplatesList } from './components/TemplatesList'

export default function DocumentGeneratorsTemplatesPage() {
  return (
    <Page>
      <PageBody>
        <TemplatesList />
      </PageBody>
    </Page>
  )
}
