"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  templateFormSchema,
  type TemplateFormValues,
  buildTemplateFormFields,
  buildTemplateFormGroups,
  templateFormValuesToPayload,
  recordToTemplateFormValues,
} from '../../../components/templateFormConfig'
import { BrandingPreview } from '../../../components/BrandingPreview'

export default function EditTemplatePage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const [record, setRecord] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

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

  const fields = React.useMemo(() => buildTemplateFormFields(t), [t])
  const groups = React.useMemo(() => buildTemplateFormGroups(t), [t])

  if (loading) return <LoadingMessage label={t('payment_link_pages.templates.edit.title')} />
  if (error || !record) return <ErrorMessage label={error ?? 'Template not found'} />

  const initialValues = recordToTemplateFormValues(record)
  const branding = (record.branding ?? {}) as Record<string, unknown>

  return (
    <Page>
      <PageBody>
        <BrandingPreview
          logoUrl={typeof branding.logoUrl === 'string' ? branding.logoUrl : null}
          brandName={typeof branding.brandName === 'string' ? branding.brandName : null}
          securitySubtitle={typeof branding.securitySubtitle === 'string' ? branding.securitySubtitle : null}
          accentColor={typeof branding.accentColor === 'string' ? branding.accentColor : null}
        />
        <CrudForm<TemplateFormValues>
          title={t('payment_link_pages.templates.edit.title')}
          backHref="/backend/payment-link-templates"
          fields={fields}
          groups={groups}
          schema={templateFormSchema}
          initialValues={initialValues}
          submitLabel={t('payment_link_pages.templates.form.submit')}
          cancelHref="/backend/payment-link-templates"
          onSubmit={async (values) => {
            const payload = templateFormValuesToPayload(values)
            await updateCrud('payment_link_pages/templates', { ...payload, id: params.id })
            flash(t('payment_link_pages.templates.updated'), 'success')
            router.push('/backend/payment-link-templates')
          }}
        />
      </PageBody>
    </Page>
  )
}
