import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { extensionPoints } from '@open-mercato/core/modules/configs/extension-points'
import SystemStatusPanel from '../../../components/SystemStatusPanel'

export default function SystemStatusPage() {
  return (
    <Page>
      <PageBody>
        <SystemStatusPanel />
        <InjectionSpot
          spotId={extensionPoints.hosts.systemStatusDetails.spotId}
          context={{ path: '/backend/config/system-status' }}
        />
      </PageBody>
    </Page>
  )
}
