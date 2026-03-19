import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import SystemStatusPanel from '../../../components/SystemStatusPanel'

export default function SystemStatusPage() {
  return (
    <Page>
      <PageBody>
        <SystemStatusPanel />
        <InjectionSpot
          spotId="configs.system_status:details"
          context={{ path: '/backend/config/system-status' }}
        />
      </PageBody>
    </Page>
  )
}
