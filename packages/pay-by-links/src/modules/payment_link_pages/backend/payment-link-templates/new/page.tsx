"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'
import {
  templateFormSchema,
  type TemplateFormValues,
  buildTemplateFormFields,
  buildTemplateFormGroups,
  templateFormValuesToPayload,
} from '../../../components/templateFormConfig'
export default function CreateTemplatePage() {
  const t = useT()
  const router = useRouter()
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [initialValues, setInitialValues] = React.useState<Partial<TemplateFormValues>>({})

  const handleLogoFileSelect = React.useCallback(async (file: File) => {
    const fd = new FormData()
    fd.set('file', file)
    fd.set('entityId', 'payment_link_pages:branding')
    fd.set('recordId', 'logo-upload')
    try {
      const call = await apiCallOrThrow<{ item?: { url?: string } }>('/api/attachments', {
        method: 'POST',
        body: fd,
      })
      const url = call.result?.item?.url
      if (url) {
        setInitialValues(prev => ({ ...prev, brandingLogoUrl: url }))
        setFormResetKey(k => k + 1)
        flash(t('payment_link_pages.create.branding.logoUploaded', 'Logo uploaded'), 'success')
      }
    } catch {
      flash(t('payment_link_pages.create.branding.logoUploadError', 'Failed to upload logo'), 'error')
    }
  }, [t])

  const fields = React.useMemo(
    () => buildTemplateFormFields(t, { onLogoFileSelect: handleLogoFileSelect }),
    [t, handleLogoFileSelect],
  )

  const groups = React.useMemo(() => buildTemplateFormGroups(t), [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<TemplateFormValues>
          key={formResetKey}
          title={t('payment_link_pages.templates.create.title', 'Create Template')}
          backHref="/backend/payment-link-templates"
          cancelHref="/backend/payment-link-templates"
          fields={fields}
          groups={groups}
          twoColumn
          schema={templateFormSchema}
          initialValues={initialValues}
          entityIds={[PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID]}
          customFieldsetBindings={{ [PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID]: { valueKey: 'customFieldsetCode' } }}
          submitLabel={t('payment_link_pages.templates.form.submit', 'Save Template')}
          onSubmit={async (values) => {
            const payload = templateFormValuesToPayload(values)
            const customFields = collectCustomFieldValues(values as Record<string, unknown>)
            if (Object.keys(customFields).length > 0) payload.customFields = customFields
            const { result } = await createCrud<{ id?: string }>(
              'payment_link_pages/templates',
              payload,
            )
            if (result?.id) {
              flash(t('payment_link_pages.templates.created', 'Template created'), 'success')
              router.push(`/backend/payment-link-templates/${result.id}`)
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
