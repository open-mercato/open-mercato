"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
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
import { getLocalizedDefaultCheckoutCustomerFields } from '../lib/defaults'
import type { CustomerFieldDefinitionInput, PriceListItemInput } from '../data/validators'
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

function cloneDefaultCustomerFields(t?: TranslateFn): CustomerFieldDefinitionInput[] {
  return getLocalizedDefaultCheckoutCustomerFields(t).map((field) => ({
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

function createDefaultValues(t?: TranslateFn): FormValues {
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
    customerFieldsSchema: cloneDefaultCustomerFields(t),
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

function normalizeCustomerFields(value: unknown, t?: TranslateFn): CustomerFieldDefinitionInput[] {
  if (!Array.isArray(value)) return cloneDefaultCustomerFields(t)
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

function readCustomerFields(value: unknown, t?: TranslateFn): CustomerFieldDefinitionInput[] {
  return Array.isArray(value) ? value as CustomerFieldDefinitionInput[] : cloneDefaultCustomerFields(t)
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

function normalizeFormValues(value: FormValues | null | undefined, t?: TranslateFn): FormValues {
  const defaults = createDefaultValues(t)
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
    customerFieldsSchema: normalizeCustomerFields(source.customerFieldsSchema, t),
    legalDocuments: normalizeLegalDocuments(source.legalDocuments),
    priceListItems: normalizePriceListItems(source.priceListItems),
    fixedPriceCurrencyCode: readString(source.fixedPriceCurrencyCode).trim().toUpperCase() || 'USD',
    customAmountCurrencyCode: readString(source.customAmountCurrencyCode).trim().toUpperCase() || 'USD',
    sendStartEmail: readBoolean(source.sendStartEmail, true),
    sendSuccessEmail: readBoolean(source.sendSuccessEmail, true),
    sendErrorEmail: readBoolean(source.sendErrorEmail, true),
  }
}

function readError(errors: Record<string, string>, path: string): string | undefined {
  if (!path) return undefined
  if (errors[path]) return errors[path]
  const prefix = `${path}.`
  const nestedEntry = Object.entries(errors).find(([key]) => key.startsWith(prefix))
  return nestedEntry?.[1]
}

function readAnyError(errors: Record<string, string>, ...paths: string[]): string | undefined {
  for (const path of paths) {
    const error = readError(errors, path)
    if (error) return error
  }
  return undefined
}

function errorInputClassName(error?: string): string | undefined {
  return error ? 'border-destructive focus-visible:ring-destructive/30' : undefined
}

function SectionLabel({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label>{label}</Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      {children}
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  error?: string
}) {
  const pickerValue = /^#([0-9a-fA-F]{6})$/.test(value) ? value : '#000000'
  return (
    <SectionLabel label={label} error={error}>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={pickerValue}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          placeholder="#1E3A8A"
          className={error ? `min-w-0 ${errorInputClassName(error)}` : 'min-w-0'}
          aria-invalid={Boolean(error)}
        />
      </div>
    </SectionLabel>
  )
}

function PriceListEditor({
  value,
  onChange,
  error,
}: {
  value: PriceListItem[]
  onChange: (next: PriceListItem[]) => void
  error?: string
}) {
  const t = useT()
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
        {t('checkout.linkTemplateForm.priceList.notices.singleCurrency')}
      </Notice>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-fixed">
              <thead className="border-b bg-muted/30">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 w-[22%]">{t('checkout.linkTemplateForm.priceList.columns.itemCode')}</th>
                  <th className="px-3 py-2">{t('checkout.linkTemplateForm.priceList.columns.description')}</th>
                  <th className="px-3 py-2 w-[16%]">{t('checkout.linkTemplateForm.priceList.columns.amount')}</th>
                  <th className="px-3 py-2 w-[24%]">{t('checkout.linkTemplateForm.priceList.columns.currency')}</th>
                  <th className="px-3 py-2 w-[110px] text-right">{t('checkout.linkTemplateForm.priceList.columns.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {items.map((item, index) => (
                  <tr key={`${item.id}:${index}`} className="align-top">
                    <td className="px-3 py-2">
                      <Input
                        value={item.id}
                        onChange={(event) => updateItem(index, { id: event.target.value })}
                        placeholder={t('checkout.linkTemplateForm.priceList.placeholders.itemCode')}
                        aria-label={t('checkout.linkTemplateForm.priceList.aria.itemCode', { index: index + 1 })}
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={item.description}
                        onChange={(event) => updateItem(index, { description: event.target.value })}
                        placeholder={t('checkout.linkTemplateForm.priceList.placeholders.description')}
                        aria-label={t('checkout.linkTemplateForm.priceList.aria.description', { index: index + 1 })}
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.amount}
                        onChange={(event) => updateItem(index, { amount: Number(event.target.value) })}
                        placeholder="0.00"
                        aria-label={t('checkout.linkTemplateForm.priceList.aria.amount', { index: index + 1 })}
                        className="h-8"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CheckoutCurrencySelect
                        value={item.currencyCode}
                        onChange={(next) => updateItem(index, { currencyCode: next })}
                        placeholder={t('checkout.currencySelect.placeholder')}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onChange(items.filter((_, currentIndex) => currentIndex !== index))}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('checkout.common.actions.remove')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-8">
            <Notice compact>
              {t('checkout.linkTemplateForm.priceList.notices.empty')}
            </Notice>
          </div>
        )}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addItem}>
        <Plus className="mr-2 h-4 w-4" />
        {t('checkout.linkTemplateForm.priceList.actions.addItem')}
      </Button>
    </div>
  )
}

function PricingSection({ values, setValue, errors }: CrudFormGroupComponentProps) {
  const t = useT()
  const pricingMode = readString(values.pricingMode) || 'fixed'
  const pricingModeError = readError(errors, 'pricingMode')
  const fixedPriceAmountError = readError(errors, 'fixedPriceAmount')
  const fixedPriceCurrencyError = readError(errors, 'fixedPriceCurrencyCode')
  const fixedPriceOriginalAmountError = readError(errors, 'fixedPriceOriginalAmount')
  const customAmountMinError = readError(errors, 'customAmountMin')
  const customAmountMaxError = readError(errors, 'customAmountMax')
  const customAmountCurrencyError = readError(errors, 'customAmountCurrencyCode')
  const priceListItemsError = readError(errors, 'priceListItems')

  return (
    <div className="space-y-4">
      {pricingModeError ? <p className="text-xs text-destructive">{pricingModeError}</p> : null}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'fixed', label: t('checkout.linkTemplateForm.pricing.modes.fixed'), icon: CircleDollarSign },
          { id: 'custom_amount', label: t('checkout.linkTemplateForm.pricing.modes.customAmount'), icon: WalletCards },
          { id: 'price_list', label: t('checkout.linkTemplateForm.pricing.modes.priceList'), icon: FileText },
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
          <SectionLabel label={t('checkout.linkTemplateForm.pricing.fields.amount')} error={fixedPriceAmountError}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={readNumberInputValue(values.fixedPriceAmount)}
              onChange={(event) => setValue('fixedPriceAmount', Number(event.target.value))}
              placeholder="150"
              className={errorInputClassName(fixedPriceAmountError)}
              aria-invalid={Boolean(fixedPriceAmountError)}
            />
          </SectionLabel>

          <SectionLabel label={t('checkout.linkTemplateForm.pricing.fields.currency')} error={fixedPriceCurrencyError}>
            <CheckoutCurrencySelect
              value={readString(values.fixedPriceCurrencyCode) || 'USD'}
              onChange={(next) => setValue('fixedPriceCurrencyCode', next)}
              placeholder={t('checkout.currencySelect.placeholder')}
            />
          </SectionLabel>

          <SectionLabel
            label={t('checkout.linkTemplateForm.pricing.fields.compareAtPrice')}
            hint={t('checkout.linkTemplateForm.pricing.hints.compareAtPrice')}
            error={fixedPriceOriginalAmountError}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              value={readNumberInputValue(values.fixedPriceOriginalAmount)}
              onChange={(event) => setValue('fixedPriceOriginalAmount', Number(event.target.value))}
              placeholder="200"
              className={errorInputClassName(fixedPriceOriginalAmountError)}
              aria-invalid={Boolean(fixedPriceOriginalAmountError)}
            />
          </SectionLabel>

          <div className="flex items-end">
            <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={readBoolean(values.fixedPriceIncludesTax, true)}
                onChange={(event) => setValue('fixedPriceIncludesTax', event.target.checked)}
              />
              {t('checkout.linkTemplateForm.pricing.fields.includesTax')}
            </label>
          </div>
        </div>
      ) : null}

      {pricingMode === 'custom_amount' ? (
        <div className="grid gap-4 md:grid-cols-3">
          <SectionLabel label={t('checkout.linkTemplateForm.pricing.fields.minimumAmount')} error={customAmountMinError}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={readNumberInputValue(values.customAmountMin)}
              onChange={(event) => setValue('customAmountMin', Number(event.target.value))}
              placeholder="10"
              className={errorInputClassName(customAmountMinError)}
              aria-invalid={Boolean(customAmountMinError)}
            />
          </SectionLabel>

          <SectionLabel label={t('checkout.linkTemplateForm.pricing.fields.maximumAmount')} error={customAmountMaxError}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={readNumberInputValue(values.customAmountMax)}
              onChange={(event) => setValue('customAmountMax', Number(event.target.value))}
              placeholder="500"
              className={errorInputClassName(customAmountMaxError)}
              aria-invalid={Boolean(customAmountMaxError)}
            />
          </SectionLabel>

          <SectionLabel label={t('checkout.linkTemplateForm.pricing.fields.currency')} error={customAmountCurrencyError}>
            <CheckoutCurrencySelect
              value={readString(values.customAmountCurrencyCode) || 'USD'}
              onChange={(next) => setValue('customAmountCurrencyCode', next)}
              placeholder={t('checkout.currencySelect.placeholder')}
            />
          </SectionLabel>
        </div>
      ) : null}

      {pricingMode === 'price_list' ? (
        <PriceListEditor
          value={normalizePriceListItems(values.priceListItems)}
          onChange={(next) => setValue('priceListItems', next)}
          error={priceListItemsError}
        />
      ) : null}
    </div>
  )
}

function GeneralSection({ values, setValue, errors, mode }: CrudFormGroupComponentProps & { mode: 'link' | 'template' }) {
  const t = useT()
  const fallbackSlug = slugify(
    readString(values.title).trim().length > 0
      ? readString(values.title)
      : readString(values.name),
  ) || 'pay-link'
  const currentSlug = readString(values.slug)
  const resolvedSlug = currentSlug.trim() || fallbackSlug
  const nameError = readError(errors, 'name')
  const titleError = readError(errors, 'title')
  const subtitleError = readError(errors, 'subtitle')
  const descriptionError = readError(errors, 'description')
  const slugError = readError(errors, 'slug')

  return (
    <div className="space-y-4">
      <SectionLabel label={t('checkout.linkTemplateForm.general.fields.name')} error={nameError}>
        <Input
          value={readString(values.name)}
          onChange={(event) => setValue('name', event.target.value)}
          placeholder={t('checkout.linkTemplateForm.general.placeholders.name')}
          className={errorInputClassName(nameError)}
          aria-invalid={Boolean(nameError)}
        />
      </SectionLabel>

      <SectionLabel label={t('checkout.linkTemplateForm.general.fields.title')} error={titleError}>
        <Input
          value={readString(values.title)}
          onChange={(event) => setValue('title', event.target.value)}
          placeholder={t('checkout.linkTemplateForm.general.placeholders.title')}
          className={errorInputClassName(titleError)}
          aria-invalid={Boolean(titleError)}
        />
      </SectionLabel>

      <SectionLabel label={t('checkout.linkTemplateForm.general.fields.subtitle')} error={subtitleError}>
        <Input
          value={readString(values.subtitle)}
          onChange={(event) => setValue('subtitle', event.target.value)}
          placeholder={t('checkout.linkTemplateForm.general.placeholders.subtitle')}
          className={errorInputClassName(subtitleError)}
          aria-invalid={Boolean(subtitleError)}
        />
      </SectionLabel>

      <SectionLabel label={t('checkout.linkTemplateForm.general.fields.description')} hint={t('checkout.linkTemplateForm.general.hints.description')} error={descriptionError}>
        <SwitchableMarkdownInput
          value={readString(values.description)}
          onChange={(next) => setValue('description', next)}
          isMarkdownEnabled
          height={220}
          placeholder={t('checkout.linkTemplateForm.general.placeholders.description')}
        />
      </SectionLabel>

      {mode === 'link' ? (
        <SectionLabel label={t('checkout.linkTemplateForm.general.fields.slug')} hint={t('checkout.linkTemplateForm.general.hints.slug')} error={slugError}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={currentSlug}
                onChange={(event) => setValue('slug', event.target.value)}
                placeholder={t('checkout.linkTemplateForm.general.placeholders.slug')}
                className={errorInputClassName(slugError)}
                aria-invalid={Boolean(slugError)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setValue('slug', fallbackSlug)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {t('checkout.linkTemplateForm.general.actions.generateSlug')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('checkout.linkTemplateForm.general.slugPreview', { slug: resolvedSlug })}</p>
          </div>
        </SectionLabel>
      ) : null}
    </div>
  )
}

function AppearanceSection({
  values,
  setValue,
  errors,
  entityId,
  attachmentRecordId,
}: CrudFormGroupComponentProps & { entityId: string; attachmentRecordId: string }) {
  const t = useT()
  const logoError = readAnyError(errors, 'logoAttachmentId', 'logoUrl')
  const primaryColorError = readError(errors, 'primaryColor')
  const secondaryColorError = readError(errors, 'secondaryColor')
  const backgroundColorError = readError(errors, 'backgroundColor')
  const themeModeError = readError(errors, 'themeMode')
  const displayCustomFieldsError = readError(errors, 'displayCustomFieldsOnPage')

  return (
    <div className="space-y-4">
      <LogoUploadField
        entityId={entityId}
        recordId={attachmentRecordId}
        attachmentId={readString(values.logoAttachmentId) || null}
        logoUrl={readString(values.logoUrl) || null}
        error={logoError}
        onChange={(next) => {
          setValue('logoAttachmentId', next.logoAttachmentId)
          setValue('logoUrl', next.logoUrl)
        }}
      />

      <div className="space-y-4">
        <ColorField
          label={t('checkout.linkTemplateForm.appearance.fields.primaryColor')}
          value={readString(values.primaryColor) || DEFAULT_COLORS.primaryColor}
          onChange={(next) => setValue('primaryColor', next)}
          error={primaryColorError}
        />
        <ColorField
          label={t('checkout.linkTemplateForm.appearance.fields.secondaryColor')}
          value={readString(values.secondaryColor) || DEFAULT_COLORS.secondaryColor}
          onChange={(next) => setValue('secondaryColor', next)}
          error={secondaryColorError}
        />
        <ColorField
          label={t('checkout.linkTemplateForm.appearance.fields.backgroundColor')}
          value={readString(values.backgroundColor) || DEFAULT_COLORS.backgroundColor}
          onChange={(next) => setValue('backgroundColor', next)}
          error={backgroundColorError}
        />
      </div>

      <SectionLabel label={t('checkout.linkTemplateForm.appearance.fields.themeMode')} error={themeModeError}>
        <select
          className={themeModeError
            ? `w-full rounded-md border bg-background px-3 py-2 text-sm ${errorInputClassName(themeModeError)}`
            : 'w-full rounded-md border bg-background px-3 py-2 text-sm'}
          value={readString(values.themeMode) || 'auto'}
          onChange={(event) => setValue('themeMode', event.target.value)}
          aria-invalid={Boolean(themeModeError)}
        >
          <option value="auto">{t('checkout.linkTemplateForm.appearance.themeModes.auto')}</option>
          <option value="light">{t('checkout.linkTemplateForm.appearance.themeModes.light')}</option>
          <option value="dark">{t('checkout.linkTemplateForm.appearance.themeModes.dark')}</option>
        </select>
      </SectionLabel>

      <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={readBoolean(values.displayCustomFieldsOnPage)}
          onChange={(event) => setValue('displayCustomFieldsOnPage', event.target.checked)}
        />
        {t('checkout.linkTemplateForm.appearance.fields.displayCustomFields')}
      </label>
      {displayCustomFieldsError ? <p className="text-xs text-destructive">{displayCustomFieldsError}</p> : null}
    </div>
  )
}

function PaymentSection({ values, setValue, errors, providers }: CrudFormGroupComponentProps & { providers: ProviderDescriptor[] }) {
  const t = useT()
  const gatewayProviderError = readError(errors, 'gatewayProviderKey')
  const gatewaySettingsError = readError(errors, 'gatewaySettings')

  return (
    <div className="space-y-4">
      <SectionLabel label={t('checkout.linkTemplateForm.payment.fields.gatewayProvider')} error={gatewayProviderError}>
        <select
          className={gatewayProviderError
            ? `w-full rounded-md border bg-background px-3 py-2 text-sm ${errorInputClassName(gatewayProviderError)}`
            : 'w-full rounded-md border bg-background px-3 py-2 text-sm'}
          value={readString(values.gatewayProviderKey)}
          onChange={(event) => setValue('gatewayProviderKey', event.target.value)}
          aria-invalid={Boolean(gatewayProviderError)}
        >
          <option value="">{t('checkout.linkTemplateForm.payment.placeholders.provider')}</option>
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
      {gatewaySettingsError ? <p className="text-xs text-destructive">{gatewaySettingsError}</p> : null}
    </div>
  )
}

function CustomerDetailsSection({ values, setValue, errors }: CrudFormGroupComponentProps) {
  const t = useT()
  const collectCustomerDetails = readBoolean(values.collectCustomerDetails, true)
  const collectCustomerDetailsError = readError(errors, 'collectCustomerDetails')
  const customerFieldsError = readError(errors, 'customerFieldsSchema')

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
            {t('checkout.linkTemplateForm.customerDetails.title')}
          </span>
          <span className="block text-muted-foreground">
            {t('checkout.linkTemplateForm.customerDetails.description')}
          </span>
        </span>
      </label>
      {collectCustomerDetailsError ? <p className="text-xs text-destructive">{collectCustomerDetailsError}</p> : null}

      {collectCustomerDetails ? (
        <>
          <Notice compact>
            {t('checkout.linkTemplateForm.customerDetails.notices.simpleLink')}
          </Notice>
          {customerFieldsError ? <p className="text-xs text-destructive">{customerFieldsError}</p> : null}
          <CustomerFieldsEditor
            value={readCustomerFields(values.customerFieldsSchema, t)}
            onChange={(next) => setValue('customerFieldsSchema', next)}
          />
        </>
      ) : (
        <Notice compact>
          {t('checkout.linkTemplateForm.customerDetails.notices.disabled')}
        </Notice>
      )}
    </div>
  )
}

function LegalSection({ values, setValue, errors }: CrudFormGroupComponentProps) {
  const t = useT()
  const [tab, setTab] = React.useState<'terms' | 'privacyPolicy'>('terms')
  const legalDocuments = normalizeLegalDocuments(values.legalDocuments)
  const termsTitleError = readAnyError(errors, 'legalDocuments.terms.title', 'legalDocuments.terms')
  const termsMarkdownError = readAnyError(errors, 'legalDocuments.terms.markdown', 'legalDocuments.terms')
  const privacyTitleError = readAnyError(errors, 'legalDocuments.privacyPolicy.title', 'legalDocuments.privacyPolicy')
  const privacyMarkdownError = readAnyError(errors, 'legalDocuments.privacyPolicy.markdown', 'legalDocuments.privacyPolicy')

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
        {t('checkout.linkTemplateForm.legal.notice')}
      </Notice>

      <Tabs value={tab} onValueChange={(next) => setTab(next as 'terms' | 'privacyPolicy')}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="terms">
            <Shield className="mr-2 h-4 w-4" />
            {t('checkout.linkTemplateForm.legal.tabs.terms')}
          </TabsTrigger>
          <TabsTrigger value="privacyPolicy">
            <FileCheck2 className="mr-2 h-4 w-4" />
            {t('checkout.linkTemplateForm.legal.tabs.privacy')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="terms" className="space-y-4">
          <SectionLabel label={t('checkout.linkTemplateForm.legal.fields.termsTitle')} error={termsTitleError}>
            <Input
              value={legalDocuments.terms.title}
              onChange={(event) => patchDocument('terms', { title: event.target.value })}
              placeholder={t('checkout.linkTemplateForm.legal.placeholders.termsTitle')}
              className={errorInputClassName(termsTitleError)}
              aria-invalid={Boolean(termsTitleError)}
            />
          </SectionLabel>
          <SectionLabel label={t('checkout.linkTemplateForm.legal.fields.termsBody')} error={termsMarkdownError}>
            <SwitchableMarkdownInput
              value={legalDocuments.terms.markdown}
              onChange={(next) => patchDocument('terms', { markdown: next })}
              isMarkdownEnabled
              height={220}
              placeholder={t('checkout.linkTemplateForm.legal.placeholders.termsBody')}
            />
          </SectionLabel>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={legalDocuments.terms.required}
              onChange={(event) => patchDocument('terms', { required: event.target.checked })}
            />
            {t('checkout.linkTemplateForm.legal.fields.acceptanceRequired')}
          </label>
        </TabsContent>

        <TabsContent value="privacyPolicy" className="space-y-4">
          <SectionLabel label={t('checkout.linkTemplateForm.legal.fields.privacyTitle')} error={privacyTitleError}>
            <Input
              value={legalDocuments.privacyPolicy.title}
              onChange={(event) => patchDocument('privacyPolicy', { title: event.target.value })}
              placeholder={t('checkout.linkTemplateForm.legal.placeholders.privacyTitle')}
              className={errorInputClassName(privacyTitleError)}
              aria-invalid={Boolean(privacyTitleError)}
            />
          </SectionLabel>
          <SectionLabel label={t('checkout.linkTemplateForm.legal.fields.privacyBody')} error={privacyMarkdownError}>
            <SwitchableMarkdownInput
              value={legalDocuments.privacyPolicy.markdown}
              onChange={(next) => patchDocument('privacyPolicy', { markdown: next })}
              isMarkdownEnabled
              height={220}
              placeholder={t('checkout.linkTemplateForm.legal.placeholders.privacyBody')}
            />
          </SectionLabel>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={legalDocuments.privacyPolicy.required}
              onChange={(event) => patchDocument('privacyPolicy', { required: event.target.checked })}
            />
            {t('checkout.linkTemplateForm.legal.fields.acceptanceRequired')}
          </label>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function MessagesSection({ values, setValue, errors }: CrudFormGroupComponentProps) {
  const t = useT()
  const [tab, setTab] = React.useState<'success' | 'cancel' | 'error'>('success')

  const config = {
    success: {
      titleKey: 'successTitle',
      bodyKey: 'successMessage',
      titlePlaceholder: t('checkout.linkTemplateForm.messages.placeholders.successTitle'),
      bodyPlaceholder: t('checkout.linkTemplateForm.messages.placeholders.successBody'),
      label: t('checkout.linkTemplateForm.messages.tabs.success'),
    },
    cancel: {
      titleKey: 'cancelTitle',
      bodyKey: 'cancelMessage',
      titlePlaceholder: t('checkout.linkTemplateForm.messages.placeholders.cancelTitle'),
      bodyPlaceholder: t('checkout.linkTemplateForm.messages.placeholders.cancelBody'),
      label: t('checkout.linkTemplateForm.messages.tabs.cancel'),
    },
    error: {
      titleKey: 'errorTitle',
      bodyKey: 'errorMessage',
      titlePlaceholder: t('checkout.linkTemplateForm.messages.placeholders.errorTitle'),
      bodyPlaceholder: t('checkout.linkTemplateForm.messages.placeholders.errorBody'),
      label: t('checkout.linkTemplateForm.messages.tabs.error'),
    },
  } as const

  return (
    <div className="space-y-4">
      <Notice compact>
        {t('checkout.linkTemplateForm.messages.notice')}
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
            <SectionLabel label={t('checkout.linkTemplateForm.messages.labels.title', { state: config[item].label })} error={readError(errors, config[item].titleKey)}>
              <Input
                value={readString(values[config[item].titleKey])}
                onChange={(event) => setValue(config[item].titleKey, event.target.value)}
                placeholder={config[item].titlePlaceholder}
                className={errorInputClassName(readError(errors, config[item].titleKey))}
                aria-invalid={Boolean(readError(errors, config[item].titleKey))}
              />
            </SectionLabel>
            <SectionLabel label={t('checkout.linkTemplateForm.messages.labels.body', { state: config[item].label })} error={readError(errors, config[item].bodyKey)}>
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
  const t = useT()
  const variables = ['{{firstName}}', '{{amount}}', '{{currencyCode}}', '{{linkTitle}}', '{{transactionId}}', '{{errorMessage}}']
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('checkout.linkTemplateForm.emails.variableHint')}</p>
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
    </div>
  )
}

function EmailsSection({ values, setValue, errors }: CrudFormGroupComponentProps) {
  const t = useT()
  const [tab, setTab] = React.useState<'start' | 'success' | 'error'>('start')

  const config = {
    start: {
      enabledKey: 'sendStartEmail',
      subjectKey: 'startEmailSubject',
      bodyKey: 'startEmailBody',
      title: t('checkout.linkTemplateForm.emails.tabs.start'),
      subjectPlaceholder: t('checkout.linkTemplateForm.emails.placeholders.startSubject'),
      bodyPlaceholder: t('checkout.linkTemplateForm.emails.placeholders.startBody'),
    },
    success: {
      enabledKey: 'sendSuccessEmail',
      subjectKey: 'successEmailSubject',
      bodyKey: 'successEmailBody',
      title: t('checkout.linkTemplateForm.emails.tabs.success'),
      subjectPlaceholder: t('checkout.linkTemplateForm.emails.placeholders.successSubject'),
      bodyPlaceholder: t('checkout.linkTemplateForm.emails.placeholders.successBody'),
    },
    error: {
      enabledKey: 'sendErrorEmail',
      subjectKey: 'errorEmailSubject',
      bodyKey: 'errorEmailBody',
      title: t('checkout.linkTemplateForm.emails.tabs.error'),
      subjectPlaceholder: t('checkout.linkTemplateForm.emails.placeholders.errorSubject'),
      bodyPlaceholder: t('checkout.linkTemplateForm.emails.placeholders.errorBody'),
    },
  } as const

  return (
    <div className="space-y-4">
      <Notice compact>
        {t('checkout.linkTemplateForm.emails.notice')}
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
              {t('checkout.linkTemplateForm.emails.sendToCustomer')}
            </label>

            <SectionLabel label={t('checkout.linkTemplateForm.emails.labels.subject', { state: config[item].title })} error={readError(errors, config[item].subjectKey)}>
              <Input
                value={readString(values[config[item].subjectKey])}
                onChange={(event) => setValue(config[item].subjectKey, event.target.value)}
                placeholder={config[item].subjectPlaceholder}
                className={errorInputClassName(readError(errors, config[item].subjectKey))}
                aria-invalid={Boolean(readError(errors, config[item].subjectKey))}
              />
            </SectionLabel>

            <SectionLabel label={t('checkout.linkTemplateForm.emails.labels.body', { state: config[item].title })} error={readError(errors, config[item].bodyKey)}>
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

function SettingsSection({ values, setValue, errors }: CrudFormGroupComponentProps) {
  const t = useT()
  const status = readString(values.status) || 'draft'
  const statusError = readError(errors, 'status')
  const maxCompletionsError = readError(errors, 'maxCompletions')
  const passwordError = readError(errors, 'password')

  return (
    <div className="space-y-4">
      <SectionLabel label={t('checkout.linkTemplateForm.settings.fields.status')} error={statusError}>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'draft', label: t('checkout.common.status.draft') },
            { id: 'active', label: t('checkout.common.status.active') },
            { id: 'inactive', label: t('checkout.common.status.inactive') },
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

      <SectionLabel label={t('checkout.linkTemplateForm.settings.fields.maxCompletions')} hint={t('checkout.linkTemplateForm.settings.hints.maxCompletions')} error={maxCompletionsError}>
        <Input
          type="number"
          min="1"
          step="1"
          value={readNumberInputValue(values.maxCompletions)}
          onChange={(event) => setValue('maxCompletions', event.target.value ? Number(event.target.value) : null)}
          placeholder={t('checkout.linkTemplateForm.settings.placeholders.unlimited')}
          className={errorInputClassName(maxCompletionsError)}
          aria-invalid={Boolean(maxCompletionsError)}
        />
      </SectionLabel>

      <SectionLabel label={t('checkout.linkTemplateForm.settings.fields.password')} hint={t('checkout.linkTemplateForm.settings.hints.password')} error={passwordError}>
        <Input
          type="password"
          value={readString(values.password)}
          onChange={(event) => setValue('password', event.target.value)}
          placeholder={t('checkout.linkTemplateForm.settings.placeholders.password')}
          className={errorInputClassName(passwordError)}
          aria-invalid={Boolean(passwordError)}
        />
      </SectionLabel>
    </div>
  )
}

export function LinkTemplateForm({ mode, recordId }: Props) {
  const t = useT()
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
    recordId ? null : normalizeFormValues(createDefaultValues(t), t),
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
        setInitialValues(normalizeFormValues(result, t))
      })
      .catch(() => {
        if (active) setInitialValues(normalizeFormValues({}, t))
      })
    return () => {
      active = false
    }
  }, [mode, recordId, t])

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
          }, t),
        )
      })
      .catch(() => null)
    return () => {
      active = false
    }
  }, [mode, recordId, t, templateId])

  const fields = React.useMemo<CrudField[]>(() => [], [])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'general',
      title: t('checkout.linkTemplateForm.groups.general'),
      column: 1,
      component: (ctx) => <GeneralSection {...ctx} mode={mode} />,
    },
    {
      id: 'appearance',
      title: t('checkout.linkTemplateForm.groups.appearance'),
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
      title: t('checkout.linkTemplateForm.groups.pricing'),
      column: 1,
      component: (ctx) => <PricingSection {...ctx} />,
    },
    {
      id: 'payment',
      title: t('checkout.linkTemplateForm.groups.payment'),
      column: 2,
      component: (ctx) => <PaymentSection {...ctx} providers={providers} />,
    },
    {
      id: 'customerFields',
      title: t('checkout.linkTemplateForm.groups.customerFields'),
      column: 1,
      component: (ctx) => <CustomerDetailsSection {...ctx} />,
    },
    {
      id: 'settings',
      title: t('checkout.linkTemplateForm.groups.settings'),
      column: 2,
      component: (ctx) => <SettingsSection {...ctx} />,
    },
    {
      id: 'legal',
      title: t('checkout.linkTemplateForm.groups.legal'),
      column: 1,
      component: (ctx) => <LegalSection {...ctx} />,
    },
    {
      id: 'messages',
      title: t('checkout.linkTemplateForm.groups.messages'),
      column: 1,
      component: (ctx) => <MessagesSection {...ctx} />,
    },
    {
      id: 'emails',
      title: t('checkout.linkTemplateForm.groups.emails'),
      column: 1,
      component: (ctx) => <EmailsSection {...ctx} />,
    },
    { id: 'customFields', title: t('checkout.linkTemplateForm.groups.customFields'), column: 2, kind: 'customFields' },
  ], [attachmentDraftRecordId, entityId, mode, providers, t])

  const isLocked = mode === 'link' && Boolean(recordId) && readBoolean(initialValues?.isLocked)
  const lockedNotice = isLocked ? (
    <Notice
      variant="warning"
      title={t('checkout.linkTemplateForm.locked.title')}
      message={t('checkout.linkTemplateForm.locked.description')}
    />
  ) : undefined
  const lockedOverlay = isLocked ? (
    <div className="mx-auto mt-6 max-w-md rounded-2xl border border-amber-200 bg-background/95 px-5 py-4 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Shield className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">
        {t('checkout.linkTemplateForm.locked.overlayTitle')}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('checkout.linkTemplateForm.locked.overlayDescription')}
      </p>
    </div>
  ) : undefined

  return (
    <Page>
      <PageBody>
        {initialValues ? (
          <CrudForm<FormValues>
            title={recordId
              ? t(mode === 'link' ? 'checkout.linkTemplateForm.titles.editLink' : 'checkout.linkTemplateForm.titles.editTemplate')
              : t(mode === 'link' ? 'checkout.linkTemplateForm.titles.createLink' : 'checkout.linkTemplateForm.titles.createTemplate')}
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
                  {t('checkout.common.actions.preview')}
                </a>
              </Button>
            ) : null}
            entityId={entityId}
            initialValues={initialValues}
            contentHeader={lockedNotice}
            readOnly={isLocked}
            readOnlyOverlay={lockedOverlay}
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
                ? `/backend/checkout/pay-links?flash=${encodeURIComponent(t('checkout.common.flash.saved'))}&type=success`
                : `/backend/checkout/templates?flash=${encodeURIComponent(t('checkout.common.flash.saved'))}&type=success`
            }}
            onDelete={recordId ? async () => {
              await apiCallOrThrow(`/api/checkout/${mode === 'link' ? 'links' : 'templates'}/${encodeURIComponent(recordId)}`, { method: 'DELETE' })
              window.location.href = mode === 'link'
                ? `/backend/checkout/pay-links?flash=${encodeURIComponent(t('checkout.common.flash.deleted'))}&type=success`
                : `/backend/checkout/templates?flash=${encodeURIComponent(t('checkout.common.flash.deleted'))}&type=success`
            } : undefined}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}

export default LinkTemplateForm
