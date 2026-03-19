"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { slugify } from '@open-mercato/shared/lib/slugify'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../setup'
import { CustomerFieldsEditor } from './CustomerFieldsEditor'
import { GatewaySettingsFields } from './GatewaySettingsFields'

type Props = {
  mode: 'link' | 'template'
  recordId?: string
}

type FormValues = Record<string, unknown>

type ProviderDescriptor = {
  providerKey: string
  label: string
}

function PriceListEditor({
  value,
  onChange,
}: {
  value: Array<{ id: string; description: string; amount: number; currencyCode: string }>
  onChange: (next: Array<{ id: string; description: string; amount: number; currencyCode: string }>) => void
}) {
  const items = Array.isArray(value) ? value : []
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.id}:${index}`} className="grid gap-3 md:grid-cols-4">
          <Input
            value={item.id}
            onChange={(event) => onChange(items.map((current, currentIndex) => currentIndex === index ? { ...current, id: event.target.value } : current))}
            placeholder="item_1"
          />
          <Input
            value={item.description}
            onChange={(event) => onChange(items.map((current, currentIndex) => currentIndex === index ? { ...current, description: event.target.value } : current))}
            placeholder="Description"
          />
          <Input
            type="number"
            value={item.amount}
            onChange={(event) => onChange(items.map((current, currentIndex) => currentIndex === index ? { ...current, amount: Number(event.target.value) } : current))}
            placeholder="Amount"
          />
          <div className="flex gap-2">
            <Input
              value={item.currencyCode}
              onChange={(event) => onChange(items.map((current, currentIndex) => currentIndex === index ? { ...current, currencyCode: event.target.value.toUpperCase() } : current))}
              placeholder="USD"
            />
            <Button type="button" variant="outline" onClick={() => onChange(items.filter((_, currentIndex) => currentIndex !== index))}>Remove</Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => onChange([...items, { id: `item_${items.length + 1}`, description: '', amount: 0, currencyCode: 'USD' }])}>
        Add item
      </Button>
    </div>
  )
}

function PricingSection({ values, setValue }: { values: Record<string, unknown>; setValue: (id: string, value: unknown) => void }) {
  const pricingMode = typeof values.pricingMode === 'string' ? values.pricingMode : 'fixed'
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Pricing mode</Label>
        <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={pricingMode} onChange={(event) => setValue('pricingMode', event.target.value)}>
          <option value="fixed">Fixed</option>
          <option value="custom_amount">Custom amount</option>
          <option value="price_list">Price list</option>
        </select>
      </div>
      {pricingMode === 'fixed' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Input type="number" value={typeof values.fixedPriceAmount === 'number' || typeof values.fixedPriceAmount === 'string' ? `${values.fixedPriceAmount}` : ''} onChange={(event) => setValue('fixedPriceAmount', Number(event.target.value))} placeholder="Amount" />
          <Input value={typeof values.fixedPriceCurrencyCode === 'string' ? values.fixedPriceCurrencyCode : ''} onChange={(event) => setValue('fixedPriceCurrencyCode', event.target.value.toUpperCase())} placeholder="Currency" />
          <Input type="number" value={typeof values.fixedPriceOriginalAmount === 'number' || typeof values.fixedPriceOriginalAmount === 'string' ? `${values.fixedPriceOriginalAmount}` : ''} onChange={(event) => setValue('fixedPriceOriginalAmount', Number(event.target.value))} placeholder="Original amount" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={values.fixedPriceIncludesTax !== false} onChange={(event) => setValue('fixedPriceIncludesTax', event.target.checked)} />
            Price includes tax
          </label>
        </div>
      ) : null}
      {pricingMode === 'custom_amount' ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Input type="number" value={typeof values.customAmountMin === 'number' || typeof values.customAmountMin === 'string' ? `${values.customAmountMin}` : ''} onChange={(event) => setValue('customAmountMin', Number(event.target.value))} placeholder="Minimum" />
          <Input type="number" value={typeof values.customAmountMax === 'number' || typeof values.customAmountMax === 'string' ? `${values.customAmountMax}` : ''} onChange={(event) => setValue('customAmountMax', Number(event.target.value))} placeholder="Maximum" />
          <Input value={typeof values.customAmountCurrencyCode === 'string' ? values.customAmountCurrencyCode : ''} onChange={(event) => setValue('customAmountCurrencyCode', event.target.value.toUpperCase())} placeholder="Currency" />
        </div>
      ) : null}
      {pricingMode === 'price_list' ? (
        <PriceListEditor
          value={Array.isArray(values.priceListItems) ? values.priceListItems as Array<{ id: string; description: string; amount: number; currencyCode: string }> : []}
          onChange={(next) => setValue('priceListItems', next)}
        />
      ) : null}
    </div>
  )
}

export function LinkTemplateForm({ mode, recordId }: Props) {
  const searchParams = useSearchParams()
  const entityId = mode === 'link' ? CHECKOUT_ENTITY_IDS.link : CHECKOUT_ENTITY_IDS.template
  const templateId = React.useMemo(() => {
    const raw = searchParams.get('templateId')
    return raw && raw.trim().length > 0 ? raw : null
  }, [searchParams])
  const [providers, setProviders] = React.useState<ProviderDescriptor[]>([])
  const [initialValues, setInitialValues] = React.useState<FormValues | null>(recordId ? null : {
    name: '',
    title: '',
    subtitle: '',
    description: '',
    slug: '',
    pricingMode: 'fixed',
    fixedPriceIncludesTax: true,
    displayCustomFieldsOnPage: false,
    gatewayProviderKey: '',
    gatewaySettings: {},
    customerFieldsSchema: [...DEFAULT_CHECKOUT_CUSTOMER_FIELDS],
    legalDocuments: {
      terms: { title: '', markdown: '', required: false },
      privacyPolicy: { title: '', markdown: '', required: false },
    },
    status: 'draft',
  })

  React.useEffect(() => {
    let active = true
    void readApiResultOrThrow<{ items: ProviderDescriptor[] }>('/api/payment_gateways/providers')
      .then((result) => {
        if (active) {
          setProviders(Array.isArray(result.items) ? result.items : [])
        }
      })
      .catch(() => {
        if (active) setProviders([])
      })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    if (!recordId) return
    let active = true
    void readApiResultOrThrow<FormValues>(`/api/checkout/${mode === 'link' ? 'links' : 'templates'}/${encodeURIComponent(recordId)}`)
      .then((result) => {
        if (active) setInitialValues(result)
      })
      .catch(() => {
        if (active) setInitialValues({})
      })
    return () => { active = false }
  }, [mode, recordId])

  React.useEffect(() => {
    if (recordId || mode !== 'link' || !templateId) return
    let active = true
    void readApiResultOrThrow<FormValues>(`/api/checkout/templates/${encodeURIComponent(templateId)}`)
      .then((result) => {
        if (!active) return
        setInitialValues((current) => ({
          ...(current ?? {}),
          ...result,
          slug: '',
          templateId,
        }))
      })
      .catch(() => null)
    return () => { active = false }
  }, [mode, recordId, templateId])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: 'Name', type: 'text', required: true, placeholder: 'January consulting session' },
    { id: 'title', label: 'Title', type: 'text', placeholder: 'Consulting session payment' },
    { id: 'subtitle', label: 'Subtitle', type: 'text', placeholder: 'One-hour strategy consultation' },
    { id: 'description', label: 'Description', type: 'textarea', placeholder: 'Supports markdown formatting.' },
    {
      id: 'slug',
      label: 'Slug',
      type: 'custom',
      component: ({ value, values, setValue }) => {
        const rawValue = typeof value === 'string' ? value : ''
        const currentValues = values ?? {}
        const fallbackSlug = slugify(
          typeof currentValues.title === 'string' && currentValues.title.trim().length > 0
            ? currentValues.title
            : typeof currentValues.name === 'string'
              ? currentValues.name
              : '',
        )
        const resolvedSlug = rawValue.trim() || fallbackSlug || 'pay-link'
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input value={rawValue} onChange={(event) => setValue(event.target.value)} placeholder="january-consulting" />
              <Button type="button" variant="outline" onClick={() => setValue(fallbackSlug || 'pay-link')}>Generate</Button>
            </div>
            <p className="text-xs text-muted-foreground">Preview: `/pay/{resolvedSlug}`</p>
          </div>
        )
      },
    },
    { id: 'logoUrl', label: 'Logo URL', type: 'text', placeholder: 'https://example.com/logo.png' },
    { id: 'primaryColor', label: 'Primary color', type: 'text', placeholder: '#1E3A8A' },
    { id: 'secondaryColor', label: 'Secondary color', type: 'text', placeholder: '#F59E0B' },
    { id: 'backgroundColor', label: 'Background color', type: 'text', placeholder: '#F8F4EE' },
    {
      id: 'themeMode',
      label: 'Theme mode',
      type: 'select',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
    },
    { id: 'displayCustomFieldsOnPage', label: 'Show custom fields on page', type: 'checkbox' },
    {
      id: 'status',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ],
    },
    { id: 'maxCompletions', label: 'Max completions', type: 'number', placeholder: 'Leave empty for unlimited' },
    { id: 'password', label: 'Password', type: 'password' },
    { id: 'successTitle', label: 'Success title', type: 'text' },
    { id: 'successMessage', label: 'Success message', type: 'textarea' },
    { id: 'cancelTitle', label: 'Cancel title', type: 'text' },
    { id: 'cancelMessage', label: 'Cancel message', type: 'textarea' },
    { id: 'errorTitle', label: 'Error title', type: 'text' },
    { id: 'errorMessage', label: 'Error message', type: 'textarea' },
    { id: 'startEmailSubject', label: 'Start email subject', type: 'text' },
    { id: 'startEmailBody', label: 'Start email body', type: 'textarea' },
    { id: 'successEmailSubject', label: 'Success email subject', type: 'text' },
    { id: 'successEmailBody', label: 'Success email body', type: 'textarea' },
    { id: 'errorEmailSubject', label: 'Error email subject', type: 'text' },
    { id: 'errorEmailBody', label: 'Error email body', type: 'textarea' },
  ], [])

  const groups: CrudFormGroup[] = [
    { id: 'general', title: 'General', column: 1, fields: mode === 'link' ? ['name', 'title', 'subtitle', 'description', 'slug'] : ['name', 'title', 'subtitle', 'description'] },
    { id: 'appearance', title: 'Appearance', column: 2, fields: ['logoUrl', 'primaryColor', 'secondaryColor', 'backgroundColor', 'themeMode', 'displayCustomFieldsOnPage'] },
    { id: 'pricing', title: 'Pricing', column: 1, component: ({ values, setValue }) => <PricingSection values={values} setValue={setValue} /> },
    {
      id: 'payment',
      title: 'Payment',
      column: 2,
      component: ({ values, setValue }) => (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Gateway provider</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={typeof values.gatewayProviderKey === 'string' ? values.gatewayProviderKey : ''}
              onChange={(event) => setValue('gatewayProviderKey', event.target.value)}
            >
              <option value="">Select a provider…</option>
              {providers.map((provider) => (
                <option key={provider.providerKey} value={provider.providerKey}>{provider.label}</option>
              ))}
            </select>
          </div>
          <GatewaySettingsFields
            providerKey={typeof values.gatewayProviderKey === 'string' ? values.gatewayProviderKey : null}
            value={values.gatewaySettings as Record<string, unknown> | undefined}
            onChange={(next) => setValue('gatewaySettings', next)}
          />
        </div>
      ),
    },
    {
      id: 'customerFields',
      title: 'Customer fields',
      column: 1,
      component: ({ values, setValue }) => (
        <CustomerFieldsEditor value={Array.isArray(values.customerFieldsSchema) ? values.customerFieldsSchema as any[] : []} onChange={(next) => setValue('customerFieldsSchema', next)} />
      ),
    },
    {
      id: 'legal',
      title: 'Legal',
      column: 1,
      component: ({ values, setValue }) => {
        const legalDocuments = (values.legalDocuments as Record<string, { title?: string; markdown?: string; required?: boolean }> | undefined) ?? {}
        const patchDocument = (key: 'terms' | 'privacyPolicy', patch: Record<string, unknown>) => {
          setValue('legalDocuments', {
            ...legalDocuments,
            [key]: {
              ...(legalDocuments[key] ?? {}),
              ...patch,
            },
          })
        }
        return (
          <div className="space-y-4">
            {(['terms', 'privacyPolicy'] as const).map((key) => (
              <div key={key} className="space-y-3 rounded-lg border p-4">
                <Input value={legalDocuments[key]?.title ?? ''} onChange={(event) => patchDocument(key, { title: event.target.value })} placeholder={`${key} title`} />
                <Textarea value={legalDocuments[key]?.markdown ?? ''} onChange={(event) => patchDocument(key, { markdown: event.target.value })} placeholder="Markdown body" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={legalDocuments[key]?.required === true} onChange={(event) => patchDocument(key, { required: event.target.checked })} />
                  Acceptance required
                </label>
              </div>
            ))}
          </div>
        )
      },
    },
    { id: 'settings', title: 'Settings', column: 2, fields: ['status', 'maxCompletions', 'password'] },
    { id: 'messages', title: 'Messages', column: 1, fields: ['successTitle', 'successMessage', 'cancelTitle', 'cancelMessage', 'errorTitle', 'errorMessage'] },
    { id: 'emails', title: 'Emails', column: 1, fields: ['startEmailSubject', 'startEmailBody', 'successEmailSubject', 'successEmailBody', 'errorEmailSubject', 'errorEmailBody'] },
    { id: 'customFields', title: 'Custom fields', column: 2, kind: 'customFields' },
  ]

  return (
    <Page>
      <PageBody>
        {initialValues ? (
          <CrudForm<FormValues>
          title={recordId ? `Edit ${mode === 'link' ? 'Pay Link' : 'Template'}` : `Create ${mode === 'link' ? 'Pay Link' : 'Template'}`}
          backHref={mode === 'link' ? '/backend/checkout/pay-links' : '/backend/checkout/templates'}
          cancelHref={mode === 'link' ? '/backend/checkout/pay-links' : '/backend/checkout/templates'}
          fields={fields}
          groups={groups}
            extraActions={recordId ? (
              <Button asChild type="button" variant="outline">
                <a
                  href={mode === 'link'
                    ? `/pay/${encodeURIComponent(String(initialValues.slug ?? ''))}?preview=true`
                    : `/backend/checkout/templates/${encodeURIComponent(recordId)}/preview`}
                  target={mode === 'link' ? '_blank' : undefined}
                  rel={mode === 'link' ? 'noreferrer' : undefined}
                >
                  Preview
                </a>
              </Button>
            ) : null}
            entityId={entityId}
            initialValues={initialValues}
            deleteVisible={Boolean(recordId)}
            onSubmit={async (values) => {
              const payload = { ...values, customFields: collectCustomFieldValues(values) }
              await apiCallOrThrow(`/api/checkout/${mode === 'link' ? 'links' : 'templates'}${recordId ? `/${encodeURIComponent(recordId)}` : ''}`, {
                method: recordId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              })
              window.location.href = mode === 'link'
                ? '/backend/checkout/pay-links?flash=Saved&type=success'
                : '/backend/checkout/templates?flash=Saved&type=success'
            }}
            onDelete={recordId ? async () => {
              await apiCallOrThrow(`/api/checkout/${mode === 'link' ? 'links' : 'templates'}/${encodeURIComponent(recordId)}`, { method: 'DELETE' })
              window.location.href = mode === 'link'
                ? '/backend/checkout/pay-links?flash=Deleted&type=success'
                : '/backend/checkout/templates?flash=Deleted&type=success'
            } : undefined}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}

export default LinkTemplateForm
