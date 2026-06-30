import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FindingsTable } from '../../../components/FindingsTable'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.finding.view'],
  breadcrumb: [
    { label: 'Data Quality', labelKey: 'data_quality.nav.title', href: '/backend/data-quality' },
    { label: 'Findings', labelKey: 'data_quality.nav.findings' },
  ],
}

export default function DataQualityFindingsPage() {
  return (
    <Page>
      <PageBody>
        <FindingsTable />
      </PageBody>
    </Page>
  )
}
