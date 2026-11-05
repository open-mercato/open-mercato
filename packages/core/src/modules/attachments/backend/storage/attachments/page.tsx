"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AttachmentLibrary } from '../../../components/AttachmentLibrary'

export default function StorageAttachmentsPage() {
  return (
    <Page>
      <PageBody>
        <AttachmentLibrary />
      </PageBody>
    </Page>
  )
}

