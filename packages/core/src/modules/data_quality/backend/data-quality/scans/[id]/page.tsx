import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ScanRunDetailClient } from '../../../../components/ScanRunDetailClient'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.scan.view'],
  breadcrumb: [
    { label: 'Data Quality', labelKey: 'data_quality.nav.title', href: '/backend/data-quality' },
    { label: 'Scans', labelKey: 'data_quality.nav.scans', href: '/backend/data-quality/scans' },
    { label: 'Details', labelKey: 'common.details' },
  ],
}

export default function DataQualityScanDetailPage({ params }: { params: { id: string } }) {
  return (
    <Page>
      <PageBody>
        <ScanRunDetailClient scanId={params.id} />
      </PageBody>
    </Page>
  )
}
