"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormField, type CrudFormGroup } from '@open-mercato/ui/backend/crud'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { z } from 'zod'

const formSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
  brandingLogoUrl: z.string().url().max(2000).optional().nullable().or(z.literal('')),
  brandingBrandName: z.string().max(200).optional().nullable(),
  brandingSecuritySubtitle: z.string().max(200).optional().nullable(),
  brandingAccentColor: z.string().regex(/^#([0-9a-fA-F]{3,8})$/).optional().nullable().or(z.literal('')),
  brandingCustomCss: z.string().max(10000).optional().nullable(),
  defaultTitle: z.string().max(160).optional().nullable(),
  defaultDescription: z.string().max(500).optional().nullable(),
  customerCaptureEnabled: z.boolean().optional().default(false),
  customerCaptureCompanyRequired: z.boolean().optional().default(false),
  customerCaptureTermsRequired: z.boolean().optional().default(false),
  customerCaptureTermsMarkdown: z.string().max(20000).optional().nullable(),
  customFieldsetCode: z.string().max(100).optional().nullable(),
  customFieldsJson: z.string().optional().nullable(),
  metadataJson: z.string().optional().nullable(),
})

type FormValues = z.infer<typeof formSchema>

function buildFormFields(t: (key: string, fallback?: string) => string): CrudFormField[] {
  return [
    { id: 'name', label: t('payment_link_pages.templates.form.name'), type: 'text', required: true, placeholder: t('payment_link_pages.templates.form.name.placeholder'), group: 'general' },
    { id: 'description', label: t('payment_link_pages.templates.form.description'), type: 'multiline', placeholder: t('payment_link_pages.templates.form.description.placeholder'), group: 'general' },
    { id: 'isDefault', label: t('payment_link_pages.templates.form.isDefault'), type: 'boolean', description: t('payment_link_pages.templates.form.isDefault.description'), group: 'general' },

    { id: 'brandingLogoUrl', label: t('payment_link_pages.templates.form.branding.logoUrl'), type: 'text', placeholder: t('payment_link_pages.templates.form.branding.logoUrl.placeholder'), group: 'branding' },
    { id: 'brandingBrandName', label: t('payment_link_pages.templates.form.branding.brandName'), type: 'text', placeholder: t('payment_link_pages.templates.form.branding.brandName.placeholder'), group: 'branding' },
    { id: 'brandingSecuritySubtitle', label: t('payment_link_pages.templates.form.branding.securitySubtitle'), type: 'text', placeholder: t('payment_link_pages.templates.form.branding.securitySubtitle.placeholder'), group: 'branding' },
    { id: 'brandingAccentColor', label: t('payment_link_pages.templates.form.branding.accentColor'), type: 'text', placeholder: '#1a73e8', group: 'branding' },
    { id: 'brandingCustomCss', label: t('payment_link_pages.templates.form.branding.customCss'), type: 'multiline', placeholder: t('payment_link_pages.templates.form.branding.customCss.placeholder'), group: 'branding' },

    { id: 'defaultTitle', label: t('payment_link_pages.templates.form.defaultTitle'), type: 'text', placeholder: t('payment_link_pages.templates.form.defaultTitle.placeholder'), group: 'content' },
    { id: 'defaultDescription', label: t('payment_link_pages.templates.form.defaultDescription'), type: 'multiline', placeholder: t('payment_link_pages.templates.form.defaultDescription.placeholder'), group: 'content' },

    { id: 'customerCaptureEnabled', label: t('payment_link_pages.templates.form.customerCapture.enabled'), type: 'boolean', description: t('payment_link_pages.templates.form.customerCapture.enabled.description'), group: 'capture' },
    { id: 'customerCaptureCompanyRequired', label: t('payment_link_pages.templates.form.customerCapture.companyRequired'), type: 'boolean', group: 'capture' },
    { id: 'customerCaptureTermsRequired', label: t('payment_link_pages.templates.form.customerCapture.termsRequired'), type: 'boolean', group: 'capture' },
    { id: 'customerCaptureTermsMarkdown', label: t('payment_link_pages.templates.form.customerCapture.termsMarkdown'), type: 'multiline', placeholder: t('payment_link_pages.templates.form.customerCapture.termsMarkdown.placeholder'), group: 'capture' },

    { id: 'customFieldsetCode', label: t('payment_link_pages.templates.form.customFieldsetCode'), type: 'text', placeholder: t('payment_link_pages.templates.form.customFieldsetCode.placeholder'), group: 'fields' },
    { id: 'customFieldsJson', label: t('payment_link_pages.templates.form.customFields'), type: 'multiline', placeholder: '{ "key": "value" }', group: 'fields' },

    { id: 'metadataJson', label: t('payment_link_pages.templates.form.metadata'), type: 'multiline', description: t('payment_link_pages.templates.form.metadata.description'), placeholder: '{ "key": "value" }', group: 'metadata' },
  ]
}

function buildFormGroups(t: (key: string, fallback?: string) => string): CrudFormGroup[] {
  return [
    { id: 'general', label: t('payment_link_pages.templates.form.name', 'General') },
    { id: 'branding', label: t('payment_link_pages.templates.form.branding') },
    { id: 'content', label: t('payment_link_pages.templates.form.defaultContent') },
    { id: 'capture', label: t('payment_link_pages.templates.form.customerCapture') },
    { id: 'fields', label: t('payment_link_pages.templates.form.customFields') },
    { id: 'metadata', label: t('payment_link_pages.templates.form.metadata') },
  ]
}

function formValuesToPayload(values: FormValues) {
  let customFields: Record<string, unknown> | null = null
  let metadata: Record<string, unknown> | null = null
  try {
    if (values.customFieldsJson?.trim()) customFields = JSON.parse(values.customFieldsJson)
  } catch { /* invalid JSON, skip */ }
  try {
    if (values.metadataJson?.trim()) metadata = JSON.parse(values.metadataJson)
  } catch { /* invalid JSON, skip */ }

  return {
    name: values.name,
    description: values.description || null,
    isDefault: values.isDefault ?? false,
    branding: {
      logoUrl: values.brandingLogoUrl || null,
      brandName: values.brandingBrandName || null,
      securitySubtitle: values.brandingSecuritySubtitle || null,
      accentColor: values.brandingAccentColor || null,
      customCss: values.brandingCustomCss || null,
    },
    defaultTitle: values.defaultTitle || null,
    defaultDescription: values.defaultDescription || null,
    customerCapture: {
      enabled: values.customerCaptureEnabled ?? false,
      companyRequired: values.customerCaptureCompanyRequired ?? false,
      termsRequired: values.customerCaptureTermsRequired ?? false,
      termsMarkdown: values.customerCaptureTermsMarkdown || null,
    },
    customFieldsetCode: values.customFieldsetCode || null,
    customFields,
    metadata,
  }
}

export default function CreateTemplatePage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo(() => buildFormFields(t), [t])
  const groups = React.useMemo(() => buildFormGroups(t), [t])

  return (
    <Page>
      <PageBody>
        <CrudForm<FormValues>
          title={t('payment_link_pages.templates.create.title')}
          backHref="/backend/payment-link-templates"
          fields={fields}
          groups={groups}
          schema={formSchema}
          submitLabel={t('payment_link_pages.templates.form.submit')}
          cancelHref="/backend/payment-link-templates"
          onSubmit={async (values) => {
            const payload = formValuesToPayload(values)
            const { result } = await createCrud<{ id?: string }>(
              'payment_link_pages/templates',
              payload,
            )
            if (result?.id) {
              flash('success', t('payment_link_pages.templates.created'))
              router.push(`/backend/payment-link-templates/${result.id}`)
            }
          }}
        />
      </PageBody>
    </Page>
  )
}
