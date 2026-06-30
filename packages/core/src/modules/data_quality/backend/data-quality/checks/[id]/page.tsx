import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CheckForm } from '../../../../components/CheckForm'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['data_quality.check.manage'],
  breadcrumb: [
    { label: 'Data Quality', labelKey: 'data_quality.nav.title', href: '/backend/data-quality' },
    { label: 'Checks', labelKey: 'data_quality.nav.checks', href: '/backend/data-quality/checks' },
    { label: 'Edit', labelKey: 'data_quality.checks.edit' },
  ],
}

export default function EditCheckPage({ params }: { params: { id: string } }) {
  return (
    <Page>
      <PageBody>
        <CheckForm mode="edit" checkId={params.id} />
      </PageBody>
    </Page>
  )
}
