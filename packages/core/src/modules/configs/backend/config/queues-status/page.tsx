import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/core/modules/configs/extension-points'
import QueueStatusPanel from '../../../components/QueueStatusPanel'

export default function QueueStatusPage() {
  return (
    <Page>
      <PageBody>
        <QueueStatusPanel />
        <InjectionSpot
          spotId={extensionPoints.hosts.queuesStatusDetails.spotId}
          context={{ path: '/backend/config/queues-status' }}
        />
      </PageBody>
    </Page>
  )
}
