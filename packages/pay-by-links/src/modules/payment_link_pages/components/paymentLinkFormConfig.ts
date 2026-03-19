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
  sharedAmountTypeSchema,
  renderSelectField,
  renderAmountOptionsEditor,
  buildBrandingFields,
  buildContentFields,
  buildCaptureFields,
  buildMetadataFields,
  buildAmountTypeFields,
  buildBrandingGroup,
  buildContentGroup,
  buildCaptureGroup,
  buildMetadataGroup,
  buildAmountTypeGroup,
} from './sharedFormFields'
import { readPaymentLinkStoredMetadata } from '../lib/payment-link-page-metadata'

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
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const paymentLinkCreateSchema = z
  .object({
    // Payment fields
    providerKey: z.string().min(1),
    amount: z.union([z.number().min(0), z.literal('')]).optional().default(0),
    currencyCode: z.string().length(3),
    description: z.string().max(500).optional().default(''),
    captureMethod: z.enum(['automatic', 'manual']).default('automatic'),

    // Amount type
    ...sharedAmountTypeSchema,

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
  .passthrough()
  .superRefine((data, ctx) => {
    const effectiveAmountType = data.amountType ?? 'fixed'
    if (effectiveAmountType === 'fixed' && (data.amount === '' || data.amount === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount is required for fixed amount links',
        path: ['amount'],
      })
    }
    if (effectiveAmountType === 'predefined') {
      const options = Array.isArray(data.amountOptions) ? data.amountOptions : []
      const validOptions = options.filter((opt: { amount: number; label: string }) => opt.amount > 0 && opt.label?.trim())
      if (validOptions.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least one amount option is required',
          path: ['amountOptions'],
        })
      }
    }
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
    if (effectiveAmountType === 'customer_input') {
      const min = typeof data.minAmount === 'number' ? data.minAmount : null
      const max = typeof data.maxAmount === 'number' ? data.maxAmount : null
      if (min != null && max != null && min > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Minimum amount cannot be greater than maximum amount',
          path: ['minAmount'],
        })
      }
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
      id: 'amountType',
      label: t('payment_link_pages.amountType', 'Amount type'),
      type: 'select',
      options: [
        { label: t('payment_link_pages.amountType.fixed', 'Fixed amount'), value: 'fixed' },
        { label: t('payment_link_pages.amountType.customerInput', 'Customer enters amount'), value: 'customer_input' },
        { label: t('payment_link_pages.amountType.predefined', 'Customer selects from list'), value: 'predefined' },
      ],
    },
    {
      id: 'amount',
      label: t('payment_link_pages.create.amount', 'Amount'),
      type: 'custom' as const,
      layout: 'half',
      component: (props: CrudCustomFieldRenderProps) => {
        const amountType = props.values?.amountType ?? 'fixed'
        const isFixed = amountType === 'fixed'
        return React.createElement('input', {
          type: 'number',
          className: 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50',
          value: props.value ?? '',
          placeholder: '0.00',
          disabled: props.disabled || !isFixed,
          min: 0,
          step: 'any',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const raw = event.target.value
            props.setValue(raw === '' ? '' : Number(raw))
          },
        })
      },
    },
    {
      id: 'description',
      label: t('payment_link_pages.create.description', 'Description'),
      type: 'text',
      layout: 'half',
      placeholder: t('payment_link_pages.create.description.placeholder', 'Payment description'),
    },
    {
      id: 'minAmount',
      label: t('payment_link_pages.minAmount', 'Minimum amount'),
      type: 'custom' as const,
      layout: 'half',
      description: t('payment_link_pages.minAmount.description', 'Minimum amount the customer can enter (leave empty for no minimum)'),
      component: (props: CrudCustomFieldRenderProps) => {
        const isCustomerInput = props.values?.amountType === 'customer_input'
        return React.createElement('input', {
          type: 'number',
          className: 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50',
          value: typeof props.value === 'number' ? props.value : '',
          placeholder: '0.00',
          disabled: props.disabled || !isCustomerInput,
          min: 0,
          step: 'any',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const raw = event.target.value
            props.setValue(raw === '' ? null : Number(raw))
          },
        })
      },
    },
    {
      id: 'maxAmount',
      label: t('payment_link_pages.maxAmount', 'Maximum amount'),
      type: 'custom' as const,
      layout: 'half',
      description: t('payment_link_pages.maxAmount.description', 'Maximum amount the customer can enter (leave empty for no maximum)'),
      component: (props: CrudCustomFieldRenderProps) => {
        const isCustomerInput = props.values?.amountType === 'customer_input'
        return React.createElement('input', {
          type: 'number',
          className: 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50',
          value: typeof props.value === 'number' ? props.value : '',
          placeholder: '0.00',
          disabled: props.disabled || !isCustomerInput,
          min: 0,
          step: 'any',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const raw = event.target.value
            props.setValue(raw === '' ? null : Number(raw))
          },
        })
      },
    },
    {
      id: 'amountOptions',
      label: t('payment_link_pages.amountOptions', 'Amount options'),
      type: 'custom' as const,
      description: t('payment_link_pages.amountOptions.description', 'Predefined amounts the customer can choose from'),
      component: (props: CrudCustomFieldRenderProps) => renderAmountOptionsEditor(props, t),
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
    ...buildBrandingFields(t),
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
    { ...buildContentGroup(t), column: 1 },
    {
      id: 'payment',
      column: 1,
      title: t('payment_link_pages.create.group.payment', 'Payment'),
      fields: ['providerKey', 'currencyCode', 'amountType', 'amount', 'description', 'minAmount', 'maxAmount', 'amountOptions'],
    },
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
  const effectiveAmountType = (values as Record<string, unknown>).amountType as string ?? 'fixed'
  const rawAmount = typeof values.amount === 'number' ? values.amount : Number(values.amount)
  const amount = effectiveAmountType === 'fixed' ? rawAmount : 0
  const amountOptions = effectiveAmountType === 'predefined'
    ? ((values as Record<string, unknown>).amountOptions as Array<{ amount: number; label: string }> | undefined)
      ?.filter(opt => opt.amount > 0 && opt.label?.trim())
    : undefined

  return {
    providerKey: values.providerKey,
    amount,
    currencyCode: values.currencyCode.trim().toUpperCase(),
    description: values.description?.trim() || undefined,
    paymentLink: {
      enabled: true,
      linkMode: values.linkMode,
      amountType: effectiveAmountType !== 'fixed' ? effectiveAmountType : undefined,
      amountOptions: amountOptions && amountOptions.length > 0 ? amountOptions : undefined,
      minAmount: effectiveAmountType === 'customer_input' && typeof (values as Record<string, unknown>).minAmount === 'number' ? (values as Record<string, unknown>).minAmount as number : undefined,
      maxAmount: effectiveAmountType === 'customer_input' && typeof (values as Record<string, unknown>).maxAmount === 'number' ? (values as Record<string, unknown>).maxAmount as number : undefined,
      maxUses:
        values.linkMode === 'multi' && values.maxUses ? values.maxUses : undefined,
      templateId: values.templateId || undefined,
      title: values.defaultTitle?.trim() || undefined,
      description: values.defaultDescription?.trim() || undefined,
      completedContent: values.completedContent?.trim() || undefined,
      password: values.password?.trim() || undefined,
      token: values.customLinkPath?.trim() || undefined,
      metadata: parseJsonSafe(values.metadataJson),
      customerFieldsetCode: values.customerFieldsetCode?.trim() || undefined,
      displayCustomFields: values.displayCustomFields ?? false,
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
  const allValues = values as Record<string, unknown>
  return templateFormValuesToPayload({
    ...values,
    name: values.templateName ?? 'Untitled Template',
    isDefault: false,
    amountType: (allValues.amountType as 'fixed' | 'customer_input' | 'predefined') ?? 'fixed',
    amountOptions: (allValues.amountOptions as Array<{ amount: number; label: string }>) ?? null,
    minAmount: typeof allValues.minAmount === 'number' ? allValues.minAmount : null,
    maxAmount: typeof allValues.maxAmount === 'number' ? allValues.maxAmount : null,
  })
}

// ---------------------------------------------------------------------------
// EDIT MODE
// ---------------------------------------------------------------------------

export const paymentLinkEditSchema = z
  .object({
    status: z.enum(['active', 'completed', 'cancelled']),
    maxUses: z.coerce.number().int().positive().optional().nullable(),
    password: z.string().min(4).max(128).optional().nullable().or(z.literal('')),
    ...sharedAmountTypeSchema,
    ...sharedBrandingSchema,
    ...sharedContentSchema,
    ...sharedCaptureSchema,
    ...sharedMetadataSchema,
    customFieldsetCode: z.string().max(100).optional().nullable(),
    customerFieldsetCode: z.string().max(100).optional().nullable(),
    notifyOnFormSubmitted: z.boolean().optional().default(false),
    notifyOnFormSubmittedTemplate: z.string().max(50000).optional().nullable(),
    notifyOnPaymentCompleted: z.boolean().optional().default(false),
    notifyOnPaymentCompletedTemplate: z.string().max(50000).optional().nullable(),
  })
  .passthrough()

export type PaymentLinkEditFormValues = z.infer<typeof paymentLinkEditSchema>

export function buildPaymentLinkEditFields(
  t: (key: string, fallback?: string) => string,
  options: { onLogoFileSelect: (file: File) => void; passwordProtected?: boolean },
): CrudField[] {
  return [
    {
      id: 'status',
      label: t('payment_gateways.links.edit.status', 'Status'),
      type: 'select' as const,
      required: true,
      options: [
        { value: 'active', label: t('payment_gateways.links.edit.status.active', 'Active') },
        { value: 'completed', label: t('payment_gateways.links.edit.status.completed', 'Completed') },
        { value: 'cancelled', label: t('payment_gateways.links.edit.status.cancelled', 'Cancelled') },
      ],
    },
    {
      id: 'maxUses',
      label: t('payment_gateways.links.edit.maxUses', 'Maximum uses'),
      type: 'number' as const,
      description: t('payment_gateways.links.edit.maxUses.description', 'Leave empty for unlimited (multi-use only)'),
    },
    {
      id: 'password',
      label: t('payment_gateways.links.edit.password', 'New password'),
      type: 'password' as const,
      description: options.passwordProtected
        ? t('payment_gateways.links.edit.password.descriptionSet', 'Password is currently set. Leave empty to keep it.')
        : t('payment_gateways.links.edit.password.description', 'Leave empty for no password'),
    },
    {
      id: 'customerFieldsetCode',
      label: t('payment_link_pages.create.customerFieldsetCode', 'Customer capture fieldset'),
      type: 'text' as const,
      placeholder: t('payment_link_pages.create.customerFieldsetCode.placeholder', 'e.g. customer_questions'),
      description: t('payment_link_pages.create.customerFieldsetCode.description', 'Fieldset code whose fields are shown to customers on the payment page'),
    },
    ...buildAmountTypeFields(t),
    ...buildContentFields(t),
    ...buildBrandingFields(t),
    ...buildCaptureFields(t),
    ...buildMetadataFields(t),
  ]
}

export function buildNotificationFields(
  t: (key: string, fallback?: string) => string,
): CrudField[] {
  return [
    {
      id: 'notifyOnFormSubmitted',
      label: t('payment_link_pages.notifications.onFormSubmitted.enabled', 'Send email when form is submitted'),
      type: 'checkbox',
      description: t('payment_link_pages.notifications.onFormSubmitted.description', 'Send an email notification to the customer when the payment form has been submitted'),
    },
    {
      id: 'notifyOnFormSubmittedTemplate',
      label: t('payment_link_pages.notifications.onFormSubmitted.template', 'Submission email template'),
      type: 'richtext',
      editor: 'uiw',
      placeholder: t('payment_link_pages.notifications.onFormSubmitted.placeholder', 'Enter the email content in Markdown...'),
    },
    {
      id: 'notifyOnPaymentCompleted',
      label: t('payment_link_pages.notifications.onPaymentCompleted.enabled', 'Send email when payment is completed'),
      type: 'checkbox',
      description: t('payment_link_pages.notifications.onPaymentCompleted.description', 'Send an email notification to the customer when the payment has been completed'),
    },
    {
      id: 'notifyOnPaymentCompletedTemplate',
      label: t('payment_link_pages.notifications.onPaymentCompleted.template', 'Payment completed email template'),
      type: 'richtext',
      editor: 'uiw',
      placeholder: t('payment_link_pages.notifications.onPaymentCompleted.placeholder', 'Enter the email content in Markdown...'),
    },
  ]
}

export function buildNotificationGroups(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup[] {
  return [
    {
      id: 'notifyFormSubmitted',
      column: 1,
      title: t('payment_link_pages.notifications.group.onFormSubmitted', 'Form Submission Notification'),
      fields: ['notifyOnFormSubmitted', 'notifyOnFormSubmittedTemplate'],
    },
    {
      id: 'notifyPaymentCompleted',
      column: 1,
      title: t('payment_link_pages.notifications.group.onPaymentCompleted', 'Payment Completed Notification'),
      fields: ['notifyOnPaymentCompleted', 'notifyOnPaymentCompletedTemplate'],
    },
  ]
}

export function buildPaymentLinkEditGroups(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup[] {
  return [
    {
      id: 'general',
      column: 1,
      title: t('payment_gateways.links.edit.group.general', 'Link Settings'),
      fields: ['status', 'maxUses', 'password'],
    },
    { ...buildContentGroup(t), column: 1 },
    { ...buildAmountTypeGroup(t), column: 1 },
    { ...buildBrandingGroup(t), column: 1 },
    { ...buildCaptureGroup(t), column: 1 },
    { ...buildMetadataGroup(t), column: 1 },
    {
      id: 'custom-fields',
      column: 2,
      title: t('payment_gateways.links.edit.group.customFields', 'Custom fields'),
      kind: 'customFields' as const,
    },
  ]
}

export type PaymentLinkApiRecord = {
  id: string
  token: string
  title: string
  description: string | null
  providerKey: string
  status: string
  transactionId: string | null
  amount: number | null
  currencyCode: string | null
  linkMode: string
  maxUses: number | null
  useCount: number
  passwordProtected: boolean
  metadata: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

export function recordToPaymentLinkEditFormValues(
  record: PaymentLinkApiRecord,
): PaymentLinkEditFormValues & Record<string, unknown> {
  const rawMeta = (record.metadata ?? {}) as Record<string, unknown>
  const storedMetadata = readPaymentLinkStoredMetadata(rawMeta)
  const pageMeta = (storedMetadata.pageMetadata ?? {}) as Record<string, unknown>
  const brandingRaw = ((pageMeta.branding ?? rawMeta.branding ?? {}) as Record<string, unknown>)
  const capture = storedMetadata.customerCapture
  const captureFields = (capture?.fields ?? {}) as Record<string, Record<string, unknown>>
  const customFields = storedMetadata.customFields

  const cfValues: Record<string, unknown> = {}
  if (customFields != null && typeof customFields === 'object') {
    for (const [key, value] of Object.entries(customFields)) {
      cfValues[`cf_${key}`] = value
    }
  }

  return {
    ...cfValues,
    status: (record.status as 'active' | 'completed' | 'cancelled') ?? 'active',
    maxUses: record.maxUses,
    password: '',
    amountType: storedMetadata.amountType ?? 'fixed',
    amountOptions: storedMetadata.amountOptions ?? null,
    minAmount: storedMetadata.minAmount ?? null,
    maxAmount: storedMetadata.maxAmount ?? null,
    defaultTitle: record.title || (pageMeta.defaultTitle as string) || '',
    defaultDescription: (pageMeta.defaultDescription as string) ?? record.description ?? '',
    brandingLogoUrl: brandingRaw.logoUrl != null ? String(brandingRaw.logoUrl) : null,
    brandingBrandName: brandingRaw.brandName != null ? String(brandingRaw.brandName) : null,
    brandingSecuritySubtitle: brandingRaw.securitySubtitle != null ? String(brandingRaw.securitySubtitle) : null,
    brandingAccentColor: brandingRaw.accentColor != null ? String(brandingRaw.accentColor) : null,
    brandingCustomCss: brandingRaw.customCss != null ? String(brandingRaw.customCss) : null,
    customerCaptureEnabled: capture?.enabled === true,
    customerCaptureHandlingMode: capture?.customerHandlingMode === 'create_new' ? 'create_new' : 'no_customer',
    customerCaptureCompanyRequired: capture?.companyRequired === true,
    captureFirstNameVisible: captureFields.firstName?.visible !== false,
    captureFirstNameRequired: captureFields.firstName?.required === true,
    captureLastNameVisible: captureFields.lastName?.visible !== false,
    captureLastNameRequired: captureFields.lastName?.required === true,
    capturePhoneVisible: captureFields.phone?.visible !== false,
    capturePhoneRequired: captureFields.phone?.required === true,
    captureCompanyVisible: captureFields.companyName?.visible === true,
    captureCompanyRequired: captureFields.companyName?.required === true,
    captureAddressVisible: captureFields.address?.visible === true,
    captureAddressRequired: captureFields.address?.required === true,
    captureAddressFormat: captureFields.address?.format === 'street_first' ? 'street_first' as const : 'line_first' as const,
    customerCaptureTermsRequired: capture?.termsRequired === true,
    customerCaptureTermsMarkdown: capture?.termsMarkdown ?? null,
    customFieldsetCode: storedMetadata.customFieldsetCode ?? null,
    customerFieldsetCode: storedMetadata.customerFieldsetCode ?? null,
    displayCustomFields: storedMetadata.displayCustomFields === true,
    notifyOnFormSubmitted: storedMetadata.notifications?.onFormSubmitted?.enabled === true,
    notifyOnFormSubmittedTemplate: storedMetadata.notifications?.onFormSubmitted?.emailTemplate ?? null,
    notifyOnPaymentCompleted: storedMetadata.notifications?.onPaymentCompleted?.enabled === true,
    notifyOnPaymentCompletedTemplate: storedMetadata.notifications?.onPaymentCompleted?.emailTemplate ?? null,
    metadataJson: null,
  }
}

export function paymentLinkEditFormToPayload(
  values: PaymentLinkEditFormValues,
  recordId: string,
): Record<string, unknown> {
  let userMetadata: Record<string, unknown> | undefined
  try {
    if (values.metadataJson?.trim()) userMetadata = JSON.parse(values.metadataJson) as Record<string, unknown>
  } catch { /* skip invalid JSON */ }

  return {
    id: recordId,
    title: values.defaultTitle?.trim() || '',
    status: values.status,
    maxUses: values.maxUses || null,
    password: values.password?.trim() || undefined,
    branding: {
      logoUrl: values.brandingLogoUrl || null,
      brandName: values.brandingBrandName || null,
      securitySubtitle: values.brandingSecuritySubtitle || null,
      accentColor: values.brandingAccentColor || null,
      customCss: values.brandingCustomCss || null,
    },
    defaultTitle: values.defaultTitle?.trim() || null,
    defaultDescription: values.defaultDescription?.trim() || null,
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
        address: { visible: values.captureAddressVisible ?? false, required: values.captureAddressRequired ?? false, format: values.captureAddressFormat ?? 'line_first' },
      },
    },
    amountType: values.amountType ?? 'fixed',
    amountOptions: values.amountType === 'predefined' && Array.isArray(values.amountOptions) && values.amountOptions.length > 0
      ? values.amountOptions.filter((opt: { amount: number; label: string }) => opt.amount > 0 && opt.label.trim().length > 0)
      : null,
    minAmount: values.amountType === 'customer_input' && typeof values.minAmount === 'number' ? values.minAmount : null,
    maxAmount: values.amountType === 'customer_input' && typeof values.maxAmount === 'number' ? values.maxAmount : null,
    customerFieldsetCode: values.customerFieldsetCode?.trim() || null,
    notifications: {
      onFormSubmitted: {
        enabled: values.notifyOnFormSubmitted === true,
        emailTemplate: values.notifyOnFormSubmittedTemplate?.trim() || null,
      },
      onPaymentCompleted: {
        enabled: values.notifyOnPaymentCompleted === true,
        emailTemplate: values.notifyOnPaymentCompletedTemplate?.trim() || null,
      },
    },
    ...(userMetadata ? { metadata: userMetadata } : {}),
  }
}
