"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
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

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    const baseGroups = buildTemplateFormGroups(t)
    const previewGroup: CrudFormGroup = {
      id: 'preview',
      title: t('payment_link_pages.templates.branding.preview', 'Preview'),
      column: 2,
      bare: true,
      component: ({ values }) => (
        <BrandingPreview
          logoUrl={typeof values.brandingLogoUrl === 'string' ? values.brandingLogoUrl : null}
          brandName={typeof values.brandingBrandName === 'string' ? values.brandingBrandName : null}
          securitySubtitle={typeof values.brandingSecuritySubtitle === 'string' ? values.brandingSecuritySubtitle : null}
          accentColor={typeof values.brandingAccentColor === 'string' ? values.brandingAccentColor : null}
        />
      ),
    }
    return [...baseGroups, previewGroup]
  }, [t])

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
          schema={templateFormSchema}
          twoColumn
          initialValues={initialValues}
          submitLabel={t('payment_link_pages.templates.form.submit', 'Save Template')}
          onSubmit={async (values) => {
            const payload = templateFormValuesToPayload(values)
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
