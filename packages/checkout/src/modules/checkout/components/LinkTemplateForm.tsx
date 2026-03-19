"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import {
  CircleDollarSign,
  Eye,
  FileCheck2,
  FileText,
  IdCard,
  Mail,
  MessageSquare,
  Plus,
  Shield,
  Sparkles,
  Trash2,
  WalletCards,
} from 'lucide-react'
import { slugify } from '@open-mercato/shared/lib/slugify'
import { CrudForm, type CrudField, type CrudFormGroup, type CrudFormGroupComponentProps } from '@open-mercato/ui/backend/CrudForm'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SwitchableMarkdownInput } from '@open-mercato/ui/backend/inputs'
import { apiCall, apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import type { CustomerFieldDefinitionInput, PriceListItemInput } from '../data/validators'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../setup'
import { CheckoutCurrencySelect } from './CheckoutCurrencySelect'
import { CustomerFieldsEditor } from './CustomerFieldsEditor'
import { GatewaySettingsFields } from './GatewaySettingsFields'
import { LogoUploadField } from './LogoUploadField'

type Props = {
  mode: 'link' | 'template'
  recordId?: string
}

type FormValues = Record<string, unknown>

type ProviderDescriptor = {
  providerKey: string
  label: string
}

type LegalDocumentValue = {
  title: string
  markdown: string
  required: boolean
}

type LegalDocumentsValue = {
  terms: LegalDocumentValue
  privacyPolicy: LegalDocumentValue
}

type PriceListItem = PriceListItemInput

const DEFAULT_COLORS = {
  primaryColor: '#1E3A8A',
  secondaryColor: '#F59E0B',
  backgroundColor: '#F8F4EE',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumberInputValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string') return value
  return ''
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function cloneDefaultCustomerFields(): CustomerFieldDefinitionInput[] {
  return DEFAULT_CHECKOUT_CUSTOMER_FIELDS.map((field) => ({
    ...field,
    placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
  }))
}

function createDefaultLegalDocuments(): LegalDocumentsValue {
  return {
    terms: { title: '', markdown: '', required: false },
    privacyPolicy: { title: '', markdown: '', required: false },
  }
}

function createDefaultValues(): FormValues {
  return {
    name: '',
    title: '',
    subtitle: '',
    description: '',
    slug: '',
    logoAttachmentId: null,
    logoUrl: null,
    ...DEFAULT_COLORS,
    themeMode: 'auto',
    displayCustomFieldsOnPage: false,
    pricingMode: 'fixed',
    fixedPriceAmount: null,
    fixedPriceCurrencyCode: 'USD',
    fixedPriceIncludesTax: true,
    fixedPriceOriginalAmount: null,
    customAmountMin: null,
    customAmountMax: null,
    customAmountCurrencyCode: 'USD',
    priceListItems: [],
    gatewayProviderKey: '',
    gatewaySettings: {},
    collectCustomerDetails: true,
    customerFieldsSchema: cloneDefaultCustomerFields(),
    legalDocuments: createDefaultLegalDocuments(),
    status: 'draft',
    maxCompletions: null,
    password: '',
    successTitle: '',
    successMessage: '',
    cancelTitle: '',
    cancelMessage: '',
    errorTitle: '',
    errorMessage: '',
    startEmailSubject: '',
    startEmailBody: '',
    sendStartEmail: true,
    successEmailSubject: '',
    successEmailBody: '',
    sendSuccessEmail: true,
    errorEmailSubject: '',
    errorEmailBody: '',
    sendErrorEmail: true,
  }
}

function normalizePriceListItems(value: unknown): PriceListItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!isRecord(item)) return null
      const id = readString(item.id).trim()
      const description = readString(item.description)
      const amount = Number(item.amount ?? 0)
      const currencyCode = readString(item.currencyCode).trim().toUpperCase()
      return {
        id: id || `item_${Date.now()}`,
        description,
        amount: Number.isFinite(amount) ? amount : 0,
        currencyCode: currencyCode || 'USD',
      }
    })
    .filter((item): item is PriceListItem => item !== null)
}

function normalizeCustomerFields(value: unknown): CustomerFieldDefinitionInput[] {
  if (!Array.isArray(value)) return cloneDefaultCustomerFields()
  return value.reduce<CustomerFieldDefinitionInput[]>((result, field, index) => {
    if (!isRecord(field)) return result
    const key = readString(field.key).trim()
    const label = readString(field.label).trim()
    const kind = readString(field.kind)
    if (!key || !label) return result
    if (!['text', 'multiline', 'boolean', 'select', 'radio'].includes(kind)) return result
    const options = Array.isArray(field.options)
      ? field.options.reduce<Array<{ value: string; label: string }>>((optionResult, option) => {
          if (!isRecord(option)) return optionResult
          const valuePart = readString(option.value).trim()
          const labelPart = readString(option.label).trim()
          if (!valuePart || !labelPart) return optionResult
          optionResult.push({ value: valuePart, label: labelPart })
          return optionResult
        }, [])
      : []
    result.push({
      key,
      label,
      kind: kind as CustomerFieldDefinitionInput['kind'],
      required: readBoolean(field.required),
      fixed: readBoolean(field.fixed),
      placeholder: readString(field.placeholder).trim() || undefined,
      options,
      sortOrder: typeof field.sortOrder === 'number' ? field.sortOrder : index,
    })
    return result
  }, [])
}

function normalizeLegalDocuments(value: unknown): LegalDocumentsValue {
  const defaults = createDefaultLegalDocuments()
  if (!isRecord(value)) return defaults
  const normalizeDocument = (raw: unknown, fallback: LegalDocumentValue): LegalDocumentValue => {
    if (!isRecord(raw)) return fallback
    return {
      title: readString(raw.title),
      markdown: readString(raw.markdown),
      required: readBoolean(raw.required),
    }
  }
  return {
    terms: normalizeDocument(value.terms, defaults.terms),
    privacyPolicy: normalizeDocument(value.privacyPolicy, defaults.privacyPolicy),
  }
}

function normalizeFormValues(value: FormValues | null | undefined): FormValues {
  const defaults = createDefaultValues()
  const source = isRecord(value) ? value : {}
  return {
    ...defaults,
    ...source,
    logoAttachmentId: readString(source.logoAttachmentId).trim() || null,
    logoUrl: readString(source.logoUrl).trim() || null,
    primaryColor: readString(source.primaryColor).trim() || defaults.primaryColor,
    secondaryColor: readString(source.secondaryColor).trim() || defaults.secondaryColor,
    backgroundColor: readString(source.backgroundColor).trim() || defaults.backgroundColor,
    gatewaySettings: isRecord(source.gatewaySettings) ? source.gatewaySettings : {},
    collectCustomerDetails: readBoolean(source.collectCustomerDetails, true),
    customerFieldsSchema: normalizeCustomerFields(source.customerFieldsSchema),
    legalDocuments: normalizeLegalDocuments(source.legalDocuments),
    priceListItems: normalizePriceListItems(source.priceListItems),
    fixedPriceCurrencyCode: readString(source.fixedPriceCurrencyCode).trim().toUpperCase() || 'USD',
    customAmountCurrencyCode: readString(source.customAmountCurrencyCode).trim().toUpperCase() || 'USD',
    sendStartEmail: readBoolean(source.sendStartEmail, true),
    sendSuccessEmail: readBoolean(source.sendSuccessEmail, true),
    sendErrorEmail: readBoolean(source.sendErrorEmail, true),
  }
}

function SectionLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label>{label}</Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  const pickerValue = /^#([0-9a-fA-F]{6})$/.test(value) ? value : '#000000'
  return (
    <SectionLabel label={label}>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={pickerValue}
          className="h-10 w-12 cursor-pointer rounded-md border bg-transparent p-1"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          placeholder="#1E3A8A"
        />
      </div>
    </SectionLabel>
  )
}

function PriceListEditor({
  value,
  onChange,
}: {
  value: PriceListItem[]
  onChange: (next: PriceListItem[]) => void
}) {
  const items = Array.isArray(value) ? value : []

  const updateItem = React.useCallback(
    (index: number, patch: Partial<PriceListItem>) => {
      onChange(items.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)))
    },
    [items, onChange],
  )

  const addItem = React.useCallback(() => {
    onChange([
      ...items,
      {
        id: `item_${items.length + 1}`,
        description: '',
        amount: 0,
        currencyCode: items[0]?.currencyCode ?? 'USD',
      },
    ])
  }, [items, onChange])

  return (
    <div className="space-y-4">
      <Notice compact>
        Keep all price-list items in the same currency. The first currency becomes the default for new rows.
      </Notice>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
        <div className="hidden grid-cols-[1fr_1.6fr_140px_220px_120px] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
          <div>Item code</div>
          <div>Description</div>
          <div>Amount</div>
          <div>Currency</div>
          <div className="text-right">Actions</div>
        </div>

        {items.length > 0 ? (
          <div className="divide-y divide-border/70">
            {items.map((item, index) => (
              <div key={`${item.id}:${index}`} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_1.6fr_140px_220px_120px] md:items-center">
                <SectionLabel label="Item code">
                  <Input
                    value={item.id}
                    onChange={(event) => updateItem(index, { id: event.target.value })}
                    placeholder="starter"
                  />
                </SectionLabel>
                <SectionLabel label="Description">
                  <Input
                    value={item.description}
                    onChange={(event) => updateItem(index, { description: event.target.value })}
                    placeholder="Starter package"
                  />
                </SectionLabel>
                <SectionLabel label="Amount">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.amount}
                    onChange={(event) => updateItem(index, { amount: Number(event.target.value) })}
                    placeholder="0.00"
                  />
                </SectionLabel>
                <SectionLabel label="Currency">
                  <CheckoutCurrencySelect
                    value={item.currencyCode}
                    onChange={(next) => updateItem(index, { currencyCode: next })}
                    placeholder="Select currency"
                  />
                </SectionLabel>
                <div className="flex items-end justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange(items.filter((_, currentIndex) => currentIndex !== index))}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8">
            <Notice compact>
              No price-list items yet. Add at least one item to let customers pick from multiple price points.
            </Notice>
          </div>
        )}
      </div>

      <Button type="button" variant="outline" onClick={addItem}>
        <Plus className="mr-2 h-4 w-4" />
        Add item
      </Button>
    </div>
  )
}

function PricingSection({ values, setValue }: CrudFormGroupComponentProps) {
  const pricingMode = readString(values.pricingMode) || 'fixed'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'fixed', label: 'Fixed price', icon: CircleDollarSign },
          { id: 'custom_amount', label: 'Customer enters amount', icon: WalletCards },
          { id: 'price_list', label: 'Price list', icon: FileText },
        ].map((mode) => {
          const Icon = mode.icon
          const active = pricingMode === mode.id
          return (
            <Button
              key={mode.id}
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              onClick={() => setValue('pricingMode', mode.id)}
            >
              <Icon className="mr-2 h-4 w-4" />
              {mode.label}
            </Button>
          )
        })}
      </div>

      {pricingMode === 'fixed' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <SectionLabel label="Amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={readNumberInputValue(values.fixedPriceAmount)}
              onChange={(event) => setValue('fixedPriceAmount', Number(event.target.value))}
              placeholder="150"
            />
          </SectionLabel>

          <SectionLabel label="Currency">
            <CheckoutCurrencySelect
              value={readString(values.fixedPriceCurrencyCode) || 'USD'}
              onChange={(next) => setValue('fixedPriceCurrencyCode', next)}
              placeholder="Select currency"
            />
          </SectionLabel>

          <SectionLabel
            label="Compare-at price"
            hint="Optional crossed-out amount shown above the current price."
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              value={readNumberInputValue(values.fixedPriceOriginalAmount)}
              onChange={(event) => setValue('fixedPriceOriginalAmount', Number(event.target.value))}
              placeholder="200"
            />
          </SectionLabel>

          <div className="flex items-end">
            <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={readBoolean(values.fixedPriceIncludesTax, true)}
                onChange={(event) => setValue('fixedPriceIncludesTax', event.target.checked)}
              />
              Price already includes tax
            </label>
          </div>
        </div>
      ) : null}

      {pricingMode === 'custom_amount' ? (
        <div className="grid gap-4 md:grid-cols-3">
          <SectionLabel label="Minimum amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={readNumberInputValue(values.customAmountMin)}
              onChange={(event) => setValue('customAmountMin', Number(event.target.value))}
              placeholder="10"
            />
          </SectionLabel>

          <SectionLabel label="Maximum amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={readNumberInputValue(values.customAmountMax)}
              onChange={(event) => setValue('customAmountMax', Number(event.target.value))}
              placeholder="500"
            />
          </SectionLabel>

          <SectionLabel label="Currency">
            <CheckoutCurrencySelect
              value={readString(values.customAmountCurrencyCode) || 'USD'}
              onChange={(next) => setValue('customAmountCurrencyCode', next)}
              placeholder="Select currency"
            />
          </SectionLabel>
        </div>
      ) : null}

      {pricingMode === 'price_list' ? (
        <PriceListEditor
          value={normalizePriceListItems(values.priceListItems)}
          onChange={(next) => setValue('priceListItems', next)}
        />
      ) : null}
    </div>
  )
}

function GeneralSection({ values, setValue, mode }: CrudFormGroupComponentProps & { mode: 'link' | 'template' }) {
  const fallbackSlug = slugify(
    readString(values.title).trim().length > 0
      ? readString(values.title)
      : readString(values.name),
  ) || 'pay-link'
  const currentSlug = readString(values.slug)
  const resolvedSlug = currentSlug.trim() || fallbackSlug

  return (
    <div className="space-y-4">
      <SectionLabel label="Name">
        <Input
          value={readString(values.name)}
          onChange={(event) => setValue('name', event.target.value)}
          placeholder="January consulting session"
        />
      </SectionLabel>

      <SectionLabel label="Title">
        <Input
          value={readString(values.title)}
          onChange={(event) => setValue('title', event.target.value)}
          placeholder="Consulting session payment"
        />
      </SectionLabel>

      <SectionLabel label="Subtitle">
        <Input
          value={readString(values.subtitle)}
          onChange={(event) => setValue('subtitle', event.target.value)}
          placeholder="One-hour strategy consultation"
        />
      </SectionLabel>

      <SectionLabel label="Description" hint="Markdown is supported on the public page preview.">
        <SwitchableMarkdownInput
          value={readString(values.description)}
          onChange={(next) => setValue('description', next)}
          isMarkdownEnabled
          height={220}
          placeholder={'# What is included\n- 60 minute strategy call\n- Summary after the call'}
        />
      </SectionLabel>

      {mode === 'link' ? (
        <SectionLabel label="Slug" hint="This becomes the public pay-link URL.">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={currentSlug}
                onChange={(event) => setValue('slug', event.target.value)}
                placeholder="january-consulting"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setValue('slug', fallbackSlug)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Preview: `/pay/{resolvedSlug}`</p>
          </div>
        </SectionLabel>
      ) : null}
    </div>
  )
}

function AppearanceSection({
  values,
  setValue,
  entityId,
  attachmentRecordId,
}: CrudFormGroupComponentProps & { entityId: string; attachmentRecordId: string }) {
  return (
    <div className="space-y-4">
      <LogoUploadField
        entityId={entityId}
        recordId={attachmentRecordId}
        attachmentId={readString(values.logoAttachmentId) || null}
        logoUrl={readString(values.logoUrl) || null}
        onChange={(next) => {
          setValue('logoAttachmentId', next.logoAttachmentId)
          setValue('logoUrl', next.logoUrl)
        }}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <ColorField
          label="Primary color"
          value={readString(values.primaryColor) || DEFAULT_COLORS.primaryColor}
          onChange={(next) => setValue('primaryColor', next)}
        />
        <ColorField
          label="Secondary color"
          value={readString(values.secondaryColor) || DEFAULT_COLORS.secondaryColor}
          onChange={(next) => setValue('secondaryColor', next)}
        />
        <ColorField
          label="Background color"
          value={readString(values.backgroundColor) || DEFAULT_COLORS.backgroundColor}
          onChange={(next) => setValue('backgroundColor', next)}
        />
      </div>

      <SectionLabel label="Theme mode">
        <select
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={readString(values.themeMode) || 'auto'}
          onChange={(event) => setValue('themeMode', event.target.value)}
        >
          <option value="auto">Auto</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </SectionLabel>

      <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={readBoolean(values.displayCustomFieldsOnPage)}
          onChange={(event) => setValue('displayCustomFieldsOnPage', event.target.checked)}
        />
        Show custom fields on the public page
      </label>
    </div>
  )
}

function PaymentSection({ values, setValue, providers }: CrudFormGroupComponentProps & { providers: ProviderDescriptor[] }) {
  return (
    <div className="space-y-4">
      <SectionLabel label="Gateway provider">
        <select
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={readString(values.gatewayProviderKey)}
          onChange={(event) => setValue('gatewayProviderKey', event.target.value)}
        >
          <option value="">Select a provider…</option>
          {providers.map((provider) => (
            <option key={provider.providerKey} value={provider.providerKey}>
              {provider.label}
            </option>
          ))}
        </select>
      </SectionLabel>

      <GatewaySettingsFields
        providerKey={readString(values.gatewayProviderKey) || null}
        value={isRecord(values.gatewaySettings) ? values.gatewaySettings : {}}
        onChange={(next) => setValue('gatewaySettings', next)}
      />
    </div>
  )
}

function CustomerDetailsSection({ values, setValue }: CrudFormGroupComponentProps) {
  const collectCustomerDetails = readBoolean(values.collectCustomerDetails, true)

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm">
        <input
          type="checkbox"
          checked={collectCustomerDetails}
          onChange={(event) => setValue('collectCustomerDetails', event.target.checked)}
        />
        <span className="space-y-1">
          <span className="flex items-center gap-2 font-medium">
            <IdCard className="h-4 w-4" />
            Collect customer details
          </span>
          <span className="block text-muted-foreground">
            Recommended: collect at least the customer email for receipts, fraud review, and payment dispute safety. It is not required.
          </span>
        </span>
      </label>

      {collectCustomerDetails ? (
        <>
          <Notice compact>
            Turn this off to make the page a simple pay link with no customer form.
          </Notice>
          <CustomerFieldsEditor
            value={normalizeCustomerFields(values.customerFieldsSchema)}
            onChange={(next) => setValue('customerFieldsSchema', next)}
          />
        </>
      ) : (
        <Notice compact>
          Customer details are disabled. Buyers will only see the payment section and any legal consent checkboxes.
        </Notice>
      )}
    </div>
  )
}

function LegalSection({ values, setValue }: CrudFormGroupComponentProps) {
  const [tab, setTab] = React.useState<'terms' | 'privacyPolicy'>('terms')
  const legalDocuments = normalizeLegalDocuments(values.legalDocuments)

  const patchDocument = React.useCallback(
    (key: 'terms' | 'privacyPolicy', patch: Partial<LegalDocumentValue>) => {
      setValue('legalDocuments', {
        ...legalDocuments,
        [key]: {
          ...legalDocuments[key],
          ...patch,
        },
      })
    },
    [legalDocuments, setValue],
  )

  return (
    <div className="space-y-4">
      <Notice compact>
        These tabs are shown around the legal consent step on the pay page. Use markdown for headings, lists, and links.
      </Notice>

      <Tabs value={tab} onValueChange={(next) => setTab(next as 'terms' | 'privacyPolicy')}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="terms">
            <Shield className="mr-2 h-4 w-4" />
            Terms
          </TabsTrigger>
          <TabsTrigger value="privacyPolicy">
            <FileCheck2 className="mr-2 h-4 w-4" />
            Privacy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="terms" className="space-y-4">
          <SectionLabel label="Terms title">
            <Input
              value={legalDocuments.terms.title}
              onChange={(event) => patchDocument('terms', { title: event.target.value })}
              placeholder="Terms and conditions"
            />
          </SectionLabel>
          <SectionLabel label="Terms body">
            <SwitchableMarkdownInput
              value={legalDocuments.terms.markdown}
              onChange={(next) => patchDocument('terms', { markdown: next })}
              isMarkdownEnabled
              height={220}
              placeholder={'# Terms\n\nDescribe the rules customers accept before paying.'}
            />
          </SectionLabel>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={legalDocuments.terms.required}
              onChange={(event) => patchDocument('terms', { required: event.target.checked })}
            />
            Acceptance required
          </label>
        </TabsContent>

        <TabsContent value="privacyPolicy" className="space-y-4">
          <SectionLabel label="Privacy title">
            <Input
              value={legalDocuments.privacyPolicy.title}
              onChange={(event) => patchDocument('privacyPolicy', { title: event.target.value })}
              placeholder="Privacy policy"
            />
          </SectionLabel>
          <SectionLabel label="Privacy body">
            <SwitchableMarkdownInput
              value={legalDocuments.privacyPolicy.markdown}
              onChange={(next) => patchDocument('privacyPolicy', { markdown: next })}
              isMarkdownEnabled
              height={220}
              placeholder={'# Privacy\n\nExplain what personal data you collect and why.'}
            />
          </SectionLabel>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={legalDocuments.privacyPolicy.required}
              onChange={(event) => patchDocument('privacyPolicy', { required: event.target.checked })}
            />
            Acceptance required
          </label>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function MessagesSection({ values, setValue }: CrudFormGroupComponentProps) {
  const [tab, setTab] = React.useState<'success' | 'cancel' | 'error'>('success')

  const config = {
    success: {
      titleKey: 'successTitle',
      bodyKey: 'successMessage',
      titlePlaceholder: 'Payment completed',
      bodyPlaceholder: 'Thanks for your payment. We are processing it now.',
      label: 'Success',
    },
    cancel: {
      titleKey: 'cancelTitle',
      bodyKey: 'cancelMessage',
      titlePlaceholder: 'Payment cancelled',
      bodyPlaceholder: 'The payment was cancelled before it was completed.',
      label: 'Cancel',
    },
    error: {
      titleKey: 'errorTitle',
      bodyKey: 'errorMessage',
      titlePlaceholder: 'Payment failed',
      bodyPlaceholder: 'We could not complete the payment. Please try again.',
      label: 'Error',
    },
  } as const

  return (
    <div className="space-y-4">
      <Notice compact>
        These messages are shown on the public success, cancel, and error states. Markdown is supported in the body.
      </Notice>

      <Tabs value={tab} onValueChange={(next) => setTab(next as 'success' | 'cancel' | 'error')}>
        <TabsList className="w-full justify-start">
          {(['success', 'cancel', 'error'] as const).map((item) => (
            <TabsTrigger key={item} value={item}>
              <MessageSquare className="mr-2 h-4 w-4" />
              {config[item].label}
            </TabsTrigger>
          ))}
        </TabsList>

        {(['success', 'cancel', 'error'] as const).map((item) => (
          <TabsContent key={item} value={item} className="space-y-4">
            <SectionLabel label={`${config[item].label} title`}>
              <Input
                value={readString(values[config[item].titleKey])}
                onChange={(event) => setValue(config[item].titleKey, event.target.value)}
                placeholder={config[item].titlePlaceholder}
              />
            </SectionLabel>
            <SectionLabel label={`${config[item].label} message`}>
              <SwitchableMarkdownInput
                value={readString(values[config[item].bodyKey])}
                onChange={(next) => setValue(config[item].bodyKey, next)}
                isMarkdownEnabled
                height={220}
                placeholder={config[item].bodyPlaceholder}
              />
            </SectionLabel>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function VariableHint() {
  const variables = ['{{firstName}}', '{{amount}}', '{{currencyCode}}', '{{linkTitle}}', '{{transactionId}}', '{{errorMessage}}']
  return (
    <div className="flex flex-wrap gap-2">
      {variables.map((variable) => (
        <span
          key={variable}
          className="rounded-full border border-border/70 bg-background px-2 py-1 text-xs text-muted-foreground"
        >
          {variable}
        </span>
      ))}
    </div>
  )
}

function EmailsSection({ values, setValue }: CrudFormGroupComponentProps) {
  const [tab, setTab] = React.useState<'start' | 'success' | 'error'>('start')

  const config = {
    start: {
      enabledKey: 'sendStartEmail',
      subjectKey: 'startEmailSubject',
      bodyKey: 'startEmailBody',
      title: 'Started',
      subjectPlaceholder: 'Payment started — {{linkTitle}}',
      bodyPlaceholder: 'Hi {{firstName}}, we started processing your payment of **{{amount}} {{currencyCode}}**.',
    },
    success: {
      enabledKey: 'sendSuccessEmail',
      subjectKey: 'successEmailSubject',
      bodyKey: 'successEmailBody',
      title: 'Success',
      subjectPlaceholder: 'Payment successful — {{linkTitle}}',
      bodyPlaceholder: 'Hi {{firstName}}, your payment was successful. Reference: `{{transactionId}}`.',
    },
    error: {
      enabledKey: 'sendErrorEmail',
      subjectKey: 'errorEmailSubject',
      bodyKey: 'errorEmailBody',
      title: 'Error',
      subjectPlaceholder: 'Payment failed — {{linkTitle}}',
      bodyPlaceholder: 'Hi {{firstName}}, your payment could not be completed. {{errorMessage}}',
    },
  } as const

  return (
    <div className="space-y-4">
      <Notice compact>
        Email bodies support markdown and the variables below.
      </Notice>
      <VariableHint />

      <Tabs value={tab} onValueChange={(next) => setTab(next as 'start' | 'success' | 'error')}>
        <TabsList className="w-full justify-start">
          {(['start', 'success', 'error'] as const).map((item) => (
            <TabsTrigger key={item} value={item}>
              <Mail className="mr-2 h-4 w-4" />
              {config[item].title}
            </TabsTrigger>
          ))}
        </TabsList>

        {(['start', 'success', 'error'] as const).map((item) => (
          <TabsContent key={item} value={item} className="space-y-4">
            <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={readBoolean(values[config[item].enabledKey], true)}
                onChange={(event) => setValue(config[item].enabledKey, event.target.checked)}
              />
              Send this email to the customer
            </label>

            <SectionLabel label={`${config[item].title} email subject`}>
              <Input
                value={readString(values[config[item].subjectKey])}
                onChange={(event) => setValue(config[item].subjectKey, event.target.value)}
                placeholder={config[item].subjectPlaceholder}
              />
            </SectionLabel>

            <SectionLabel label={`${config[item].title} email body`}>
              <SwitchableMarkdownInput
                value={readString(values[config[item].bodyKey])}
                onChange={(next) => setValue(config[item].bodyKey, next)}
                isMarkdownEnabled
                height={220}
                placeholder={config[item].bodyPlaceholder}
              />
            </SectionLabel>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function SettingsSection({ values, setValue }: CrudFormGroupComponentProps) {
  const status = readString(values.status) || 'draft'

  return (
    <div className="space-y-4">
      <SectionLabel label="Status">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'draft', label: 'Draft' },
            { id: 'active', label: 'Active' },
            { id: 'inactive', label: 'Inactive' },
          ].map((option) => (
            <Button
              key={option.id}
              type="button"
              variant={status === option.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => setValue('status', option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </SectionLabel>

      <SectionLabel label="Max completions" hint="Leave empty if the link should stay reusable forever.">
        <Input
          type="number"
          min="1"
          step="1"
          value={readNumberInputValue(values.maxCompletions)}
          onChange={(event) => setValue('maxCompletions', event.target.value ? Number(event.target.value) : null)}
          placeholder="Unlimited"
        />
      </SectionLabel>

      <SectionLabel label="Password" hint="Optional password required before the pay page can be opened.">
        <Input
          type="password"
          value={readString(values.password)}
          onChange={(event) => setValue('password', event.target.value)}
          placeholder="Leave blank to keep the page public"
        />
      </SectionLabel>
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
  const attachmentDraftRecordId = React.useMemo(
    () => recordId ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `draft-${Date.now()}`),
    [recordId],
  )
  const initialLogoAttachmentIdRef = React.useRef<string | null>(null)
  const [providers, setProviders] = React.useState<ProviderDescriptor[]>([])
  const [initialValues, setInitialValues] = React.useState<FormValues | null>(
    recordId ? null : normalizeFormValues(createDefaultValues()),
  )

  React.useEffect(() => {
    initialLogoAttachmentIdRef.current = initialValues && typeof initialValues.logoAttachmentId === 'string'
      ? initialValues.logoAttachmentId
      : null
  }, [initialValues])

  React.useEffect(() => {
    let active = true
    void readApiResultOrThrow<{ items: ProviderDescriptor[] }>('/api/payment_gateways/providers')
      .then((result) => {
        if (!active) return
        setProviders(Array.isArray(result.items) ? result.items : [])
      })
      .catch(() => {
        if (active) setProviders([])
      })
    return () => {
      active = false
    }
  }, [])

  React.useEffect(() => {
    if (!recordId) return
    let active = true
    void readApiResultOrThrow<FormValues>(`/api/checkout/${mode === 'link' ? 'links' : 'templates'}/${encodeURIComponent(recordId)}`)
      .then((result) => {
        if (!active) return
        setInitialValues(normalizeFormValues(result))
      })
      .catch(() => {
        if (active) setInitialValues(normalizeFormValues({}))
      })
    return () => {
      active = false
    }
  }, [mode, recordId])

  React.useEffect(() => {
    if (recordId || mode !== 'link' || !templateId) return
    let active = true
    void readApiResultOrThrow<FormValues>(`/api/checkout/templates/${encodeURIComponent(templateId)}`)
      .then((result) => {
        if (!active) return
        setInitialValues(
          normalizeFormValues({
            ...result,
            slug: '',
            templateId,
          }),
        )
      })
      .catch(() => null)
    return () => {
      active = false
    }
  }, [mode, recordId, templateId])

  const fields = React.useMemo<CrudField[]>(() => [], [])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'general',
      title: 'General',
      column: 1,
      component: (ctx) => <GeneralSection {...ctx} mode={mode} />,
    },
    {
      id: 'appearance',
      title: 'Appearance',
      column: 2,
      component: (ctx) => (
        <AppearanceSection
          {...ctx}
          entityId={entityId}
          attachmentRecordId={attachmentDraftRecordId}
        />
      ),
    },
    {
      id: 'pricing',
      title: 'Pricing',
      column: 1,
      component: (ctx) => <PricingSection {...ctx} />,
    },
    {
      id: 'payment',
      title: 'Payment',
      column: 2,
      component: (ctx) => <PaymentSection {...ctx} providers={providers} />,
    },
    {
      id: 'customerFields',
      title: 'Customer fields',
      column: 1,
      component: (ctx) => <CustomerDetailsSection {...ctx} />,
    },
    {
      id: 'settings',
      title: 'Settings',
      column: 2,
      component: (ctx) => <SettingsSection {...ctx} />,
    },
    {
      id: 'legal',
      title: 'Legal',
      column: 1,
      component: (ctx) => <LegalSection {...ctx} />,
    },
    {
      id: 'messages',
      title: 'Messages',
      column: 1,
      component: (ctx) => <MessagesSection {...ctx} />,
    },
    {
      id: 'emails',
      title: 'Emails',
      column: 1,
      component: (ctx) => <EmailsSection {...ctx} />,
    },
    { id: 'customFields', title: 'Custom fields', column: 2, kind: 'customFields' },
  ], [attachmentDraftRecordId, entityId, mode, providers])

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
                    ? `/pay/${encodeURIComponent(readString(initialValues.slug))}?preview=true`
                    : `/backend/checkout/templates/${encodeURIComponent(recordId)}/preview`}
                  target={mode === 'link' ? '_blank' : undefined}
                  rel={mode === 'link' ? 'noreferrer' : undefined}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </a>
              </Button>
            ) : null}
            entityId={entityId}
            initialValues={initialValues}
            deleteVisible={Boolean(recordId)}
            onSubmit={async (values) => {
              const payload = { ...values, customFields: collectCustomFieldValues(values) }
              const endpoint = `/api/checkout/${mode === 'link' ? 'links' : 'templates'}${recordId ? `/${encodeURIComponent(recordId)}` : ''}`
              const response = await readApiResultOrThrow<{ id?: string; slug?: string; ok?: boolean }>(endpoint, {
                method: recordId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              })
              const targetId = recordId ?? (typeof response?.id === 'string' ? response.id : null)
              const logoAttachmentId = readString(values.logoAttachmentId)
              if (
                !recordId &&
                targetId &&
                logoAttachmentId &&
                logoAttachmentId !== initialLogoAttachmentIdRef.current
              ) {
                await apiCall('/api/attachments/transfer', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    entityId,
                    attachmentIds: [logoAttachmentId],
                    fromRecordId: attachmentDraftRecordId,
                    toRecordId: targetId,
                  }),
                })
              }
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
