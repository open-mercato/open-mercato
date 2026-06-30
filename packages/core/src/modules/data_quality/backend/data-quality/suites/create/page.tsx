import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SuiteForm } from '../../../../components/SuiteForm'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.suite.manage'],
  breadcrumb: [
    { label: 'Data Quality', labelKey: 'data_quality.nav.title', href: '/backend/data-quality' },
    { label: 'Suites', labelKey: 'data_quality.nav.suites', href: '/backend/data-quality/suites' },
    { label: 'Create', labelKey: 'data_quality.suites.create' },
  ],
}

export default function CreateSuitePage() {
  return (
    <Page>
      <PageBody>
        <SuiteForm mode="create" />
      </PageBody>
    </Page>
  )
}
