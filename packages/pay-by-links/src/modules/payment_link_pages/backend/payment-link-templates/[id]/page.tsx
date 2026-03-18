"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { readApiResultOrThrow, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PAYMENT_LINK_PAGE_CUSTOM_FIELD_ENTITY_ID } from '@open-mercato/shared/modules/payment_link_pages/types'
import {
  templateFormSchema,
  type TemplateFormValues,
  buildTemplateFormFields,
  buildTemplateFormGroups,
  templateFormValuesToPayload,
  recordToTemplateFormValues,
} from '../../../components/templateFormConfig'
export default function EditTemplatePage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const [record, setRecord] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [extraValues, setExtraValues] = React.useState<Partial<TemplateFormValues>>({})

  React.useEffect(() => {
    async function load() {
      try {
        const response = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/payment_link_pages/templates?id=${params.id}&pageSize=1`
        )
        const item = response.items?.[0]
        if (!item) {
          setError('Template not found')
          return
        }
        setRecord(item)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load template')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [params.id])

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
        setExtraValues(prev => ({ ...prev, brandingLogoUrl: url }))
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

  if (loading) return <LoadingMessage label={t('payment_link_pages.templates.edit.title', 'Edit Template')} />
  if (error || !record) return <ErrorMessage label={error ?? 'Template not found'} />

  const initialValues: TemplateFormValues = {
    ...recordToTemplateFormValues(record),
    ...extraValues,
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<TemplateFormValues>
          key={formResetKey}
          title={t('payment_link_pages.templates.edit.title', 'Edit Template')}
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
            await updateCrud('payment_link_pages/templates', { ...payload, id: params.id })
            flash(t('payment_link_pages.templates.updated', 'Template updated'), 'success')
            router.push('/backend/payment-link-templates')
          }}
        />
      </PageBody>
    </Page>
  )
}
