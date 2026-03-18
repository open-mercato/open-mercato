import * as React from 'react'
import { z } from 'zod'
import type {
  CrudCustomFieldRenderProps,
  CrudField,
  CrudFieldOption,
  CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { templateFormValuesToPayload } from './templateFormConfig'
import {
  sharedBrandingSchema,
  sharedContentSchema,
  sharedCaptureSchema,
  sharedMetadataSchema,
  renderSelectField,
  buildBrandingFields,
  buildContentFields,
  buildCaptureFields,
  buildMetadataFields,
  buildBrandingGroup,
  buildContentGroup,
  buildCaptureGroup,
  buildMetadataGroup,
} from './sharedFormFields'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderItem = {
  id: string
  title: string
  description?: string | null
  providerKey: string
  supportsPaymentLinks: boolean
  transactionCreateFieldSpotId?: string | null
}

export type TemplateOption = { id: string; name: string }

export type BuildPaymentLinkFormFieldsOptions = {
  providers: ProviderItem[]
  currencies: CrudFieldOption[]
  templates: TemplateOption[]
  loadingProviders: boolean
  loadingCurrencies: boolean
  loadingTemplates: boolean
  onProviderChange: (key: string) => void
  onTemplateSelect: (templateId: string | null) => void
  onLogoFileSelect: (file: File) => void
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const paymentLinkCreateSchema = z
  .object({
    // Payment fields
    providerKey: z.string().min(1),
    amount: z.union([z.number().positive(), z.literal('')]),
    currencyCode: z.string().length(3),
    description: z.string().max(500).optional().default(''),
    captureMethod: z.enum(['automatic', 'manual']).default('automatic'),

    // Template selection
    templateId: z.string().uuid().optional().nullable(),

    // Link settings
    linkMode: z.enum(['single', 'multi']).default('single'),
    maxUses: z.coerce.number().int().positive().optional().nullable(),
    password: z.string().min(4).max(128).optional().nullable().or(z.literal('')),
    customLinkPath: z.string().min(3).max(80).optional().nullable().or(z.literal('')),

    // Shared fields
    ...sharedBrandingSchema,
    ...sharedContentSchema,
    ...sharedCaptureSchema,
    ...sharedMetadataSchema,

    // Custom fields
    customFieldsetCode: z.string().max(100).optional().nullable(),

    // Save as template
    saveAsTemplate: z.boolean().optional().default(false),
    templateName: z.string().max(200).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (!data.templateId && !data.defaultTitle?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a title for the payment link',
        path: ['defaultTitle'],
      })
    }
    if (data.linkMode === 'single' && data.maxUses != null && data.maxUses > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Single-use links cannot have more than 1 use',
        path: ['maxUses'],
      })
    }
    if (data.saveAsTemplate && !data.templateName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Template name is required when saving as template',
        path: ['templateName'],
      })
    }
    if (
      data.customerCaptureEnabled &&
      data.customerCaptureTermsRequired &&
      !data.customerCaptureTermsMarkdown?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Terms content is required when terms are enabled',
        path: ['customerCaptureTermsMarkdown'],
      })
    }
  })

export type PaymentLinkCreateFormValues = z.infer<typeof paymentLinkCreateSchema>

// ---------------------------------------------------------------------------
// Field builder
// ---------------------------------------------------------------------------

export function buildPaymentLinkFormFields(
  t: (key: string, fallback?: string) => string,
  options: BuildPaymentLinkFormFieldsOptions,
): CrudField[] {
  const templateOptions = options.templates.map((tpl) => ({
    value: tpl.id,
    label: tpl.name,
  }))

  const providerOptions = options.providers.map((provider) => ({
    value: provider.providerKey,
    label: provider.title || provider.providerKey,
  }))

  return [
    // Template
    {
      id: 'templateId',
      label: t('payment_link_pages.create.templateId', 'Template'),
      type: 'custom' as const,
      component: (props: CrudCustomFieldRenderProps) =>
        renderSelectField(
          props,
          templateOptions,
          {
            placeholder: t('payment_link_pages.create.templateId.placeholder', 'None (start from scratch)'),
            disabled: options.loadingTemplates,
            onChange: (value: string) => options.onTemplateSelect(value || null),
          },
        ),
    },

    // Payment fields
    {
      id: 'providerKey',
      label: t('payment_link_pages.create.providerKey', 'Payment provider'),
      type: 'custom' as const,
      required: true,
      component: (props: CrudCustomFieldRenderProps) =>
        renderSelectField(
          props,
          providerOptions,
          {
            placeholder: t('payment_link_pages.create.providerKey.placeholder', 'Select provider'),
            disabled: options.loadingProviders,
            onChange: (value: string) => options.onProviderChange(value),
          },
        ),
    },
    {
      id: 'currencyCode',
      label: t('payment_link_pages.create.currencyCode', 'Currency'),
      type: 'custom' as const,
      required: true,
      component: (props: CrudCustomFieldRenderProps) =>
        renderSelectField(
          props,
          options.currencies,
          {
            placeholder: t('payment_link_pages.create.currencyCode.placeholder', 'Select currency'),
            disabled: options.loadingCurrencies,
          },
        ),
    },
    {
      id: 'amount',
      label: t('payment_link_pages.create.amount', 'Amount'),
      type: 'number',
      required: true,
      layout: 'half',
      placeholder: '0.00',
    },
    {
      id: 'description',
      label: t('payment_link_pages.create.description', 'Description'),
      type: 'text',
      layout: 'half',
      placeholder: t('payment_link_pages.create.description.placeholder', 'Payment description'),
    },

    // Link settings
    {
      id: 'linkMode',
      label: t('payment_link_pages.create.linkMode', 'Link mode'),
      type: 'select',
      options: [
        { label: t('payment_link_pages.create.linkMode.single', 'Single use (1:1 transaction)'), value: 'single' },
        { label: t('payment_link_pages.create.linkMode.multi', 'Multi-use (creates transactions per use)'), value: 'multi' },
      ],
    },
    {
      id: 'maxUses',
      label: t('payment_link_pages.create.maxUses', 'Maximum uses'),
      type: 'custom' as const,
      description: t('payment_link_pages.create.maxUses.description', 'Only applies to multi-use links. Leave empty for unlimited.'),
      component: (props: CrudCustomFieldRenderProps) => {
        const isSingle = props.values?.linkMode === 'single'
        if (isSingle && props.value !== 1) props.setValue(1)
        return React.createElement('input', {
          type: 'number',
          className: 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50',
          value: isSingle ? 1 : (props.value ?? ''),
          placeholder: t('payment_link_pages.create.maxUses.placeholder', 'Unlimited'),
          disabled: props.disabled || isSingle,
          min: 1,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const raw = event.target.value
            props.setValue(raw === '' ? null : Number(raw))
          },
        })
      },
    },
    {
      id: 'password',
      label: t('payment_link_pages.create.password', 'Password (optional)'),
      type: 'password',
      layout: 'half',
      placeholder: t('payment_link_pages.create.password.placeholder', 'Leave empty for no password'),
    },
    {
      id: 'customLinkPath',
      label: t('payment_link_pages.create.customLinkPath', 'Custom link path'),
      type: 'text',
      layout: 'half',
      placeholder: 'invoice-inv-10024',
    },

    // Shared fields
    ...buildBrandingFields(t, { onLogoFileSelect: options.onLogoFileSelect }),
    ...buildContentFields(t),
    ...buildCaptureFields(t),
    ...buildMetadataFields(t),

    // Save as template
    {
      id: 'saveAsTemplate',
      label: t('payment_link_pages.create.saveAsTemplate', 'Save form as a reusable template'),
      type: 'checkbox',
    },
    {
      id: 'templateName',
      label: t('payment_link_pages.create.templateName', 'Template name'),
      type: 'text',
      placeholder: t('payment_link_pages.create.templateName.placeholder', 'e.g. Standard Invoice'),
    },
  ]
}

// ---------------------------------------------------------------------------
// Group builder
// ---------------------------------------------------------------------------

export function buildPaymentLinkFormGroups(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup[] {
  return [
    // Column 1 (left)
    {
      id: 'template',
      column: 1,
      fields: ['templateId'],
    },
    {
      id: 'payment',
      column: 1,
      title: t('payment_link_pages.create.group.payment', 'Payment'),
      fields: ['providerKey', 'currencyCode', 'amount', 'description'],
    },
    { ...buildContentGroup(t), column: 1 },
    {
      id: 'linkSettings',
      column: 1,
      title: t('payment_link_pages.create.group.linkSettings', 'Link Settings'),
      fields: ['linkMode', 'maxUses', 'password', 'customLinkPath'],
    },
    { ...buildBrandingGroup(t), column: 1 },
    { ...buildCaptureGroup(t), column: 1 },
    { ...buildMetadataGroup(t), column: 1 },
    {
      id: 'saveTemplate',
      column: 1,
      title: t('payment_link_pages.create.group.saveTemplate', 'Save as Template'),
      fields: ['saveAsTemplate', 'templateName'],
    },
    // Column 2 (right) — custom fields (provider fields group is injected in the page)
    {
      id: 'custom-fields',
      column: 2,
      title: t('payment_link_pages.create.group.customFields', 'Custom fields'),
      kind: 'customFields' as const,
    },
  ]
}

// ---------------------------------------------------------------------------
// Transform: form values -> session API payload
// ---------------------------------------------------------------------------

function parseJsonSafe(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function paymentLinkFormToSessionPayload(values: PaymentLinkCreateFormValues) {
  return {
    providerKey: values.providerKey,
    amount: typeof values.amount === 'number' ? values.amount : Number(values.amount),
    currencyCode: values.currencyCode.trim().toUpperCase(),
    description: values.description?.trim() || undefined,
    paymentLink: {
      enabled: true,
      linkMode: values.linkMode,
      maxUses:
        values.linkMode === 'multi' && values.maxUses ? values.maxUses : undefined,
      templateId: values.templateId || undefined,
      title: values.defaultTitle?.trim() || undefined,
      description: values.defaultDescription?.trim() || undefined,
      password: values.password?.trim() || undefined,
      token: values.customLinkPath?.trim() || undefined,
      metadata: parseJsonSafe(values.metadataJson),
      customerCapture: {
        enabled: values.customerCaptureEnabled ?? false,
        companyRequired: values.customerCaptureCompanyRequired ?? false,
        termsRequired: values.customerCaptureTermsRequired ?? false,
        termsMarkdown: values.customerCaptureTermsMarkdown || undefined,
        customerHandlingMode: values.customerCaptureHandlingMode ?? 'no_customer',
        fields: {
          firstName: {
            visible: values.captureFirstNameVisible ?? true,
            required: values.captureFirstNameRequired ?? true,
          },
          lastName: {
            visible: values.captureLastNameVisible ?? true,
            required: values.captureLastNameRequired ?? true,
          },
          phone: {
            visible: values.capturePhoneVisible ?? true,
            required: values.capturePhoneRequired ?? false,
          },
          companyName: {
            visible: values.captureCompanyVisible ?? false,
            required: values.captureCompanyRequired ?? false,
          },
          address: {
            visible: values.captureAddressVisible ?? false,
            required: values.captureAddressRequired ?? false,
            format: values.captureAddressFormat ?? 'line_first',
          },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Transform: form values -> template API payload (for "save as template")
// ---------------------------------------------------------------------------

export function paymentLinkFormToTemplatePayload(values: PaymentLinkCreateFormValues) {
  return templateFormValuesToPayload({
    ...values,
    name: values.templateName ?? 'Untitled Template',
    isDefault: false,
  })
}
