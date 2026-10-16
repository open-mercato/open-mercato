"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { HistoryList } from '../../../components/HistoryList'

export default function DocumentGeneratorsHistoryPage() {
  return (
    <Page>
      <PageBody>
        <HistoryList />
      </PageBody>
    </Page>
  )
}
