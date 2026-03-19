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
}

export const sharedContentSchema = {
  defaultTitle: z.string().max(160).optional().nullable(),
  defaultDescription: z.string().max(500).optional().nullable(),
  completedContent: z.string().max(50000).optional().nullable(),
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
  customerFieldsetCode: z.string().max(100).optional().nullable(),
  displayCustomFields: z.boolean().optional().default(false),
}

export const sharedAmountTypeSchema = {
  amountType: z.enum(['fixed', 'customer_input', 'predefined']).optional().default('fixed'),
  amountOptions: z
    .array(z.object({ amount: z.number().positive(), label: z.string().min(1).max(200) }))
    .max(50)
    .optional()
    .nullable(),
  minAmount: z.union([z.number().min(0), z.literal(''), z.null()]).optional().nullable(),
  maxAmount: z.union([z.number().min(0), z.literal(''), z.null()]).optional().nullable(),
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

function LogoFieldInner(props: CrudCustomFieldRenderProps & { uploadLabel: string }) {
  const urlValue = typeof props.value === 'string' ? props.value : ''
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = React.useState(false)

  const handleFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('entityId', 'payment_link_pages:branding')
      fd.set('recordId', 'logo-upload')
      const res = await fetch('/api/attachments', { method: 'POST', body: fd })
      if (res.ok) {
        const json = await res.json() as { item?: { url?: string } }
        const url = json.item?.url
        if (url) props.setValue(url)
      }
    } catch { /* skip */ }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [props.setValue])

  return React.createElement(
    'div',
    null,
    React.createElement(
      'div',
      { className: 'flex items-center gap-2' },
      React.createElement('input', {
        type: 'text',
        value: urlValue,
        placeholder: 'https://example.com/logo.png',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => { props.setValue(event.target.value) },
        autoFocus: props.autoFocus,
        disabled: props.disabled || uploading,
        className: 'flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm',
      }),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: props.disabled || uploading,
          className: 'inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground',
          onClick: () => fileInputRef.current?.click(),
        },
        React.createElement('svg', {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          className: 'h-4 w-4',
        },
          React.createElement('path', { d: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48' }),
        ),
        uploading ? '...' : props.uploadLabel,
      ),
      React.createElement('input', {
        type: 'file',
        accept: 'image/*',
        className: 'hidden',
        ref: fileInputRef,
        onChange: handleFileChange,
      }),
    ),
    urlValue
      ? React.createElement('img', {
          src: urlValue,
          alt: 'Logo preview',
          className: 'mt-2 h-10 max-w-[160px] rounded border object-contain',
          onError: (event: React.SyntheticEvent<HTMLImageElement>) => {
            (event.target as HTMLImageElement).style.display = 'none'
          },
        })
      : null,
  )
}

export function renderLogoField(
  props: CrudCustomFieldRenderProps,
  extra: { uploadLabel: string },
): React.ReactNode {
  return React.createElement(LogoFieldInner, { ...props, uploadLabel: extra.uploadLabel })
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
// Amount options editor (variants table)
// ---------------------------------------------------------------------------

type AmountOptionItem = { amount: number; label: string }

function parseAmountOptions(value: unknown): AmountOptionItem[] {
  if (Array.isArray(value)) return value.filter((v): v is AmountOptionItem => v != null && typeof v === 'object' && typeof v.amount === 'number' && typeof v.label === 'string')
  return []
}

export function renderAmountOptionsEditor(props: CrudCustomFieldRenderProps, t: (key: string, fallback?: string) => string): React.ReactNode {
  const items = parseAmountOptions(props.value)
  const isDisabled = props.disabled || props.values?.amountType !== 'predefined'

  const cellInputClass = 'w-full bg-transparent px-2 py-1.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50'
  const buttonClass = 'inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50'

  const handleAdd = () => {
    props.setValue([...items, { amount: 0, label: '' }])
  }

  const handleRemove = (index: number) => {
    props.setValue(items.filter((_, i) => i !== index))
  }

  const handleChange = (index: number, field: 'amount' | 'label', rawValue: string) => {
    const updated = items.map((item, i) => {
      if (i !== index) return item
      if (field === 'amount') return { ...item, amount: rawValue === '' ? 0 : Number(rawValue) }
      return { ...item, label: rawValue }
    })
    props.setValue(updated)
  }

  const table = items.length > 0
    ? React.createElement(
        'table',
        { className: 'w-full border-collapse rounded-md border border-input text-sm' },
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            { className: 'border-b border-input bg-muted/40 text-xs font-medium text-muted-foreground' },
            React.createElement('th', { className: 'px-2 py-1.5 text-left font-medium' }, t('payment_link_pages.amountOptions.amount', 'Amount')),
            React.createElement('th', { className: 'px-2 py-1.5 text-left font-medium' }, t('payment_link_pages.amountOptions.label', 'Description')),
            React.createElement('th', { className: 'w-8 px-1' }),
          ),
        ),
        React.createElement(
          'tbody',
          null,
          ...items.map((item, index) =>
            React.createElement(
              'tr',
              { key: index, className: index < items.length - 1 ? 'border-b border-input' : '' },
              React.createElement(
                'td',
                { className: 'px-0' },
                React.createElement('input', {
                  type: 'number',
                  className: cellInputClass,
                  value: item.amount || '',
                  placeholder: '0.00',
                  disabled: isDisabled,
                  min: 0,
                  step: 'any',
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => handleChange(index, 'amount', event.target.value),
                }),
              ),
              React.createElement(
                'td',
                { className: 'border-l border-input px-0' },
                React.createElement('input', {
                  type: 'text',
                  className: cellInputClass,
                  value: item.label,
                  placeholder: t('payment_link_pages.amountOptions.label.placeholder', 'e.g. Basic Plan'),
                  disabled: isDisabled,
                  maxLength: 200,
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => handleChange(index, 'label', event.target.value),
                }),
              ),
              React.createElement(
                'td',
                { className: 'border-l border-input px-1 text-center' },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
                    disabled: isDisabled,
                    onClick: () => handleRemove(index),
                    title: t('payment_link_pages.amountOptions.remove', 'Remove'),
                  },
                  '\u00D7',
                ),
              ),
            ),
          ),
        ),
      )
    : null

  const addButton = React.createElement(
    'button',
    {
      type: 'button',
      className: buttonClass + ' mt-2',
      disabled: isDisabled,
      onClick: handleAdd,
    },
    '+ ' + t('payment_link_pages.amountOptions.add', 'Add option'),
  )

  return React.createElement(
    'div',
    null,
    table,
    addButton,
  )
}

// ---------------------------------------------------------------------------
// Amount type field builders
// ---------------------------------------------------------------------------

export function buildAmountTypeFields(
  t: (key: string, fallback?: string) => string,
): CrudField[] {
  return [
    {
      id: 'amountType',
      label: t('payment_link_pages.amountType', 'Amount type'),
      type: 'select',
      options: [
        { label: t('payment_link_pages.amountType.fixed', 'Fixed amount'), value: 'fixed' },
        { label: t('payment_link_pages.amountType.customerInput', 'Customer enters amount'), value: 'customer_input' },
        { label: t('payment_link_pages.amountType.predefined', 'Customer selects from list'), value: 'predefined' },
      ],
      description: t('payment_link_pages.amountType.description', 'How the payment amount is determined'),
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
  ]
}

export function buildAmountTypeGroup(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup {
  return {
    id: 'amountType',
    title: t('payment_link_pages.group.amountType', 'Amount Configuration'),
    fields: ['amountType', 'minAmount', 'maxAmount', 'amountOptions'],
  }
}

// ---------------------------------------------------------------------------
// Customer fieldset select renderer
// ---------------------------------------------------------------------------

type FieldsetOption = { code: string; label: string }

function CustomerFieldsetSelect(props: CrudCustomFieldRenderProps & { entityId: string; t: (key: string, fallback?: string) => string }) {
  const [fieldsets, setFieldsets] = React.useState<FieldsetOption[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/entities/definitions?entityId=${encodeURIComponent(props.entityId)}`)
        if (cancelled || !res.ok) { setLoading(false); return }
        const json = await res.json() as { fieldsetsByEntity?: Record<string, FieldsetOption[]> }
        const list = json.fieldsetsByEntity?.[props.entityId] ?? []
        if (!cancelled) setFieldsets(list)
      } catch { /* skip */ }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [props.entityId])

  const options: FieldsetOption[] = [
    { code: '', label: props.t('payment_link_pages.customerFieldset.none', 'None') },
    ...(fieldsets.length === 0 && !loading
      ? [{ code: 'default', label: props.t('payment_link_pages.customerFieldset.default', 'Default') }]
      : fieldsets),
  ]

  return React.createElement(
    'select',
    {
      className: 'flex h-9 w-full rounded-md border border-input bg-background pl-3 pr-8 py-2 text-sm',
      value: typeof props.value === 'string' ? props.value : '',
      disabled: props.disabled || loading,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
        props.setValue(event.target.value || null)
      },
    },
    ...options.map((opt) =>
      React.createElement('option', { key: opt.code, value: opt.code }, opt.label),
    ),
  )
}

// ---------------------------------------------------------------------------
// Shared field builder options
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared field builders
// ---------------------------------------------------------------------------

export function buildBrandingFields(
  t: (key: string, fallback?: string) => string,
): CrudField[] {
  return [
    {
      id: 'brandingLogoUrl',
      label: t('payment_link_pages.create.branding.logoUrl', 'Logo'),
      type: 'custom' as const,
      component: (props: CrudCustomFieldRenderProps) =>
        renderLogoField(props, {
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
    {
      id: 'completedContent',
      label: t('payment_link_pages.create.completedContent', 'Post-payment content'),
      type: 'richtext',
      editor: 'uiw',
      description: t('payment_link_pages.create.completedContent.description', 'Markdown content displayed to the customer after successful payment'),
      placeholder: t('payment_link_pages.create.completedContent.placeholder', 'Thank you for your payment! Your order will be processed shortly.'),
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
    {
      id: 'customerFieldsetCode',
      label: t('payment_link_pages.create.customerFieldset', 'Customer capture fieldset'),
      type: 'custom' as const,
      description: t('payment_link_pages.create.customerFieldset.description', 'Select a custom fieldset whose fields will be shown to customers on the payment page for data capture'),
      component: (fieldProps: CrudCustomFieldRenderProps) =>
        React.createElement(CustomerFieldsetSelect, {
          ...fieldProps,
          entityId: 'payment_link_pages:payment_link_page',
          t,
        }),
    },
    {
      id: 'displayCustomFields',
      label: t('payment_link_pages.create.displayCustomFields', 'Display custom fields to customer'),
      type: 'checkbox',
      description: t('payment_link_pages.create.displayCustomFields.description', 'Show read-only custom field values from other fieldsets to the customer on the payment page'),
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
    ],
  }
}

export function buildContentGroup(
  t: (key: string, fallback?: string) => string,
): CrudFormGroup {
  return {
    id: 'content',
    title: t('payment_link_pages.create.group.content', 'Content'),
    fields: ['defaultTitle', 'defaultDescription', 'completedContent'],
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
      'customerFieldsetCode',
      'displayCustomFields',
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
