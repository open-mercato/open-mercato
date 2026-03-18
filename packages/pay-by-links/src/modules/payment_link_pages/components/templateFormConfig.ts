import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

export const templateFormSchema = z.object({
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
  captureFirstNameVisible: z.boolean().optional().default(true),
  captureFirstNameRequired: z.boolean().optional().default(true),
  captureLastNameVisible: z.boolean().optional().default(true),
  captureLastNameRequired: z.boolean().optional().default(true),
  capturePhoneVisible: z.boolean().optional().default(true),
  capturePhoneRequired: z.boolean().optional().default(false),
  captureCompanyVisible: z.boolean().optional().default(false),
  captureCompanyRequired: z.boolean().optional().default(false),
  customerCaptureTermsRequired: z.boolean().optional().default(false),
  customerCaptureTermsMarkdown: z.string().max(20000).optional().nullable(),
  customFieldsetCode: z.string().max(100).optional().nullable(),
  customFieldsJson: z.string().optional().nullable(),
  metadataJson: z.string().optional().nullable(),
})

export type TemplateFormValues = z.infer<typeof templateFormSchema>

export function buildTemplateFormFields(t: (key: string, fallback?: string) => string): CrudField[] {
  return [
    { id: 'name', label: t('payment_link_pages.templates.form.name'), type: 'text', required: true, placeholder: t('payment_link_pages.templates.form.name.placeholder') },
    { id: 'description', label: t('payment_link_pages.templates.form.description'), type: 'textarea', placeholder: t('payment_link_pages.templates.form.description.placeholder') },
    { id: 'isDefault', label: t('payment_link_pages.templates.form.isDefault'), type: 'checkbox', description: t('payment_link_pages.templates.form.isDefault.description') },

    { id: 'brandingLogoUrl', label: t('payment_link_pages.templates.form.branding.logoUrl'), type: 'text', placeholder: t('payment_link_pages.templates.form.branding.logoUrl.placeholder') },
    { id: 'brandingBrandName', label: t('payment_link_pages.templates.form.branding.brandName'), type: 'text', placeholder: t('payment_link_pages.templates.form.branding.brandName.placeholder') },
    { id: 'brandingSecuritySubtitle', label: t('payment_link_pages.templates.form.branding.securitySubtitle'), type: 'text', placeholder: t('payment_link_pages.templates.form.branding.securitySubtitle.placeholder') },
    { id: 'brandingAccentColor', label: t('payment_link_pages.templates.form.branding.accentColor'), type: 'text', placeholder: '#1a73e8' },
    { id: 'brandingCustomCss', label: t('payment_link_pages.templates.form.branding.customCss'), type: 'textarea', placeholder: t('payment_link_pages.templates.form.branding.customCss.placeholder') },

    { id: 'defaultTitle', label: t('payment_link_pages.templates.form.defaultTitle'), type: 'text', placeholder: t('payment_link_pages.templates.form.defaultTitle.placeholder') },
    { id: 'defaultDescription', label: t('payment_link_pages.templates.form.defaultDescription'), type: 'textarea', placeholder: t('payment_link_pages.templates.form.defaultDescription.placeholder') },

    { id: 'customerCaptureEnabled', label: t('payment_link_pages.templates.form.customerCapture.enabled'), type: 'checkbox', description: t('payment_link_pages.templates.form.customerCapture.enabled.description') },
    { id: 'customerCaptureCompanyRequired', label: t('payment_link_pages.templates.form.customerCapture.companyRequired'), type: 'checkbox' },

    { id: 'captureFirstNameVisible', label: t('payment_link_pages.templates.form.capture.firstName.visible'), type: 'checkbox', description: t('payment_link_pages.templates.form.capture.firstName.hint') },
    { id: 'captureFirstNameRequired', label: t('payment_link_pages.templates.form.capture.firstName.required'), type: 'checkbox' },
    { id: 'captureLastNameVisible', label: t('payment_link_pages.templates.form.capture.lastName.visible'), type: 'checkbox', description: t('payment_link_pages.templates.form.capture.lastName.hint') },
    { id: 'captureLastNameRequired', label: t('payment_link_pages.templates.form.capture.lastName.required'), type: 'checkbox' },
    { id: 'capturePhoneVisible', label: t('payment_link_pages.templates.form.capture.phone.visible'), type: 'checkbox', description: t('payment_link_pages.templates.form.capture.phone.hint') },
    { id: 'capturePhoneRequired', label: t('payment_link_pages.templates.form.capture.phone.required'), type: 'checkbox' },
    { id: 'captureCompanyVisible', label: t('payment_link_pages.templates.form.capture.company.visible'), type: 'checkbox', description: t('payment_link_pages.templates.form.capture.company.hint') },
    { id: 'captureCompanyRequired', label: t('payment_link_pages.templates.form.capture.company.required'), type: 'checkbox' },

    { id: 'customerCaptureTermsRequired', label: t('payment_link_pages.templates.form.customerCapture.termsRequired'), type: 'checkbox' },
    { id: 'customerCaptureTermsMarkdown', label: t('payment_link_pages.templates.form.customerCapture.termsMarkdown'), type: 'richtext', editor: 'uiw', placeholder: t('payment_link_pages.templates.form.customerCapture.termsMarkdown.placeholder') },

    { id: 'customFieldsetCode', label: t('payment_link_pages.templates.form.customFieldsetCode'), type: 'text', placeholder: t('payment_link_pages.templates.form.customFieldsetCode.placeholder') },
    { id: 'customFieldsJson', label: t('payment_link_pages.templates.form.customFields'), type: 'textarea', placeholder: '{ "key": "value" }' },

    { id: 'metadataJson', label: t('payment_link_pages.templates.form.metadata'), type: 'textarea', description: t('payment_link_pages.templates.form.metadata.description'), placeholder: '{ "key": "value" }' },
  ]
}

export function buildTemplateFormGroups(t: (key: string, fallback?: string) => string): CrudFormGroup[] {
  return [
    { id: 'general', title: t('payment_link_pages.templates.form.name', 'General'), fields: ['name', 'description', 'isDefault'] },
    { id: 'branding', title: t('payment_link_pages.templates.form.branding'), fields: ['brandingLogoUrl', 'brandingBrandName', 'brandingSecuritySubtitle', 'brandingAccentColor', 'brandingCustomCss'] },
    { id: 'content', title: t('payment_link_pages.templates.form.defaultContent'), fields: ['defaultTitle', 'defaultDescription'] },
    { id: 'capture', title: t('payment_link_pages.templates.form.customerCapture'), fields: ['customerCaptureEnabled', 'customerCaptureCompanyRequired', 'captureFirstNameVisible', 'captureFirstNameRequired', 'captureLastNameVisible', 'captureLastNameRequired', 'capturePhoneVisible', 'capturePhoneRequired', 'captureCompanyVisible', 'captureCompanyRequired', 'customerCaptureTermsRequired', 'customerCaptureTermsMarkdown'] },
    { id: 'fields', title: t('payment_link_pages.templates.form.customFields'), fields: ['customFieldsetCode', 'customFieldsJson'] },
    { id: 'metadata', title: t('payment_link_pages.templates.form.metadata'), fields: ['metadataJson'] },
  ]
}

export function templateFormValuesToPayload(values: TemplateFormValues) {
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
      fields: {
        firstName: { visible: values.captureFirstNameVisible ?? true, required: values.captureFirstNameRequired ?? true },
        lastName: { visible: values.captureLastNameVisible ?? true, required: values.captureLastNameRequired ?? true },
        phone: { visible: values.capturePhoneVisible ?? true, required: values.capturePhoneRequired ?? false },
        companyName: { visible: values.captureCompanyVisible ?? false, required: values.captureCompanyRequired ?? false },
      },
    },
    customFieldsetCode: values.customFieldsetCode || null,
    customFields,
    metadata,
  }
}

export function recordToTemplateFormValues(record: Record<string, unknown>): TemplateFormValues {
  const branding = (record.branding ?? {}) as Record<string, unknown>
  const capture = (record.customer_capture ?? record.customerCapture ?? {}) as Record<string, unknown>
  const fields = capture.fields ?? {}
  const customFields = record.custom_fields ?? record.customFields
  const metadata = record.metadata

  return {
    name: String(record.name ?? ''),
    description: record.description != null ? String(record.description) : null,
    isDefault: record.is_default === true || record.isDefault === true,
    brandingLogoUrl: branding.logoUrl != null ? String(branding.logoUrl) : null,
    brandingBrandName: branding.brandName != null ? String(branding.brandName) : null,
    brandingSecuritySubtitle: branding.securitySubtitle != null ? String(branding.securitySubtitle) : null,
    brandingAccentColor: branding.accentColor != null ? String(branding.accentColor) : null,
    brandingCustomCss: branding.customCss != null ? String(branding.customCss) : null,
    defaultTitle: record.default_title != null || record.defaultTitle != null ? String(record.default_title ?? record.defaultTitle ?? '') : null,
    defaultDescription: record.default_description != null || record.defaultDescription != null ? String(record.default_description ?? record.defaultDescription ?? '') : null,
    customerCaptureEnabled: capture.enabled === true,
    customerCaptureCompanyRequired: capture.companyRequired === true,
    captureFirstNameVisible: (fields as Record<string, unknown>)?.firstName != null ? ((fields as Record<string, unknown>).firstName as Record<string, unknown>)?.visible !== false : true,
    captureFirstNameRequired: (fields as Record<string, unknown>)?.firstName != null ? ((fields as Record<string, unknown>).firstName as Record<string, unknown>)?.required === true : true,
    captureLastNameVisible: (fields as Record<string, unknown>)?.lastName != null ? ((fields as Record<string, unknown>).lastName as Record<string, unknown>)?.visible !== false : true,
    captureLastNameRequired: (fields as Record<string, unknown>)?.lastName != null ? ((fields as Record<string, unknown>).lastName as Record<string, unknown>)?.required === true : true,
    capturePhoneVisible: (fields as Record<string, unknown>)?.phone != null ? ((fields as Record<string, unknown>).phone as Record<string, unknown>)?.visible !== false : true,
    capturePhoneRequired: (fields as Record<string, unknown>)?.phone != null ? ((fields as Record<string, unknown>).phone as Record<string, unknown>)?.required === true : false,
    captureCompanyVisible: (fields as Record<string, unknown>)?.companyName != null ? ((fields as Record<string, unknown>).companyName as Record<string, unknown>)?.visible !== false : false,
    captureCompanyRequired: (fields as Record<string, unknown>)?.companyName != null ? ((fields as Record<string, unknown>).companyName as Record<string, unknown>)?.required === true : false,
    customerCaptureTermsRequired: capture.termsRequired === true,
    customerCaptureTermsMarkdown: capture.termsMarkdown != null ? String(capture.termsMarkdown) : null,
    customFieldsetCode: record.custom_fieldset_code != null || record.customFieldsetCode != null ? String(record.custom_fieldset_code ?? record.customFieldsetCode ?? '') : null,
    customFieldsJson: customFields != null ? JSON.stringify(customFields, null, 2) : null,
    metadataJson: metadata != null ? JSON.stringify(metadata, null, 2) : null,
  }
}
