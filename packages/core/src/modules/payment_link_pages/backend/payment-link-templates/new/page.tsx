"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  templateFormSchema,
  type TemplateFormValues,
  buildTemplateFormFields,
  buildTemplateFormGroups,
  templateFormValuesToPayload,
} from '../../../components/templateFormConfig'
import { BrandingPreview } from '../../../components/BrandingPreview'

export default function CreateTemplatePage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo(() => buildTemplateFormFields(t), [t])
  const groups = React.useMemo(() => buildTemplateFormGroups(t), [t])

  return (
    <Page>
      <PageBody>
        <BrandingPreview />
        <CrudForm<TemplateFormValues>
          title={t('payment_link_pages.templates.create.title')}
          backHref="/backend/payment-link-templates"
          fields={fields}
          groups={groups}
          schema={templateFormSchema}
          submitLabel={t('payment_link_pages.templates.form.submit')}
          cancelHref="/backend/payment-link-templates"
          onSubmit={async (values) => {
            const payload = templateFormValuesToPayload(values)
            const { result } = await createCrud<{ id?: string }>(
              'payment_link_pages/templates',
              payload,
            )
            if (result?.id) {
              flash(t('payment_link_pages.templates.created'), 'success')
              router.push(`/backend/payment-link-templates/${result.id}`)
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
