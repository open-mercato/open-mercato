import { notFound } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { isPlatformMapEnabled } from '../../../lib/gating'
import { PlatformMapScreen } from '../../../components/PlatformMapScreen'

export default function PlatformMapPage() {
  if (!isPlatformMapEnabled()) {
    notFound()
  }

  return (
    <Page>
      <PageBody>
        <PlatformMapScreen />
      </PageBody>
    </Page>
  )
}
