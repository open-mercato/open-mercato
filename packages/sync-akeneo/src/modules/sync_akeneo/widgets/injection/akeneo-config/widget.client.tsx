"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { buildDefaultAkeneoMapping, buildProductFieldMappings, normalizeAkeneoMapping, type AkeneoReconciliationSettings } from '../../../lib/shared'
import type { AkeneoDiscoveryResponse } from '../../../data/validators'

type MappingRecordResponse = {
  items?: Array<{
    id: string
    mapping: Record<string, unknown>
  }>
}

type FormState = {
  productLocale: string
  productChannel: string
  categoryLocale: string
  includeTextAttributes: boolean
  includeNumericAttributes: boolean
  familyCodeFilter: string
  customFieldMappings: string
  priceMappings: string
  mediaMappings: string
  syncAssociations: boolean
  reconciliation: AkeneoReconciliationSettings
  fieldMap: {
    title: string
    subtitle: string
    description: string
    sku: string
    barcode: string
    weight: string
    variantName: string
  }
}

const PRODUCT_FIELD_KEYS: Array<{
  key: keyof FormState['fieldMap']
  label: string
  help: string
}> = [
  { key: 'title', label: 'Title attribute', help: 'Used for the Open Mercato product title.' },
  { key: 'subtitle', label: 'Subtitle attribute', help: 'Optional secondary title field.' },
  { key: 'description', label: 'Description attribute', help: 'Used for the product description.' },
  { key: 'sku', label: 'SKU attribute', help: 'Used for both simple-product and variant SKU matching.' },
  { key: 'barcode', label: 'Barcode attribute', help: 'Optional barcode/EAN source.' },
  { key: 'weight', label: 'Weight attribute', help: 'Metric attribute used for product and default-variant weight.' },
  { key: 'variantName', label: 'Variant label attribute', help: 'Fallback label for generated variant names.' },
]

function buildInitialState(): FormState {
  const products = buildDefaultAkeneoMapping('products')
  const categories = buildDefaultAkeneoMapping('categories')
  const attributes = buildDefaultAkeneoMapping('attributes')
  const productSettings = products.settings?.products
  return {
    productLocale: productSettings?.locale ?? 'en_US',
    productChannel: productSettings?.channel ?? '',
    categoryLocale: categories.settings?.categories?.locale ?? 'en_US',
    includeTextAttributes: attributes.settings?.attributes?.includeTextAttributes ?? true,
    includeNumericAttributes: attributes.settings?.attributes?.includeNumericAttributes ?? true,
    familyCodeFilter: '',
    customFieldMappings: '',
    priceMappings: '',
    mediaMappings: '',
    syncAssociations: productSettings?.syncAssociations ?? true,
    reconciliation: productSettings?.reconciliation ?? {
      deactivateMissingCategories: true,
      deactivateMissingProducts: true,
      deactivateMissingAttributes: true,
      deleteMissingOffers: true,
      deleteMissingPrices: true,
      deleteMissingMedia: true,
      deleteMissingAttachments: true,
    },
    fieldMap: {
      title: productSettings?.fieldMap.title ?? 'name',
      subtitle: productSettings?.fieldMap.subtitle ?? 'subtitle',
      description: productSettings?.fieldMap.description ?? 'description',
      sku: productSettings?.fieldMap.sku ?? 'sku',
      barcode: productSettings?.fieldMap.barcode ?? 'ean',
      weight: productSettings?.fieldMap.weight ?? 'weight',
      variantName: productSettings?.fieldMap.variantName ?? 'name',
    },
  }
}

function mergeMappingsIntoState(
  state: FormState,
  productsMapping: Record<string, unknown> | undefined,
  categoriesMapping: Record<string, unknown> | undefined,
  attributesMapping: Record<string, unknown> | undefined,
): FormState {
  const normalizedProducts = normalizeAkeneoMapping('products', productsMapping ?? null)
  const normalizedCategories = normalizeAkeneoMapping('categories', categoriesMapping ?? null)
  const normalizedAttributes = normalizeAkeneoMapping('attributes', attributesMapping ?? null)
  return {
    ...state,
    productLocale: normalizedProducts.settings?.products?.locale ?? state.productLocale,
    productChannel: normalizedProducts.settings?.products?.channel ?? '',
    categoryLocale: normalizedCategories.settings?.categories?.locale ?? state.categoryLocale,
    includeTextAttributes: normalizedAttributes.settings?.attributes?.includeTextAttributes ?? state.includeTextAttributes,
    includeNumericAttributes: normalizedAttributes.settings?.attributes?.includeNumericAttributes ?? state.includeNumericAttributes,
    familyCodeFilter: (normalizedAttributes.settings?.attributes?.familyCodeFilter ?? []).join(', '),
    customFieldMappings: (normalizedProducts.settings?.products?.customFieldMappings ?? [])
      .map((entry) => `${entry.attributeCode},${entry.target},${entry.fieldKey}${entry.kind ? `,${entry.kind}` : ''}`)
      .join('\n'),
    priceMappings: (normalizedProducts.settings?.products?.priceMappings ?? [])
      .map((entry) => `${entry.attributeCode},${entry.priceKindCode},${entry.akeneoChannel ?? ''},${entry.localChannelCode}`)
      .join('\n'),
    mediaMappings: (normalizedProducts.settings?.products?.mediaMappings ?? [])
      .map((entry) => `${entry.attributeCode},${entry.target},${entry.kind}`)
      .join('\n'),
    syncAssociations: normalizedProducts.settings?.products?.syncAssociations ?? state.syncAssociations,
    reconciliation: normalizedProducts.settings?.products?.reconciliation ?? state.reconciliation,
    fieldMap: {
      title: normalizedProducts.settings?.products?.fieldMap.title ?? state.fieldMap.title,
      subtitle: normalizedProducts.settings?.products?.fieldMap.subtitle ?? state.fieldMap.subtitle,
      description: normalizedProducts.settings?.products?.fieldMap.description ?? state.fieldMap.description,
      sku: normalizedProducts.settings?.products?.fieldMap.sku ?? state.fieldMap.sku,
      barcode: normalizedProducts.settings?.products?.fieldMap.barcode ?? state.fieldMap.barcode,
      weight: normalizedProducts.settings?.products?.fieldMap.weight ?? state.fieldMap.weight,
      variantName: normalizedProducts.settings?.products?.fieldMap.variantName ?? state.fieldMap.variantName,
    },
  }
}

function parseRows(value: string): string[][] {
  return value
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map((row) => row.split(',').map((cell) => cell.trim()))
}

export default function AkeneoConfigWidget(_props: InjectionWidgetComponentProps) {
  const t = useT()
  const [state, setState] = React.useState<FormState>(() => buildInitialState())
  const [discovery, setDiscovery] = React.useState<AkeneoDiscoveryResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  const load = React.useCallback(async (refresh = false) => {
    setIsLoading(true)
    try {
      const [discoveryCall, productsCall, categoriesCall, attributesCall] = await Promise.all([
        apiCall<AkeneoDiscoveryResponse>(`/api/sync_akeneo/discovery${refresh ? '?refresh=true' : ''}`),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=products&page=1&pageSize=1'),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=categories&page=1&pageSize=1'),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=attributes&page=1&pageSize=1'),
      ])

      const nextState = mergeMappingsIntoState(
        buildInitialState(),
        productsCall.result?.items?.[0]?.mapping,
        categoriesCall.result?.items?.[0]?.mapping,
        attributesCall.result?.items?.[0]?.mapping,
      )

      setState(nextState)
      setDiscovery(discoveryCall.result ?? null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Akeneo configuration'
      flash(message, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load(false)
  }, [load])

  const attributeCodes = React.useMemo(
    () => (discovery?.attributes ?? []).map((attribute) => attribute.code).sort(),
    [discovery],
  )

  async function saveMappings() {
    setIsSaving(true)
    try {
      const customFieldMappings = parseRows(state.customFieldMappings)
        .map(([attributeCode, target, fieldKey, kind]) => {
          const normalizedTarget = target === 'variant' ? 'variant' : target === 'product' ? 'product' : null
          const normalizedKind = kind === 'text'
            || kind === 'multiline'
            || kind === 'integer'
            || kind === 'float'
            || kind === 'boolean'
            || kind === 'select'
            ? kind
            : null
          if (!attributeCode || !fieldKey || !normalizedTarget) return null
          return {
            attributeCode,
            target: normalizedTarget,
            fieldKey,
            kind: normalizedKind,
          } as const
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      const priceMappings = parseRows(state.priceMappings)
        .map(([attributeCode, priceKindCode, akeneoChannel, localChannelCode]) => {
          if (!attributeCode || !priceKindCode || !localChannelCode) return null
          return {
            attributeCode,
            priceKindCode,
            akeneoChannel: akeneoChannel || null,
            localChannelCode,
          } as const
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      const mediaMappings = parseRows(state.mediaMappings)
        .map(([attributeCode, target, kind]) => {
          const normalizedTarget = target === 'variant' ? 'variant' : target === 'product' ? 'product' : null
          const normalizedKind = kind === 'image' ? 'image' : kind === 'file' ? 'file' : null
          if (!attributeCode || !normalizedTarget || !normalizedKind) return null
          return {
            attributeCode,
            target: normalizedTarget,
            kind: normalizedKind,
          } as const
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      const productsMapping = {
        ...buildDefaultAkeneoMapping('products'),
        settings: {
          products: {
            locale: state.productLocale,
            channel: state.productChannel || null,
            fieldMap: { ...state.fieldMap },
            customFieldMappings,
            priceMappings,
            mediaMappings,
            syncAssociations: state.syncAssociations,
            reconciliation: { ...state.reconciliation },
          },
        },
      }
      productsMapping.fields = buildProductFieldMappings(productsMapping.settings.products)

      const categoriesMapping = {
        ...buildDefaultAkeneoMapping('categories'),
        settings: {
          categories: {
            locale: state.categoryLocale,
          },
        },
      }

      const attributesMapping = {
        ...buildDefaultAkeneoMapping('attributes'),
        settings: {
          attributes: {
            includeTextAttributes: state.includeTextAttributes,
            includeNumericAttributes: state.includeNumericAttributes,
            familyCodeFilter: state.familyCodeFilter
              .split(',')
              .map((value) => value.trim())
              .filter((value) => value.length > 0),
          },
        },
      }

      const saves = await Promise.all([
        apiCall('/api/data_sync/mappings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            integrationId: 'sync_akeneo',
            entityType: 'products',
            mapping: productsMapping,
          }),
        }),
        apiCall('/api/data_sync/mappings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            integrationId: 'sync_akeneo',
            entityType: 'categories',
            mapping: categoriesMapping,
          }),
        }),
        apiCall('/api/data_sync/mappings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            integrationId: 'sync_akeneo',
            entityType: 'attributes',
            mapping: attributesMapping,
          }),
        }),
      ])

      if (saves.some((result) => !result.ok)) {
        throw new Error('Failed to save one or more Akeneo mapping records')
      }

      flash(t('sync_akeneo.saved', 'Akeneo sync settings saved.'), 'success')
      await load(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save Akeneo mapping'
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 rounded-lg border bg-card p-4">
      <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              {t('sync_akeneo.setup.heading', 'Akeneo API setup')}
            </h3>
        <Notice
          title={t('sync_akeneo.setup.order.title', 'Recommended sync order')}
          message={t(
            'sync_akeneo.setup.order.message',
            'Run category sync first, attribute sync second, and product sync last. Product import expects local categories and family-based schemas to exist already.',
          )}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border p-4">
            <h4 className="text-sm font-medium">{t('sync_akeneo.setup.credentials.title', 'Create API credentials in Akeneo')}</h4>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>{t('sync_akeneo.setup.credentials.step1', 'In Akeneo, open Settings -> Connections and create a new API connection or connected app for Open Mercato.')}</li>
              <li>{t('sync_akeneo.setup.credentials.step2', 'Copy the Akeneo base URL, client id, and client secret into the Integration credentials tab in Open Mercato.')}</li>
              <li>{t('sync_akeneo.setup.credentials.step3', 'Create a dedicated Akeneo API user, assign it to the right catalog permissions, and use that username/password in the credential form.')}</li>
              <li>{t('sync_akeneo.setup.credentials.step4', 'Grant the API user access to products, categories, attributes, families, family variants, locales, and channels. Limit write permissions if you only import.')}</li>
            </ol>
          </div>
          <div className="rounded-lg border p-4">
            <h4 className="text-sm font-medium">{t('sync_akeneo.setup.docs.title', 'Operational notes')}</h4>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>{t('sync_akeneo.setup.docs.note1', 'Akeneo authentication uses client id, client secret, username, and password. Open Mercato exchanges those for access/refresh tokens automatically.')}</li>
              <li>{t('sync_akeneo.setup.docs.note2', 'For large catalogs, keep batch sizes at 100 and prefer incremental product syncs. The importer resumes from the last processed Akeneo updated timestamp plus search_after pagination state.')}</li>
              <li>{t('sync_akeneo.setup.docs.note3', 'Simple Akeneo products still create a default Open Mercato variant. Variant Akeneo products flatten the full Akeneo product-model tree into one configurable product plus child variants.')}</li>
              <li>{t('sync_akeneo.setup.docs.note4', 'If you want channel offers and prices, create matching Sales Channels and Catalog Price Kinds in Open Mercato first, then reference their codes in the mapping blocks below.')}</li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <a className="underline" href="https://api.akeneo.com/documentation/authentication.html" target="_blank" rel="noreferrer">
                {t('sync_akeneo.links.auth', 'Akeneo authentication docs')}
              </a>
              <a className="underline" href="https://api.akeneo.com/documentation/pagination.html" target="_blank" rel="noreferrer">
                {t('sync_akeneo.links.pagination', 'Akeneo pagination docs')}
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('sync_akeneo.mapping.heading', 'Field mapping')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('sync_akeneo.mapping.help', 'Map Akeneo attribute codes to structured catalog fields, optional custom fields, price channels, and media imports.')}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void load(true)} disabled={isLoading || isSaving}>
            {t('sync_akeneo.mapping.refresh', 'Refresh fields')}
          </Button>
        </div>

        {discovery?.message ? (
          <Notice compact variant={discovery.ok ? 'info' : 'warning'}>
            {discovery.message}
          </Notice>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5 rounded-lg border p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="akeneo-product-locale">{t('sync_akeneo.mapping.productLocale', 'Product locale')}</Label>
                <Input
                  id="akeneo-product-locale"
                  list="akeneo-locales"
                  value={state.productLocale}
                  onChange={(event) => setState((current) => ({ ...current, productLocale: event.target.value }))}
                  disabled={isLoading || isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="akeneo-product-channel">{t('sync_akeneo.mapping.productChannel', 'Product channel')}</Label>
                <Input
                  id="akeneo-product-channel"
                  list="akeneo-channels"
                  value={state.productChannel}
                  onChange={(event) => setState((current) => ({ ...current, productChannel: event.target.value }))}
                  disabled={isLoading || isSaving}
                  placeholder={t('sync_akeneo.mapping.channelPlaceholder', 'Optional')}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {PRODUCT_FIELD_KEYS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`akeneo-${field.key}`}>{t(`sync_akeneo.mapping.${field.key}`, field.label)}</Label>
                  <Input
                    id={`akeneo-${field.key}`}
                    list="akeneo-attributes"
                    value={state.fieldMap[field.key]}
                    onChange={(event) => {
                      const value = event.target.value
                      setState((current) => ({
                        ...current,
                        fieldMap: {
                          ...current.fieldMap,
                          [field.key]: value,
                        },
                      }))
                    }}
                    disabled={isLoading || isSaving}
                  />
                  <p className="text-xs text-muted-foreground">{t(`sync_akeneo.mapping.${field.key}.help`, field.help)}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="akeneo-category-locale">{t('sync_akeneo.mapping.categoryLocale', 'Category label locale')}</Label>
                <Input
                  id="akeneo-category-locale"
                  list="akeneo-locales"
                  value={state.categoryLocale}
                  onChange={(event) => setState((current) => ({ ...current, categoryLocale: event.target.value }))}
                  disabled={isLoading || isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="akeneo-family-filter">{t('sync_akeneo.mapping.familyFilter', 'Attribute sync family filter')}</Label>
                <Input
                  id="akeneo-family-filter"
                  value={state.familyCodeFilter}
                  onChange={(event) => setState((current) => ({ ...current, familyCodeFilter: event.target.value }))}
                  disabled={isLoading || isSaving}
                  placeholder={t('sync_akeneo.mapping.familyFilterPlaceholder', 'family_a, family_b')}
                />
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.familyFilter.help', 'Leave empty to sync family-driven schemas for all Akeneo families.')}
                </p>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="akeneo-custom-fields">{t('sync_akeneo.mapping.customFields', 'Custom field mappings')}</Label>
                <Textarea
                  id="akeneo-custom-fields"
                  value={state.customFieldMappings}
                  onChange={(event) => setState((current) => ({ ...current, customFieldMappings: event.target.value }))}
                  disabled={isLoading || isSaving}
                  rows={6}
                  placeholder={'material,product,akeneo_material,select\ncare_instructions,variant,akeneo_care_instructions,multiline'}
                />
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.customFields.help', 'One mapping per line: attribute_code,target(product|variant),field_key[,kind]. The importer creates or updates Open Mercato custom field definitions and stores Akeneo metadata, validation rules, and groups on those fields.')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="akeneo-prices">{t('sync_akeneo.mapping.prices', 'Price and offer mappings')}</Label>
                <Textarea
                  id="akeneo-prices"
                  value={state.priceMappings}
                  onChange={(event) => setState((current) => ({ ...current, priceMappings: event.target.value }))}
                  disabled={isLoading || isSaving}
                  rows={5}
                  placeholder={'price,regular,ecommerce,web\nsale_price,sale,ecommerce,web'}
                />
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.prices.help', 'One mapping per line: price_attribute,price_kind_code,akeneo_channel,local_channel_code. Each distinct local channel creates or updates an offer, and each price collection entry becomes a Catalog Product Price in the matching currency.')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="akeneo-media">{t('sync_akeneo.mapping.media', 'Media and attachment mappings')}</Label>
                <Textarea
                  id="akeneo-media"
                  value={state.mediaMappings}
                  onChange={(event) => setState((current) => ({ ...current, mediaMappings: event.target.value }))}
                  disabled={isLoading || isSaving}
                  rows={5}
                  placeholder={'main_image,product,image\nsize_chart,product,file\npackshot,variant,image'}
                />
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.media.help', 'One mapping per line: attribute_code,target(product|variant),kind(image|file). Image mappings are re-hosted into Open Mercato attachments and can become default media; file mappings are imported as attachments.')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.includeTextAttributes}
                  onChange={(event) => setState((current) => ({ ...current, includeTextAttributes: event.target.checked }))}
                  disabled={isLoading || isSaving}
                />
                <span>{t('sync_akeneo.mapping.includeText', 'Include text attributes in generated family schemas')}</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.includeNumericAttributes}
                  onChange={(event) => setState((current) => ({ ...current, includeNumericAttributes: event.target.checked }))}
                  disabled={isLoading || isSaving}
                />
                <span>{t('sync_akeneo.mapping.includeNumeric', 'Include numeric and metric attributes in generated family schemas')}</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={state.syncAssociations}
                  onChange={(event) => setState((current) => ({ ...current, syncAssociations: event.target.checked }))}
                  disabled={isLoading || isSaving}
                />
                <span>{t('sync_akeneo.mapping.syncAssociations', 'Import Akeneo associations into product/variant relation records')}</span>
              </label>
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div>
                <h4 className="text-sm font-medium">{t('sync_akeneo.mapping.reconciliation.title', 'Reconciliation and deletions')}</h4>
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.reconciliation.help', 'These cleanup rules apply during full syncs. Incremental syncs continue to upsert changed records, while stale Akeneo-managed offers, prices, and media are reconciled per product on every product import.')}
                </p>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ['deactivateMissingCategories', 'Deactivate categories missing from Akeneo'],
                  ['deactivateMissingProducts', 'Deactivate products and variants missing from Akeneo'],
                  ['deactivateMissingAttributes', 'Deactivate Akeneo-managed schemas and custom fields missing from Akeneo'],
                  ['deleteMissingOffers', 'Delete Akeneo-managed offers no longer produced by mapping'],
                  ['deleteMissingPrices', 'Delete Akeneo-managed prices no longer produced by mapping'],
                  ['deleteMissingMedia', 'Delete stale Akeneo-managed images/default media'],
                  ['deleteMissingAttachments', 'Delete stale Akeneo-managed file attachments'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={state.reconciliation[key as keyof AkeneoReconciliationSettings]}
                      onChange={(event) => setState((current) => ({
                        ...current,
                        reconciliation: {
                          ...current.reconciliation,
                          [key]: event.target.checked,
                        },
                      }))}
                      disabled={isLoading || isSaving}
                    />
                    <span>{t(`sync_akeneo.mapping.reconciliation.${key}`, label)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="button" onClick={() => void saveMappings()} disabled={isLoading || isSaving}>
                {isSaving ? t('sync_akeneo.mapping.saving', 'Saving...') : t('sync_akeneo.mapping.save', 'Save mappings')}
              </Button>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border p-4">
            <div>
              <h4 className="text-sm font-medium">{t('sync_akeneo.discovery.heading', 'Discovered Akeneo fields')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('sync_akeneo.discovery.help', 'These values come from the current Akeneo credentials and are safe to paste into the mapping inputs.')}
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{t('sync_akeneo.discovery.locales', 'Locales')}</div>
                <div className="flex flex-wrap gap-2">
                  {(discovery?.locales ?? []).map((locale) => (
                    <span key={locale.code} className="rounded border px-2 py-1 text-xs">
                      {locale.code}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{t('sync_akeneo.discovery.channels', 'Channels')}</div>
                <div className="flex flex-wrap gap-2">
                  {(discovery?.channels ?? []).map((channel) => (
                    <span key={channel.code} className="rounded border px-2 py-1 text-xs">
                      {channel.code}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{t('sync_akeneo.discovery.families', 'Families')}</div>
                <div className="flex flex-wrap gap-2">
                  {(discovery?.families ?? []).slice(0, 20).map((family) => (
                    <span key={family.code} className="rounded border px-2 py-1 text-xs">
                      {family.code}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{t('sync_akeneo.discovery.localChannels', 'Open Mercato channels')}</div>
                <div className="flex flex-wrap gap-2">
                  {(discovery?.localChannels ?? []).map((channel) => (
                    <span key={channel.code} className="rounded border px-2 py-1 text-xs">
                      {channel.code}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{t('sync_akeneo.discovery.priceKinds', 'Catalog price kinds')}</div>
                <div className="flex flex-wrap gap-2">
                  {(discovery?.priceKinds ?? []).map((priceKind) => (
                    <span key={priceKind.code} className="rounded border px-2 py-1 text-xs">
                      {priceKind.code}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">{t('sync_akeneo.discovery.attributes', 'Attributes')}</div>
                <div className="max-h-80 space-y-2 overflow-auto pr-1">
                  {(discovery?.attributes ?? []).map((attribute) => (
                    <div key={attribute.code} className="rounded border p-2 text-xs">
                      <div className="font-medium">{attribute.code}</div>
                      <div className="text-muted-foreground">
                        {attribute.type}
                        {attribute.localizable ? ' | localizable' : ''}
                        {attribute.scopable ? ' | channel-scoped' : ''}
                        {attribute.group ? ` | group:${attribute.group}` : ''}
                        {attribute.metricFamily ? ` | metric:${attribute.metricFamily}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <datalist id="akeneo-attributes">
          {attributeCodes.map((code) => (
            <option key={code} value={code} />
          ))}
        </datalist>
        <datalist id="akeneo-locales">
          {(discovery?.locales ?? []).map((locale) => (
            <option key={locale.code} value={locale.code} />
          ))}
        </datalist>
        <datalist id="akeneo-channels">
          {(discovery?.channels ?? []).map((channel) => (
            <option key={channel.code} value={channel.code} />
          ))}
        </datalist>
      </div>
    </div>
  )
}
