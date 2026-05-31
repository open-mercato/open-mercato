import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SuiteForm } from '../../../../components/SuiteForm'
import { SuiteMembershipTable } from '../../../../components/SuiteMembershipTable'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.suite.manage'],
  breadcrumb: [
    { label: 'Data Quality', labelKey: 'data_quality.nav.title', href: '/backend/data-quality' },
    { label: 'Suites', labelKey: 'data_quality.nav.suites', href: '/backend/data-quality/suites' },
    { label: 'Edit', labelKey: 'data_quality.suites.edit' },
  ],
}

export default function EditSuitePage({ params }: { params: { id: string } }) {
  return (
    <Page>
      <PageBody className="space-y-6">
        <SuiteForm mode="edit" suiteId={params.id} />
        <SuiteMembershipTable suiteId={params.id} />
      </PageBody>
    </Page>
  )
}
