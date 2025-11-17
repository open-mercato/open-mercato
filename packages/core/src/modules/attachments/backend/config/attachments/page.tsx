import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AttachmentPartitionSettings } from '../../../components/AttachmentPartitionSettings'

export default function AttachmentsConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <AttachmentPartitionSettings />
      </PageBody>
    </Page>
  )
}
