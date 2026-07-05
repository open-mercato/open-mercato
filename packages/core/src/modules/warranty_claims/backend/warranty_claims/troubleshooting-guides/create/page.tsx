"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  buildTroubleshootingGuidePayload,
  useTroubleshootingGuideFormConfig,
  type TroubleshootingGuideFormValues,
} from '../troubleshootingGuideForm'

export default function CreateWarrantyTroubleshootingGuidePage() {
  const t = useT()
  const router = useRouter()
  const { fields, groups } = useTroubleshootingGuideFormConfig(t)

  const initialValues = React.useMemo<Partial<TroubleshootingGuideFormValues>>(() => ({
    claimType: 'any',
    reasonCode: '',
    stepsJson: '',
    isActive: true,
  }), [])

  return (
    <Page>
      <PageBody>
        <CrudForm<TroubleshootingGuideFormValues>
          title={t('warranty_claims.troubleshootingGuides.create.title', 'New troubleshooting guide')}
          backHref="/backend/warranty_claims/troubleshooting-guides"
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('warranty_claims.troubleshootingGuides.form.submit.create', 'Create guide')}
          cancelHref="/backend/warranty_claims/troubleshooting-guides"
          entityId="warranty_claims:warranty_troubleshooting_guide"
          onSubmit={async (values) => {
            const call = await createCrud<{ id?: string | null }>(
              'warranty_claims/troubleshooting-guides',
              buildTroubleshootingGuidePayload(values, t),
              {
                errorMessage: t('warranty_claims.troubleshootingGuides.create.error.save', 'Failed to create troubleshooting guide.'),
              },
            )
            flash(t('warranty_claims.troubleshootingGuides.create.success', 'Troubleshooting guide created.'), 'success')
            const id = call.result?.id
            router.push(id ? `/backend/warranty_claims/troubleshooting-guides/${id}/edit` : '/backend/warranty_claims/troubleshooting-guides')
          }}
        />
      </PageBody>
    </Page>
  )
}
