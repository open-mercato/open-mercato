import { z } from 'zod'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import {
  sharedBrandingSchema,
  sharedContentSchema,
  sharedCaptureSchema,
  sharedMetadataSchema,
  buildBrandingFields,
  buildContentFields,
  buildCaptureFields,
  buildMetadataFields,
  buildBrandingGroup,
  buildContentGroup,
  buildCaptureGroup,
  buildMetadataGroup,
  type SharedFieldBuilderOptions,
} from './sharedFormFields'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const templateFormSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
  isDefault: z.boolean().optional().default(false),

  // Shared fields
  ...sharedBrandingSchema,
  ...sharedContentSchema,
  ...sharedCaptureSchema,
  ...sharedMetadataSchema,

  // Template-only fields
  customFieldsetCode: z.string().max(100).optional().nullable(),
  customFieldsJson: z.string().optional().nullable(),
})

export type TemplateFormValues = z.infer<typeof templateFormSchema>

// ---------------------------------------------------------------------------
// Field builder
// ---------------------------------------------------------------------------

export function buildTemplateFormFields(
  t: (key: string, fallback?: string) => string,
  options: SharedFieldBuilderOptions,
): CrudField[] {
  return [
    // Template-only fields
    { id: 'name', label: t('payment_link_pages.templates.form.name', 'Name'), type: 'text', required: true, placeholder: t('payment_link_pages.templates.form.name.placeholder', 'e.g. Standard Invoice') },
    { id: 'description', label: t('payment_link_pages.templates.form.description', 'Description'), type: 'textarea', placeholder: t('payment_link_pages.templates.form.description.placeholder', 'Template description') },
    { id: 'isDefault', label: t('payment_link_pages.templates.form.isDefault', 'Default template'), type: 'checkbox', description: t('payment_link_pages.templates.form.isDefault.description', 'Use this template by default for new payment links') },

    // Shared fields
    ...buildBrandingFields(t, options),
    ...buildContentFields(t),
    ...buildCaptureFields(t),

    // Shared metadata
    ...buildMetadataFields(t),
  ]
}

// ---------------------------------------------------------------------------
// Group builder
// ---------------------------------------------------------------------------

export function buildTemplateFormGroups(t: (key: string, fallback?: string) => string): CrudFormGroup[] {
  return [
    // Column 1 (left)
    { id: 'general', column: 1, title: t('payment_link_pages.templates.form.group.general', 'General'), fields: ['name', 'description', 'isDefault'] },
    { ...buildBrandingGroup(t), column: 1 },
    { ...buildContentGroup(t), column: 1 },
    { ...buildCaptureGroup(t), column: 1 },
    { ...buildMetadataGroup(t), column: 1 },
    // Column 2 (right) — custom fields
    {
      id: 'custom-fields',
      column: 2,
      title: t('payment_link_pages.templates.form.group.customFields', 'Custom fields'),
      kind: 'customFields' as const,
    },
  ]
}

// ---------------------------------------------------------------------------
// Transform: form values -> template API payload
// ---------------------------------------------------------------------------

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
      customerHandlingMode: values.customerCaptureHandlingMode ?? 'no_customer',
      companyRequired: values.customerCaptureCompanyRequired ?? false,
      termsRequired: values.customerCaptureTermsRequired ?? false,
      termsMarkdown: values.customerCaptureTermsMarkdown || null,
      fields: {
        firstName: { visible: values.captureFirstNameVisible ?? true, required: values.captureFirstNameRequired ?? true },
        lastName: { visible: values.captureLastNameVisible ?? true, required: values.captureLastNameRequired ?? true },
        phone: { visible: values.capturePhoneVisible ?? true, required: values.capturePhoneRequired ?? false },
        companyName: { visible: values.captureCompanyVisible ?? false, required: values.captureCompanyRequired ?? false },
        address: {
          visible: values.captureAddressVisible ?? false,
          required: values.captureAddressRequired ?? false,
          format: values.captureAddressFormat ?? 'line_first',
        },
      },
    },
    customFieldsetCode: values.customFieldsetCode || null,
    customFields,
    metadata,
  }
}

// ---------------------------------------------------------------------------
// Transform: API record -> form values
// ---------------------------------------------------------------------------

export function recordToTemplateFormValues(record: Record<string, unknown>): TemplateFormValues {
  const branding = (record.branding ?? {}) as Record<string, unknown>
  const capture = (record.customer_capture ?? record.customerCapture ?? {}) as Record<string, unknown>
  const fields = (capture.fields ?? {}) as Record<string, Record<string, unknown>>
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
    customerCaptureHandlingMode: typeof capture.customerHandlingMode === 'string' && (capture.customerHandlingMode === 'no_customer' || capture.customerHandlingMode === 'create_new') ? capture.customerHandlingMode : 'no_customer',
    customerCaptureCompanyRequired: capture.companyRequired === true,
    captureFirstNameVisible: fields.firstName?.visible !== false,
    captureFirstNameRequired: fields.firstName?.required === true,
    captureLastNameVisible: fields.lastName?.visible !== false,
    captureLastNameRequired: fields.lastName?.required === true,
    capturePhoneVisible: fields.phone?.visible !== false,
    capturePhoneRequired: fields.phone?.required === true,
    captureCompanyVisible: fields.companyName?.visible === true,
    captureCompanyRequired: fields.companyName?.required === true,
    captureAddressVisible: fields.address?.visible === true,
    captureAddressRequired: fields.address?.required === true,
    captureAddressFormat: typeof fields.address?.format === 'string' ? fields.address.format as 'line_first' | 'street_first' : 'line_first',
    customerCaptureTermsRequired: capture.termsRequired === true,
    customerCaptureTermsMarkdown: capture.termsMarkdown != null ? String(capture.termsMarkdown) : null,
    customFieldsetCode: record.custom_fieldset_code != null || record.customFieldsetCode != null ? String(record.custom_fieldset_code ?? record.customFieldsetCode ?? '') : null,
    customFieldsJson: customFields != null ? JSON.stringify(customFields, null, 2) : null,
    metadataJson: metadata != null ? JSON.stringify(metadata, null, 2) : null,
  }
}
