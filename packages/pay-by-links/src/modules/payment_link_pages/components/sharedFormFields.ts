import * as React from 'react'
import { z } from 'zod'
import type {
  CrudCustomFieldRenderProps,
  CrudField,
  CrudFormGroup,
} from '@open-mercato/ui/backend/CrudForm'

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

export const sharedBrandingSchema = {
  brandingLogoUrl: z.string().max(2000).optional().nullable().or(z.literal('')),
  brandingBrandName: z.string().max(200).optional().nullable(),
  brandingSecuritySubtitle: z.string().max(200).optional().nullable(),
  brandingAccentColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{3,8})$/)
    .optional()
    .nullable()
    .or(z.literal('')),
  brandingCustomCss: z.string().max(10000).optional().nullable(),
}

export const sharedContentSchema = {
  defaultTitle: z.string().max(160).optional().nullable(),
  defaultDescription: z.string().max(500).optional().nullable(),
}

export const sharedCaptureSchema = {
  customerCaptureEnabled: z.boolean().optional().default(false),
  customerCaptureHandlingMode: z
    .enum(['no_customer', 'create_new'])
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
}

export const sharedMetadataSchema = {
  metadataJson: z.string().optional().nullable(),
}

// ---------------------------------------------------------------------------
// Render helpers (using React.createElement for .ts compat)
// ---------------------------------------------------------------------------

export function renderSelectField(
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

export function renderAccentColorField(props: CrudCustomFieldRenderProps): React.ReactNode {
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

export function renderLogoField(
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

const LazyJsonBuilder = React.lazy(() =>
  import('@open-mercato/ui/backend/JsonBuilder').then((mod) => ({ default: mod.JsonBuilder })),
)

export function renderMetadataField(props: CrudCustomFieldRenderProps): React.ReactNode {
  const rawValue = typeof props.value === 'string' ? props.value : ''
  let parsed: Record<string, unknown> = {}
  try {
    if (rawValue.trim()) parsed = JSON.parse(rawValue)
  } catch { /* keep empty */ }

  return React.createElement(
    React.Suspense,
    { fallback: React.createElement('div', { className: 'text-sm text-muted-foreground' }, 'Loading...') },
    React.createElement(LazyJsonBuilder, {
      value: parsed,
      onChange: (next: Record<string, unknown>) => {
        props.setValue(JSON.stringify(next, null, 2))
      },
      disabled: props.disabled,
    }),
  )
}

// ---------------------------------------------------------------------------
// Shared field builder options
// ---------------------------------------------------------------------------

export type SharedFieldBuilderOptions = {
  onLogoFileSelect: (file: File) => void
}

// ---------------------------------------------------------------------------
// Shared field builders
// ---------------------------------------------------------------------------

export function buildBrandingFields(
  t: (key: string, fallback?: string) => string,
  options: SharedFieldBuilderOptions,
): CrudField[] {
  return [
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
  ]
}

export function buildContentFields(
  t: (key: string, fallback?: string) => string,
): CrudField[] {
  return [
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
      type: 'richtext',
      editor: 'uiw',
      placeholder: t('payment_link_pages.create.defaultDescription.placeholder', 'Description shown on the payment page'),
    },
  ]
}

export function buildCaptureFields(
  t: (key: string, fallback?: string) => string,
): CrudField[] {
  return [
    {
      id: 'customerCaptureEnabled',
      label: t('payment_link_pages.create.customerCapture.enabled', 'Enable customer capture'),
      type: 'checkbox',
      description: t('payment_link_pages.create.customerCapture.enabled.description', 'Collect customer information before payment'),
    },
    {
      id: 'customerCaptureHandlingMode',
      label: t('payment_link_pages.create.customerCapture.handlingMode', 'Customer handling mode'),
      type: 'custom' as const,
      component: (props: CrudCustomFieldRenderProps) => {
        const captureEnabled = props.values?.customerCaptureEnabled === true
        return renderSelectField(
          props,
          [
            { value: 'no_customer', label: t('payment_link_pages.create.customerCapture.handlingMode.noCustomer', 'Do not create customer (data only)') },
            { value: 'create_new', label: t('payment_link_pages.create.customerCapture.handlingMode.createNew', 'Always create new customer') },
          ],
          {
            placeholder: '\u2014',
            disabled: !captureEnabled,
          },
        )
      },
    },
    {
      id: 'customerCaptureCompanyRequired',
      label: t('payment_link_pages.create.customerCapture.companyRequired', 'Company required'),
      type: 'checkbox',
    },
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
  ]
}

export function buildMetadataFields(
  t: (key: string, fallback?: string) => string,
): CrudField[] {
  return [
    {
      id: 'metadataJson',
      label: t('payment_link_pages.create.metadata', 'Metadata'),
      type: 'custom' as const,
      description: t('payment_link_pages.create.metadata.description', 'Arbitrary key-value data attached to the payment link'),
      component: renderMetadataField,
    },
  ]
}

// ---------------------------------------------------------------------------
// Shared group builders
// ---------------------------------------------------------------------------

export function buildBrandingGroup(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup {
  return {
    id: 'branding',
    title: t('payment_link_pages.create.group.branding', 'Branding'),
    fields: [
      'brandingLogoUrl',
      'brandingBrandName',
      'brandingSecuritySubtitle',
      'brandingAccentColor',
      'brandingCustomCss',
    ],
  }
}

export function buildContentGroup(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup {
  return {
    id: 'content',
    title: t('payment_link_pages.create.group.content', 'Content'),
    fields: ['defaultTitle', 'defaultDescription'],
  }
}

export function buildCaptureGroup(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup {
  return {
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
  }
}

export function buildMetadataGroup(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup {
  return {
    id: 'metadata',
    title: t('payment_link_pages.create.group.metadata', 'Metadata'),
    fields: ['metadataJson'],
  }
}
