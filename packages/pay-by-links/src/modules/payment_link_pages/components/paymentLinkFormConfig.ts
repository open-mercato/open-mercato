import * as React from 'react'
import { z } from 'zod'
import type {
  CrudCustomFieldRenderProps,
  CrudField,
  CrudFieldOption,
  CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'
import { templateFormValuesToPayload } from './templateFormConfig'

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

    // Branding fields
    brandingLogoUrl: z.string().url().max(2000).optional().nullable().or(z.literal('')),
    brandingBrandName: z.string().max(200).optional().nullable(),
    brandingSecuritySubtitle: z.string().max(200).optional().nullable(),
    brandingAccentColor: z
      .string()
      .regex(/^#([0-9a-fA-F]{3,8})$/)
      .optional()
      .nullable()
      .or(z.literal('')),
    brandingCustomCss: z.string().max(10000).optional().nullable(),

    // Content fields
    defaultTitle: z.string().max(160).optional().nullable(),
    defaultDescription: z.string().max(500).optional().nullable(),

    // Customer capture fields
    customerCaptureEnabled: z.boolean().optional().default(false),
    customerCaptureHandlingMode: z
      .enum(['no_customer', 'create_new', 'verify_and_merge'])
      .optional()
      .default('no_customer'),
    customerCaptureCompanyRequired: z.boolean().optional().default(false),
    captureFirstNameVisible: z.boolean().optional().default(true),
    captureFirstNameRequired: z.boolean().optional().default(true),
    captureLastNameVisible: z.boolean().optional().default(true),
    captureLastNameRequired: z.boolean().optional().default(true),
    capturePhoneVisible: z.boolean().optional().default(true),
    capturePhoneRequired: z.boolean().optional().default(false),
    captureCompanyVisible: z.boolean().optional().default(false),
    captureCompanyRequired: z.boolean().optional().default(false),
    captureAddressVisible: z.boolean().optional().default(false),
    captureAddressRequired: z.boolean().optional().default(false),
    captureAddressFormat: z.enum(['line_first', 'street_first']).optional().default('line_first'),
    customerCaptureTermsRequired: z.boolean().optional().default(false),
    customerCaptureTermsMarkdown: z.string().max(20000).optional().nullable(),

    // Metadata
    metadataJson: z.string().optional().nullable(),

    // Save as template
    saveAsTemplate: z.boolean().optional().default(false),
    templateName: z.string().max(200).optional().nullable(),
  })
  .superRefine((data, ctx) => {
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
// Custom field helper components (using React.createElement for .ts compat)
// ---------------------------------------------------------------------------

function renderSelectField(
  props: CrudCustomFieldRenderProps,
  options: { value: string; label: string }[],
  extra: {
    placeholder: string
    disabled?: boolean
    onChange?: (value: string) => void
  },
): React.ReactNode {
  const selectProps: Record<string, unknown> = {
    className:
      'flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
    value: typeof props.value === 'string' ? props.value : '',
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextValue = event.target.value
      props.setValue(nextValue || null)
      extra.onChange?.(nextValue)
    },
    autoFocus: props.autoFocus,
    disabled: props.disabled || extra.disabled,
  }

  const children: React.ReactNode[] = [
    React.createElement('option', { key: '__placeholder', value: '' }, extra.placeholder),
    ...options.map((opt) =>
      React.createElement('option', { key: opt.value, value: opt.value }, opt.label),
    ),
  ]

  return React.createElement('select', selectProps, ...children)
}

function renderAccentColorField(props: CrudCustomFieldRenderProps): React.ReactNode {
  const colorValue = typeof props.value === 'string' ? props.value : ''

  const colorInput = React.createElement('input', {
    type: 'color',
    value: colorValue || '#1a73e8',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      props.setValue(event.target.value)
    },
    disabled: props.disabled,
    className: 'h-9 w-10 cursor-pointer rounded-md border border-input p-0.5',
  })

  const textInput = React.createElement('input', {
    type: 'text',
    value: colorValue,
    placeholder: '#1a73e8',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      props.setValue(event.target.value)
    },
    autoFocus: props.autoFocus,
    disabled: props.disabled,
    className:
      'flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm',
  })

  return React.createElement(
    'div',
    { className: 'flex items-center gap-2' },
    colorInput,
    textInput,
  )
}

function renderLogoField(
  props: CrudCustomFieldRenderProps,
  extra: { onFileSelect: (file: File) => void; uploadLabel: string },
): React.ReactNode {
  const urlValue = typeof props.value === 'string' ? props.value : ''
  const fileInputRef = { current: null as HTMLInputElement | null }

  const urlInput = React.createElement('input', {
    type: 'text',
    value: urlValue,
    placeholder: 'https://example.com/logo.png',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      props.setValue(event.target.value)
    },
    autoFocus: props.autoFocus,
    disabled: props.disabled,
    className: 'flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm',
  })

  const hiddenInput = React.createElement('input', {
    type: 'file',
    accept: 'image/*',
    className: 'hidden',
    ref: (el: HTMLInputElement | null) => { fileInputRef.current = el },
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) extra.onFileSelect(file)
    },
  })

  const uploadButton = React.createElement(
    'button',
    {
      type: 'button',
      disabled: props.disabled,
      className: 'inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground',
      onClick: () => fileInputRef.current?.click(),
    },
    extra.uploadLabel,
  )

  const preview = urlValue
    ? React.createElement('img', {
        src: urlValue,
        alt: 'Logo preview',
        className: 'mt-2 h-10 max-w-[160px] rounded border object-contain',
        onError: (event: React.SyntheticEvent<HTMLImageElement>) => {
          (event.target as HTMLImageElement).style.display = 'none'
        },
      })
    : null

  return React.createElement(
    'div',
    null,
    React.createElement('div', { className: 'flex items-center gap-2' }, urlInput, uploadButton, hiddenInput),
    preview,
  )
}

function renderMetadataField(props: CrudCustomFieldRenderProps): React.ReactNode {
  const JsonBuilder = React.lazy(() =>
    import('@open-mercato/ui/backend/JsonBuilder').then((mod) => ({ default: mod.JsonBuilder })),
  )

  const rawValue = typeof props.value === 'string' ? props.value : ''
  let parsed: Record<string, unknown> = {}
  try {
    if (rawValue.trim()) parsed = JSON.parse(rawValue)
  } catch { /* keep empty */ }

  return React.createElement(
    React.Suspense,
    { fallback: React.createElement('div', { className: 'text-sm text-muted-foreground' }, 'Loading...') },
    React.createElement(JsonBuilder, {
      value: parsed,
      onChange: (next: Record<string, unknown>) => {
        props.setValue(JSON.stringify(next, null, 2))
      },
      disabled: props.disabled,
    }),
  )
}

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
      type: 'number',
      placeholder: t('payment_link_pages.create.maxUses.placeholder', 'Unlimited'),
      description: t('payment_link_pages.create.maxUses.description', 'Only applies to multi-use links. Leave empty for unlimited.'),
    },
    {
      id: 'password',
      label: t('payment_link_pages.create.password', 'Password (optional)'),
      type: 'text',
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

    // Branding
    {
      id: 'brandingLogoUrl',
      label: t('payment_link_pages.create.branding.logoUrl', 'Logo'),
      type: 'custom' as const,
      component: (props: CrudCustomFieldRenderProps) =>
        renderLogoField(props, {
          onFileSelect: options.onLogoFileSelect,
          uploadLabel: t('payment_link_pages.create.branding.logoUpload', 'Upload'),
        }),
    },
    {
      id: 'brandingBrandName',
      label: t('payment_link_pages.create.branding.brandName', 'Brand name'),
      type: 'text',
      layout: 'half',
      placeholder: t('payment_link_pages.create.branding.brandName.placeholder', 'Your Company'),
    },
    {
      id: 'brandingSecuritySubtitle',
      label: t('payment_link_pages.create.branding.securitySubtitle', 'Security subtitle'),
      type: 'text',
      layout: 'half',
      placeholder: t('payment_link_pages.create.branding.securitySubtitle.placeholder', 'Secured by ...'),
    },
    {
      id: 'brandingAccentColor',
      label: t('payment_link_pages.create.branding.accentColor', 'Accent color'),
      type: 'custom' as const,
      layout: 'half',
      component: renderAccentColorField,
    },
    {
      id: 'brandingCustomCss',
      label: t('payment_link_pages.create.branding.customCss', 'Custom CSS'),
      type: 'textarea',
      placeholder: t('payment_link_pages.create.branding.customCss.placeholder', '/* Custom styles */'),
    },

    // Content
    {
      id: 'defaultTitle',
      label: t('payment_link_pages.create.defaultTitle', 'Page title'),
      type: 'text',
      layout: 'half',
      placeholder: t('payment_link_pages.create.defaultTitle.placeholder', 'Payment for ...'),
    },
    {
      id: 'defaultDescription',
      label: t('payment_link_pages.create.defaultDescription', 'Page description'),
      type: 'textarea',
      layout: 'half',
      placeholder: t('payment_link_pages.create.defaultDescription.placeholder', 'Description shown on the payment page'),
    },

    // Customer capture
    {
      id: 'customerCaptureEnabled',
      label: t('payment_link_pages.create.customerCapture.enabled', 'Enable customer capture'),
      type: 'checkbox',
      description: t('payment_link_pages.create.customerCapture.enabled.description', 'Collect customer information before payment'),
    },
    {
      id: 'customerCaptureHandlingMode',
      label: t('payment_link_pages.create.customerCapture.handlingMode', 'Customer handling mode'),
      type: 'select',
      options: [
        { label: t('payment_link_pages.create.customerCapture.handlingMode.noCustomer', 'Do not create customer (data only)'), value: 'no_customer' },
        { label: t('payment_link_pages.create.customerCapture.handlingMode.createNew', 'Always create new customer'), value: 'create_new' },
        { label: t('payment_link_pages.create.customerCapture.handlingMode.verifyAndMerge', 'Merge with existing (email verification)'), value: 'verify_and_merge' },
      ],
    },
    {
      id: 'customerCaptureCompanyRequired',
      label: t('payment_link_pages.create.customerCapture.companyRequired', 'Company required'),
      type: 'checkbox',
    },
    // Field visibility/required pairs — use layout: 'half' for 2-column
    {
      id: 'captureFirstNameVisible',
      label: t('payment_link_pages.create.capture.firstName.visible', 'First name visible'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'captureFirstNameRequired',
      label: t('payment_link_pages.create.capture.firstName.required', 'First name required'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'captureLastNameVisible',
      label: t('payment_link_pages.create.capture.lastName.visible', 'Last name visible'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'captureLastNameRequired',
      label: t('payment_link_pages.create.capture.lastName.required', 'Last name required'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'capturePhoneVisible',
      label: t('payment_link_pages.create.capture.phone.visible', 'Phone visible'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'capturePhoneRequired',
      label: t('payment_link_pages.create.capture.phone.required', 'Phone required'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'captureCompanyVisible',
      label: t('payment_link_pages.create.capture.company.visible', 'Company visible'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'captureCompanyRequired',
      label: t('payment_link_pages.create.capture.company.required', 'Company required'),
      type: 'checkbox',
      layout: 'half',
    },
    // Address capture
    {
      id: 'captureAddressVisible',
      label: t('payment_link_pages.create.capture.address.visible', 'Address visible'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'captureAddressRequired',
      label: t('payment_link_pages.create.capture.address.required', 'Address required'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'captureAddressFormat',
      label: t('payment_link_pages.create.capture.address.format', 'Address format'),
      type: 'select',
      options: [
        { label: t('payment_link_pages.create.capture.address.format.lineFirst', 'Line first (US/UK)'), value: 'line_first' },
        { label: t('payment_link_pages.create.capture.address.format.streetFirst', 'Street first (EU)'), value: 'street_first' },
      ],
      description: t('payment_link_pages.create.capture.address.format.description', 'Controls the address field layout on the payment page'),
    },
    // Terms
    {
      id: 'customerCaptureTermsRequired',
      label: t('payment_link_pages.create.customerCapture.termsRequired', 'Require terms acceptance'),
      type: 'checkbox',
    },
    {
      id: 'customerCaptureTermsMarkdown',
      label: t('payment_link_pages.create.customerCapture.termsMarkdown', 'Terms & conditions'),
      type: 'richtext',
      editor: 'uiw',
      placeholder: t('payment_link_pages.create.customerCapture.termsMarkdown.placeholder', 'Enter terms and conditions content...'),
    },

    // Metadata — uses JsonBuilder
    {
      id: 'metadataJson',
      label: t('payment_link_pages.create.metadata', 'Metadata'),
      type: 'custom' as const,
      description: t('payment_link_pages.create.metadata.description', 'Arbitrary key-value data attached to the payment link'),
      component: renderMetadataField,
    },

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
    {
      id: 'template',
      title: t('payment_link_pages.create.group.template', 'Template'),
      fields: ['templateId'],
    },
    {
      id: 'payment',
      title: t('payment_link_pages.create.group.payment', 'Payment'),
      fields: ['providerKey', 'currencyCode', 'amount', 'description'],
    },
    {
      id: 'linkSettings',
      title: t('payment_link_pages.create.group.linkSettings', 'Link Settings'),
      fields: ['linkMode', 'maxUses', 'password', 'customLinkPath'],
    },
    {
      id: 'branding',
      title: t('payment_link_pages.create.group.branding', 'Branding'),
      fields: [
        'brandingLogoUrl',
        'brandingBrandName',
        'brandingSecuritySubtitle',
        'brandingAccentColor',
        'brandingCustomCss',
      ],
    },
    {
      id: 'content',
      title: t('payment_link_pages.create.group.content', 'Content'),
      fields: ['defaultTitle', 'defaultDescription'],
    },
    {
      id: 'capture',
      title: t('payment_link_pages.create.group.capture', 'Customer Capture'),
      fields: [
        'customerCaptureEnabled',
        'customerCaptureHandlingMode',
        'customerCaptureCompanyRequired',
        'captureFirstNameVisible',
        'captureFirstNameRequired',
        'captureLastNameVisible',
        'captureLastNameRequired',
        'capturePhoneVisible',
        'capturePhoneRequired',
        'captureCompanyVisible',
        'captureCompanyRequired',
        'captureAddressVisible',
        'captureAddressRequired',
        'captureAddressFormat',
        'customerCaptureTermsRequired',
        'customerCaptureTermsMarkdown',
      ],
    },
    {
      id: 'metadata',
      title: t('payment_link_pages.create.group.metadata', 'Metadata'),
      fields: ['metadataJson'],
    },
    {
      id: 'saveTemplate',
      title: t('payment_link_pages.create.group.saveTemplate', 'Save as Template'),
      fields: ['saveAsTemplate', 'templateName'],
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
