"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { PencilLine, Plus, RefreshCw, Save, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { buildAkeneoFieldsetCode, buildDefaultAkeneoMapping, buildProductFieldMappings, normalizeAkeneoMapping, type AkeneoReconciliationSettings } from '../../../lib/shared'
import { inferAkeneoProductMapping } from '../../../lib/inference'
import type { AkeneoDiscoveryResponse } from '../../../data/validators'

type MappingRecordResponse = {
  items?: Array<{
    id: string
    mapping: Record<string, unknown>
  }>
}

type CustomFieldStatusResponse = {
  ok: boolean
  productKeys: string[]
  variantKeys: string[]
  createdKeys?: string[]
  message?: string
}

type CustomFieldRow = {
  attributeCode: string
  target: 'product' | 'variant'
  fieldKey: string
  kind: '' | 'text' | 'multiline' | 'integer' | 'float' | 'boolean' | 'select'
}

type PriceMappingRow = {
  attributeCode: string
  priceKindCode: string
  akeneoChannel: string
  localChannelCode: string
}

type MediaMappingRow = {
  attributeCode: string
  target: 'product' | 'variant'
  kind: 'image' | 'file'
}

type FieldsetMappingRow = {
  sourceType: 'family' | 'familyVariant'
  sourceCode: string
  target: 'product' | 'variant'
  fieldsetCode: string
  fieldsetLabel: string
  description: string
}

type AkeneoWidgetContext = {
  state?: {
    isEnabled?: boolean
  } | null
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
  fieldsetMappings: string
  createMissingChannels: boolean
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
    priceMappings: serializePriceMappingRows(
      (productSettings?.priceMappings ?? []).map((entry) => ({
        attributeCode: entry.attributeCode,
        priceKindCode: entry.priceKindCode,
        akeneoChannel: entry.akeneoChannel ?? '',
        localChannelCode: entry.localChannelCode,
      })),
    ),
    mediaMappings: serializeMediaMappingRows(
      (productSettings?.mediaMappings ?? []).map((entry) => ({
        attributeCode: entry.attributeCode,
        target: entry.target,
        kind: entry.kind,
      })),
    ),
    fieldsetMappings: serializeFieldsetMappingRows(
      (productSettings?.fieldsetMappings ?? []).map((entry) => ({
        sourceType: entry.sourceType,
        sourceCode: entry.sourceCode,
        target: entry.target,
        fieldsetCode: entry.fieldsetCode,
        fieldsetLabel: entry.fieldsetLabel,
        description: entry.description ?? '',
      })),
    ),
    createMissingChannels: productSettings?.createMissingChannels ?? true,
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
    fieldsetMappings: (normalizedProducts.settings?.products?.fieldsetMappings ?? [])
      .map((entry) => `${entry.sourceType},${entry.sourceCode},${entry.target},${entry.fieldsetCode},${entry.fieldsetLabel}${entry.description ? `,${entry.description}` : ''}`)
      .join('\n'),
    createMissingChannels: normalizedProducts.settings?.products?.createMissingChannels ?? state.createMissingChannels,
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

function parseCustomFieldRows(value: string): CustomFieldRow[] {
  return parseRows(value)
    .map(([attributeCode, target, fieldKey, kind]) => {
      const normalizedTarget: CustomFieldRow['target'] = target === 'variant' ? 'variant' : 'product'
      const normalizedKind: CustomFieldRow['kind'] = kind === 'text'
        || kind === 'multiline'
        || kind === 'integer'
        || kind === 'float'
        || kind === 'boolean'
        || kind === 'select'
        ? kind
        : ''
      return {
        attributeCode,
        target: normalizedTarget,
        fieldKey,
        kind: normalizedKind,
      }
    })
    .filter((row) => row.attributeCode.length > 0 || row.fieldKey.length > 0)
}

function serializeCustomFieldRows(rows: CustomFieldRow[]): string {
  return rows
    .filter((row) => row.attributeCode.trim().length > 0 && row.fieldKey.trim().length > 0)
    .map((row) => `${row.attributeCode.trim()},${row.target},${row.fieldKey.trim()}${row.kind ? `,${row.kind}` : ''}`)
    .join('\n')
}

function parsePriceMappingRows(value: string): PriceMappingRow[] {
  return parseRows(value)
    .map(([attributeCode, priceKindCode, akeneoChannel, localChannelCode]) => ({
      attributeCode,
      priceKindCode,
      akeneoChannel: akeneoChannel ?? '',
      localChannelCode,
    }))
}

function serializePriceMappingRows(rows: PriceMappingRow[]): string {
  return rows
    .map((row) => [
      row.attributeCode.trim(),
      row.priceKindCode.trim(),
      row.akeneoChannel.trim(),
      row.localChannelCode.trim(),
    ].join(','))
    .join('\n')
}

function parseMediaMappingRows(value: string): MediaMappingRow[] {
  return parseRows(value)
    .map(([attributeCode, target, kind]) => ({
      attributeCode,
      target: target === 'variant' ? 'variant' : 'product',
      kind: kind === 'file' ? 'file' : 'image',
    }))
}

function serializeMediaMappingRows(rows: MediaMappingRow[]): string {
  return rows
    .map((row) => `${row.attributeCode.trim()},${row.target},${row.kind}`)
    .join('\n')
}

function parseFieldsetMappingRows(value: string): FieldsetMappingRow[] {
  return parseRows(value)
    .map(([sourceType, sourceCode, target, fieldsetCode, fieldsetLabel, ...descriptionParts]): FieldsetMappingRow => ({
      sourceType: sourceType === 'familyVariant' ? 'familyVariant' : 'family',
      sourceCode: sourceCode ?? '',
      target: target === 'variant' ? 'variant' : 'product',
      fieldsetCode: fieldsetCode ?? '',
      fieldsetLabel: fieldsetLabel ?? '',
      description: descriptionParts.join(','),
    }))
    .filter((row) => row.sourceCode.trim().length > 0 || row.fieldsetCode.trim().length > 0 || row.fieldsetLabel.trim().length > 0)
}

function serializeFieldsetMappingRows(rows: FieldsetMappingRow[]): string {
  return rows
    .filter((row) => row.sourceCode.trim().length > 0 && row.fieldsetCode.trim().length > 0 && row.fieldsetLabel.trim().length > 0)
    .map((row) => [
      row.sourceType,
      row.sourceCode.trim(),
      row.target,
      row.fieldsetCode.trim(),
      row.fieldsetLabel.trim(),
      row.description.trim(),
    ].filter((cell, index) => index < 5 || cell.length > 0).join(','))
    .join('\n')
}

function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
}

function inferCustomFieldKind(attributeType: string): CustomFieldRow['kind'] {
  if (attributeType === 'pim_catalog_boolean') return 'boolean'
  if (attributeType === 'pim_catalog_number') return 'float'
  if (attributeType === 'pim_catalog_metric') return 'float'
  if (attributeType === 'pim_catalog_textarea') return 'multiline'
  if (
    attributeType === 'pim_catalog_simpleselect'
    || attributeType === 'pim_catalog_multiselect'
    || attributeType === 'akeneo_reference_entity'
    || attributeType === 'akeneo_reference_entity_collection'
  ) {
    return 'select'
  }
  return 'text'
}

function inferPriceKindCode(attributeCode: string): string {
  const normalized = attributeCode.trim().toLowerCase()
  return normalized.includes('sale')
    || normalized.includes('promo')
    || normalized.includes('special')
    || normalized.includes('discount')
    ? 'sale'
    : 'regular'
}

function buildDiscoveredFieldsetMappings(discovery: AkeneoDiscoveryResponse): FieldsetMappingRow[] {
  return (discovery.families ?? []).flatMap((family) => {
    const productFieldsetCode = buildAkeneoFieldsetCode('product', family.code)
    const variantFieldsetCode = buildAkeneoFieldsetCode('variant', family.code)
    const productRow: FieldsetMappingRow[] = productFieldsetCode ? [{
      sourceType: 'family',
      sourceCode: family.code,
      target: 'product',
      fieldsetCode: productFieldsetCode,
      fieldsetLabel: family.label || family.code,
      description: `Akeneo family ${family.code}`,
    }] : []
    const variantRow: FieldsetMappingRow[] = variantFieldsetCode ? [{
      sourceType: 'family',
      sourceCode: family.code,
      target: 'variant',
      fieldsetCode: variantFieldsetCode,
      fieldsetLabel: family.label || family.code,
      description: `Akeneo variant attributes for family ${family.code}`,
    }] : []
    return [...productRow, ...variantRow]
  })
}

function applyDiscoveryDefaults(
  state: FormState,
  discovery: AkeneoDiscoveryResponse | null,
  options?: { overwriteMappings?: boolean },
): FormState {
  if (!discovery?.ok) return state

  const inferred = inferAkeneoProductMapping({
    attributes: (discovery.attributes ?? []).map((attribute) => ({
      code: attribute.code,
      type: attribute.type,
      labels: attribute.label ? { inferred: attribute.label } : undefined,
      localizable: attribute.localizable,
      scopable: attribute.scopable,
      group: attribute.group,
      metric_family: attribute.metricFamily,
    })),
    family: null,
    familyVariant: null,
    fieldMap: state.fieldMap,
    explicitCustomFieldMappings: parseCustomFieldRows(state.customFieldMappings).map((row) => ({
      attributeCode: row.attributeCode.trim(),
      target: row.target,
      fieldKey: row.fieldKey.trim(),
      kind: row.kind || null,
    })),
    explicitMediaMappings: parseMediaMappingRows(state.mediaMappings).map((row) => ({
      attributeCode: row.attributeCode.trim(),
      target: row.target,
      kind: row.kind,
    })),
  })

  const hasCustomFields = parseCustomFieldRows(state.customFieldMappings).length > 0
  const hasMediaMappings = parseMediaMappingRows(state.mediaMappings).length > 0
  const hasPriceMappings = parsePriceMappingRows(state.priceMappings).some((row) => row.attributeCode.trim().length > 0)
  const hasFieldsetMappings = parseFieldsetMappingRows(state.fieldsetMappings).length > 0
  const overwriteMappings = options?.overwriteMappings === true
  const preferredLocalChannel = discovery.localChannels.find((channel) => ['web', 'online', 'ecommerce', 'default'].includes(channel.code.trim().toLowerCase()))
    ?? discovery.localChannels[0]
    ?? null
  const preferredAkeneoChannel = discovery.channels[0]?.code ?? ''
  const preferredLocale = discovery.locales.find((locale) => locale.enabled)?.code
    ?? discovery.locales[0]?.code
    ?? state.productLocale

  return {
    ...state,
    productLocale: overwriteMappings || state.productLocale === 'en_US' ? preferredLocale : state.productLocale,
    categoryLocale: overwriteMappings || state.categoryLocale === 'en_US' ? preferredLocale : state.categoryLocale,
    productChannel: overwriteMappings ? preferredAkeneoChannel : (state.productChannel || preferredAkeneoChannel),
    fieldMap: inferred.fieldMap,
    customFieldMappings: !overwriteMappings && hasCustomFields
      ? state.customFieldMappings
      : serializeCustomFieldRows(
          inferred.autoCustomFieldMappings.map((mapping) => ({
            attributeCode: mapping.attributeCode,
            target: mapping.target,
            fieldKey: mapping.fieldKey,
            kind: mapping.kind ?? '',
          })),
        ),
    mediaMappings: !overwriteMappings && hasMediaMappings
      ? state.mediaMappings
      : serializeMediaMappingRows(
          inferred.autoMediaMappings.map((mapping) => ({
            attributeCode: mapping.attributeCode,
            target: mapping.target,
            kind: mapping.kind,
          })),
        ),
    fieldsetMappings: !overwriteMappings && hasFieldsetMappings
      ? state.fieldsetMappings
      : serializeFieldsetMappingRows(buildDiscoveredFieldsetMappings(discovery)),
    priceMappings: (!overwriteMappings && hasPriceMappings) || !preferredLocalChannel
      ? state.priceMappings
      : serializePriceMappingRows(
          inferred.autoPriceAttributeCodes.map((attributeCode) => ({
            attributeCode,
            priceKindCode: inferPriceKindCode(attributeCode),
            akeneoChannel: preferredAkeneoChannel,
            localChannelCode: preferredLocalChannel.code,
          })),
        ),
  }
}

export default function AkeneoConfigWidget(_props: InjectionWidgetComponentProps<AkeneoWidgetContext>) {
  const t = useT()
  const [state, setState] = React.useState<FormState>(() => buildInitialState())
  const [discovery, setDiscovery] = React.useState<AkeneoDiscoveryResponse | null>(null)
  const [customFieldStatus, setCustomFieldStatus] = React.useState<CustomFieldStatusResponse | null>(null)
  const [customFieldDialogOpen, setCustomFieldDialogOpen] = React.useState(false)
  const [customFieldEditorRows, setCustomFieldEditorRows] = React.useState<CustomFieldRow[]>([])
  const [isCreatingCustomFields, setIsCreatingCustomFields] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  const buildMappingPayloads = React.useCallback((currentState: FormState) => {
    const customFieldMappings = parseRows(currentState.customFieldMappings)
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
    const priceMappings = parseRows(currentState.priceMappings)
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
    const mediaMappings = parseRows(currentState.mediaMappings)
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
    const fieldsetMappings = parseFieldsetMappingRows(currentState.fieldsetMappings)
      .map((row) => {
        if (!row.sourceCode || !row.fieldsetCode || !row.fieldsetLabel) return null
        return {
          sourceType: row.sourceType,
          sourceCode: row.sourceCode.trim(),
          target: row.target,
          fieldsetCode: row.fieldsetCode.trim(),
          fieldsetLabel: row.fieldsetLabel.trim(),
          description: row.description.trim() || null,
        } as const
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    const productsMapping = {
      ...buildDefaultAkeneoMapping('products'),
      settings: {
        products: {
          locale: currentState.productLocale,
          channel: currentState.productChannel || null,
          fieldMap: { ...currentState.fieldMap },
          customFieldMappings,
          priceMappings,
          mediaMappings,
          fieldsetMappings,
          createMissingChannels: currentState.createMissingChannels,
          syncAssociations: currentState.syncAssociations,
          reconciliation: { ...currentState.reconciliation },
        },
      },
    }
    productsMapping.fields = buildProductFieldMappings(productsMapping.settings.products)

    const categoriesMapping = {
      ...buildDefaultAkeneoMapping('categories'),
      settings: {
        categories: {
          locale: currentState.categoryLocale,
        },
      },
    }

    const attributesMapping = {
      ...buildDefaultAkeneoMapping('attributes'),
      settings: {
        attributes: {
          includeTextAttributes: currentState.includeTextAttributes,
          includeNumericAttributes: currentState.includeNumericAttributes,
          familyCodeFilter: currentState.familyCodeFilter
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        },
      },
    }

    return { productsMapping, categoriesMapping, attributesMapping }
  }, [])

  const persistMappings = React.useCallback(async (
    currentState: FormState,
    options?: { successMessage?: string | null },
  ) => {
    const { productsMapping, categoriesMapping, attributesMapping } = buildMappingPayloads(currentState)
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

    if (options?.successMessage) {
      flash(options.successMessage, 'success')
    }
  }, [buildMappingPayloads])

  const load = React.useCallback(async (refresh = false) => {
    setIsLoading(true)
    try {
      const [discoveryCall, productsCall, categoriesCall, attributesCall, customFieldsCall] = await Promise.all([
        apiCall<AkeneoDiscoveryResponse>(`/api/sync_akeneo/discovery${refresh ? '?refresh=true' : ''}`),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=products&page=1&pageSize=1'),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=categories&page=1&pageSize=1'),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=attributes&page=1&pageSize=1'),
        apiCall<CustomFieldStatusResponse>('/api/sync_akeneo/custom-fields'),
      ])

      let nextState = mergeMappingsIntoState(
        buildInitialState(),
        productsCall.result?.items?.[0]?.mapping,
        categoriesCall.result?.items?.[0]?.mapping,
        attributesCall.result?.items?.[0]?.mapping,
      )
      nextState = applyDiscoveryDefaults(nextState, discoveryCall.result ?? null)

      const hasSavedMappings = Boolean(productsCall.result?.items?.[0] || categoriesCall.result?.items?.[0] || attributesCall.result?.items?.[0])
      if (!hasSavedMappings && discoveryCall.result?.ok) {
        try {
          await persistMappings(nextState)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to save discovered Akeneo mappings'
          flash(message, 'error')
        }
      }

      setState(nextState)
      setDiscovery(discoveryCall.result ?? null)
      setCustomFieldStatus(customFieldsCall.result ?? null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load Akeneo configuration'
      flash(message, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [persistMappings])

  React.useEffect(() => {
    void load(false)
  }, [load])

  const attributeCodes = React.useMemo(
    () => (discovery?.attributes ?? []).map((attribute) => attribute.code).sort(),
    [discovery],
  )
  const customFieldRows = React.useMemo(
    () => parseCustomFieldRows(state.customFieldMappings),
    [state.customFieldMappings],
  )
  const priceMappingRows = React.useMemo(
    () => parsePriceMappingRows(state.priceMappings),
    [state.priceMappings],
  )
  const mediaMappingRows = React.useMemo(
    () => parseMediaMappingRows(state.mediaMappings),
    [state.mediaMappings],
  )
  const fieldsetMappingRows = React.useMemo(
    () => parseFieldsetMappingRows(state.fieldsetMappings),
    [state.fieldsetMappings],
  )
  const productFieldKeys = React.useMemo(
    () => new Set(customFieldStatus?.productKeys ?? []),
    [customFieldStatus],
  )
  const variantFieldKeys = React.useMemo(
    () => new Set(customFieldStatus?.variantKeys ?? []),
    [customFieldStatus],
  )
  const missingCustomFieldCount = React.useMemo(
    () => customFieldRows.filter((row) => {
      if (!row.fieldKey.trim()) return false
      return row.target === 'product'
        ? !productFieldKeys.has(row.fieldKey.trim())
        : !variantFieldKeys.has(row.fieldKey.trim())
    }).length,
    [customFieldRows, productFieldKeys, variantFieldKeys],
  )
  const editorMappedAttributeCodes = React.useMemo(
    () => new Set(customFieldEditorRows.map((row) => row.attributeCode).filter((value) => value.length > 0)),
    [customFieldEditorRows],
  )
  const suggestedCustomFieldAttributes = React.useMemo(
    () => (discovery?.attributes ?? []).filter((attribute) => !editorMappedAttributeCodes.has(attribute.code)).slice(0, 24),
    [discovery, editorMappedAttributeCodes],
  )
  const dialogMissingCustomFieldCount = React.useMemo(
    () => customFieldEditorRows.filter((row) => {
      if (!row.fieldKey.trim()) return false
      return row.target === 'product'
        ? !productFieldKeys.has(row.fieldKey.trim())
        : !variantFieldKeys.has(row.fieldKey.trim())
    }).length,
    [customFieldEditorRows, productFieldKeys, variantFieldKeys],
  )

  function openCustomFieldDialog() {
    setCustomFieldEditorRows(parseCustomFieldRows(state.customFieldMappings))
    setCustomFieldDialogOpen(true)
  }

  async function createMissingCustomFields(sourceRows?: CustomFieldRow[]) {
    setIsCreatingCustomFields(true)
    try {
      const customFieldMappings = (sourceRows ?? parseCustomFieldRows(state.customFieldMappings))
      const currentProductsMapping = {
        ...buildDefaultAkeneoMapping('products'),
        settings: {
          products: {
            locale: state.productLocale,
            channel: state.productChannel || null,
            fieldMap: { ...state.fieldMap },
            customFieldMappings: customFieldMappings.map((row) => ({
              attributeCode: row.attributeCode.trim(),
              target: row.target,
              fieldKey: row.fieldKey.trim(),
              kind: row.kind || null,
            })),
            priceMappings: [],
            mediaMappings: [],
            fieldsetMappings: parseFieldsetMappingRows(state.fieldsetMappings).map((row) => ({
              sourceType: row.sourceType,
              sourceCode: row.sourceCode.trim(),
              target: row.target,
              fieldsetCode: row.fieldsetCode.trim(),
              fieldsetLabel: row.fieldsetLabel.trim(),
              description: row.description.trim() || null,
            })),
            createMissingChannels: state.createMissingChannels,
            syncAssociations: state.syncAssociations,
            reconciliation: { ...state.reconciliation },
          },
        },
      }
      currentProductsMapping.fields = buildProductFieldMappings(currentProductsMapping.settings.products)
      const result = await apiCall<CustomFieldStatusResponse>('/api/sync_akeneo/custom-fields', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapping: currentProductsMapping,
        }),
      })
      setCustomFieldStatus(result.result ?? null)
      flash(
        result.result?.message
          ?? t('sync_akeneo.customFields.created', 'Akeneo-backed custom fields created.'),
        'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create custom fields'
      flash(message, 'error')
    } finally {
      setIsCreatingCustomFields(false)
    }
  }

  function applyCustomFieldEditor() {
    setState((current) => ({
      ...current,
      customFieldMappings: serializeCustomFieldRows(customFieldEditorRows),
    }))
    setCustomFieldDialogOpen(false)
  }

  function updatePriceMappingRows(nextRows: PriceMappingRow[]) {
    setState((current) => ({
      ...current,
      priceMappings: serializePriceMappingRows(nextRows),
    }))
  }

  function updateMediaMappingRows(nextRows: MediaMappingRow[]) {
    setState((current) => ({
      ...current,
      mediaMappings: serializeMediaMappingRows(nextRows),
    }))
  }

  function updateFieldsetMappingRows(nextRows: FieldsetMappingRow[]) {
    setState((current) => ({
      ...current,
      fieldsetMappings: serializeFieldsetMappingRows(nextRows),
    }))
  }

  async function rediscoverAndOverwriteMappings() {
    setIsSaving(true)
    try {
      const discoveryCall = await apiCall<AkeneoDiscoveryResponse>('/api/sync_akeneo/discovery?refresh=true')
      const discovered = discoveryCall.result ?? null
      if (!discovered?.ok) {
        throw new Error(discovered?.message ?? 'Failed to load Akeneo discovery metadata')
      }

      const nextState = applyDiscoveryDefaults({
        ...state,
      }, discovered, { overwriteMappings: true })

      await persistMappings(nextState, {
        successMessage: t('sync_akeneo.discovery.rediscovered', 'Akeneo mappings rediscovered and saved.'),
      })

      setState(nextState)
      setDiscovery(discovered)
      const customFieldsCall = await apiCall<CustomFieldStatusResponse>('/api/sync_akeneo/custom-fields')
      setCustomFieldStatus(customFieldsCall.result ?? null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rediscover Akeneo mappings'
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  async function saveMappings() {
    setIsSaving(true)
    try {
      await persistMappings(state, {
        successMessage: t('sync_akeneo.saved', 'Akeneo sync settings saved.'),
      })
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
          compact
          message={t('sync_akeneo.setup.scheduleTab', 'Run once and recurring schedules now live in the dedicated Sync schedules tab, shared by all data sync integrations.')}
        />
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
              {t('sync_akeneo.mapping.help', 'Mappings are discovered automatically from the saved Akeneo credentials. You can review and override field, fieldset, price, channel, and media behavior here.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void load(true)} disabled={isLoading || isSaving}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('sync_akeneo.mapping.refresh', 'Refresh fields')}
            </Button>
            <Button type="button" variant="outline" onClick={() => void rediscoverAndOverwriteMappings()} disabled={isLoading || isSaving}>
              <Sparkles className="mr-2 h-4 w-4" />
              {t('sync_akeneo.mapping.rediscover', 'Rediscover and overwrite')}
            </Button>
          </div>
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
                <div className="flex items-center justify-between gap-3">
                  <Label>{t('sync_akeneo.mapping.customFields', 'Custom field mappings')}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => openCustomFieldDialog()} disabled={isLoading || isSaving}>
                      <PencilLine className="mr-2 h-4 w-4" />
                      {t('sync_akeneo.mapping.customFields.editor', 'Open editor')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void createMissingCustomFields()} disabled={isLoading || isSaving || isCreatingCustomFields || customFieldRows.length === 0}>
                      {isCreatingCustomFields ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                      {isCreatingCustomFields
                        ? t('sync_akeneo.mapping.customFields.creating', 'Creating...')
                        : t('sync_akeneo.mapping.customFields.createMissing', 'Create missing fields')}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.customFields.help', 'One mapping per line: attribute_code,target(product|variant),field_key[,kind]. The importer creates or updates Open Mercato custom field definitions and stores Akeneo metadata, validation rules, and groups on those fields.')}
                </p>
                {customFieldRows.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.from', 'From')}</th>
                          <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.target', 'Target')}</th>
                          <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.key', 'Field key')}</th>
                          <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.kind', 'Kind')}</th>
                          <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.status', 'Status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customFieldRows.map((row, index) => {
                          const exists = row.target === 'product'
                            ? productFieldKeys.has(row.fieldKey.trim())
                            : variantFieldKeys.has(row.fieldKey.trim())
                          return (
                            <tr key={`${row.attributeCode}:${row.fieldKey}:${index}`} className="border-t">
                              <td className="px-3 py-2 font-medium">{row.attributeCode}</td>
                              <td className="px-3 py-2">{row.target}</td>
                              <td className="px-3 py-2">{row.fieldKey}</td>
                              <td className="px-3 py-2 text-muted-foreground">{row.kind || t('sync_akeneo.customFields.kinds.auto', 'Auto')}</td>
                              <td className="px-3 py-2">
                                <span className={`rounded-full px-2 py-1 text-[11px] ${exists ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                  {exists
                                    ? t('sync_akeneo.customFields.status.ready', 'Exists')
                                    : t('sync_akeneo.customFields.status.missing', 'Missing')}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Notice compact>
                    {t('sync_akeneo.customFields.empty', 'No Akeneo custom fields are mapped yet. Use the editor to add structured mappings.')}
                  </Notice>
                )}
                {customFieldRows.length > 0 ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded border px-2 py-1">
                      {t('sync_akeneo.mapping.customFields.total', `${customFieldRows.length} mapped`)}
                    </span>
                    <span className={`rounded border px-2 py-1 ${missingCustomFieldCount > 0 ? 'border-amber-300 text-amber-700' : ''}`}>
                      {missingCustomFieldCount > 0
                        ? t('sync_akeneo.mapping.customFields.missing', `${missingCustomFieldCount} missing locally`)
                        : t('sync_akeneo.mapping.customFields.ready', 'All mapped fields already exist')}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>{t('sync_akeneo.mapping.prices', 'Price and offer mappings')}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => updatePriceMappingRows([
                      ...priceMappingRows,
                      { attributeCode: '', priceKindCode: '', akeneoChannel: '', localChannelCode: '' },
                    ])}
                    disabled={isLoading || isSaving}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('sync_akeneo.mapping.addRow', 'Add row')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.prices.help', 'One mapping per line: price_attribute,price_kind_code,akeneo_channel,local_channel_code. Each distinct local channel creates or updates an offer, and each price collection entry becomes a Catalog Product Price in the matching currency.')}
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.from', 'From')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.priceKind', 'Price kind')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.akeneoChannel', 'Akeneo channel')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.localChannel', 'Open Mercato channel')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.actions', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceMappingRows.length > 0 ? priceMappingRows.map((row, index) => (
                        <tr key={`price-mapping-${index}`} className="border-t">
                          <td className="px-3 py-2">
                            <Input
                              list="akeneo-attributes"
                              value={row.attributeCode}
                              onChange={(event) => {
                                const nextRows = [...priceMappingRows]
                                nextRows[index] = { ...row, attributeCode: event.target.value }
                                updatePriceMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={row.priceKindCode}
                              onChange={(event) => {
                                const nextRows = [...priceMappingRows]
                                nextRows[index] = { ...row, priceKindCode: event.target.value }
                                updatePriceMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              list="akeneo-channels"
                              value={row.akeneoChannel}
                              onChange={(event) => {
                                const nextRows = [...priceMappingRows]
                                nextRows[index] = { ...row, akeneoChannel: event.target.value }
                                updatePriceMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                              placeholder={t('sync_akeneo.mapping.channelPlaceholder', 'Optional')}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={row.localChannelCode}
                              onChange={(event) => {
                                const nextRows = [...priceMappingRows]
                                nextRows[index] = { ...row, localChannelCode: event.target.value }
                                updatePriceMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => updatePriceMappingRows(priceMappingRows.filter((_, rowIndex) => rowIndex !== index))}
                              disabled={isLoading || isSaving}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('sync_akeneo.customFields.actions.remove', 'Remove')}
                            </Button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                            {t('sync_akeneo.mapping.emptyPrices', 'No price mappings configured yet.')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>{t('sync_akeneo.mapping.media', 'Media and attachment mappings')}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => updateMediaMappingRows([
                      ...mediaMappingRows,
                      { attributeCode: '', target: 'product', kind: 'image' },
                    ])}
                    disabled={isLoading || isSaving}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('sync_akeneo.mapping.addRow', 'Add row')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.media.help', 'One mapping per line: attribute_code,target(product|variant),kind(image|file). Image mappings are re-hosted into Open Mercato attachments and can become default media; file mappings are imported as attachments.')}
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.from', 'From')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.target', 'Target')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.kind', 'Kind')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.actions', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mediaMappingRows.length > 0 ? mediaMappingRows.map((row, index) => (
                        <tr key={`media-mapping-${index}`} className="border-t">
                          <td className="px-3 py-2">
                            <Input
                              list="akeneo-attributes"
                              value={row.attributeCode}
                              onChange={(event) => {
                                const nextRows = [...mediaMappingRows]
                                nextRows[index] = { ...row, attributeCode: event.target.value }
                                updateMediaMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={row.target}
                              onChange={(event) => {
                                const nextRows = [...mediaMappingRows]
                                nextRows[index] = { ...row, target: event.target.value === 'variant' ? 'variant' : 'product' }
                                updateMediaMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            >
                              <option value="product">{t('sync_akeneo.customFields.targets.product', 'Product')}</option>
                              <option value="variant">{t('sync_akeneo.customFields.targets.variant', 'Variant')}</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={row.kind}
                              onChange={(event) => {
                                const nextRows = [...mediaMappingRows]
                                nextRows[index] = { ...row, kind: event.target.value === 'file' ? 'file' : 'image' }
                                updateMediaMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            >
                              <option value="image">{t('sync_akeneo.mapping.mediaKinds.image', 'Image')}</option>
                              <option value="file">{t('sync_akeneo.mapping.mediaKinds.file', 'File')}</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => updateMediaMappingRows(mediaMappingRows.filter((_, rowIndex) => rowIndex !== index))}
                              disabled={isLoading || isSaving}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('sync_akeneo.customFields.actions.remove', 'Remove')}
                            </Button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                            {t('sync_akeneo.mapping.emptyMedia', 'No media mappings configured yet.')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label>{t('sync_akeneo.mapping.fieldsets', 'Family to fieldset mappings')}</Label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => updateFieldsetMappingRows([
                      ...fieldsetMappingRows,
                      {
                        sourceType: 'family',
                        sourceCode: '',
                        target: 'product',
                        fieldsetCode: '',
                        fieldsetLabel: '',
                        description: '',
                      },
                    ])}
                    disabled={isLoading || isSaving}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t('sync_akeneo.mapping.addRow', 'Add row')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.fieldsets.help', 'Discovered Akeneo families become Open Mercato fieldsets automatically. Adjust the fieldset code, label, or description here, and add manual family-variant rows when a specific Akeneo family variant should use a different variant fieldset.')}
                </p>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.sourceType', 'Source type')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.sourceCode', 'Akeneo code')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.target', 'Target')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.fieldsetCode', 'Fieldset code')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.fieldsetLabel', 'Fieldset label')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.mapping.fieldsetDescription', 'Description')}</th>
                        <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.actions', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fieldsetMappingRows.length > 0 ? fieldsetMappingRows.map((row, index) => (
                        <tr key={`fieldset-mapping-${index}`} className="border-t">
                          <td className="px-3 py-2">
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={row.sourceType}
                              onChange={(event) => {
                                const nextRows = [...fieldsetMappingRows]
                                nextRows[index] = {
                                  ...row,
                                  sourceType: event.target.value === 'familyVariant' ? 'familyVariant' : 'family',
                                }
                                updateFieldsetMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            >
                              <option value="family">{t('sync_akeneo.mapping.sourceType.family', 'Family')}</option>
                              <option value="familyVariant">{t('sync_akeneo.mapping.sourceType.familyVariant', 'Family variant')}</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={row.sourceCode}
                              onChange={(event) => {
                                const nextRows = [...fieldsetMappingRows]
                                const sourceCode = event.target.value
                                nextRows[index] = {
                                  ...row,
                                  sourceCode,
                                  fieldsetCode: row.fieldsetCode || buildAkeneoFieldsetCode(row.target, sourceCode) || '',
                                }
                                updateFieldsetMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                              list={row.sourceType === 'family' ? 'akeneo-families' : undefined}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={row.target}
                              onChange={(event) => {
                                const nextRows = [...fieldsetMappingRows]
                                const target = event.target.value === 'variant' ? 'variant' : 'product'
                                nextRows[index] = {
                                  ...row,
                                  target,
                                  fieldsetCode: buildAkeneoFieldsetCode(target, row.sourceCode) || row.fieldsetCode,
                                }
                                updateFieldsetMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            >
                              <option value="product">{t('sync_akeneo.customFields.targets.product', 'Product')}</option>
                              <option value="variant">{t('sync_akeneo.customFields.targets.variant', 'Variant')}</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={row.fieldsetCode}
                              onChange={(event) => {
                                const nextRows = [...fieldsetMappingRows]
                                nextRows[index] = { ...row, fieldsetCode: normalizeFieldKey(event.target.value) }
                                updateFieldsetMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={row.fieldsetLabel}
                              onChange={(event) => {
                                const nextRows = [...fieldsetMappingRows]
                                nextRows[index] = { ...row, fieldsetLabel: event.target.value }
                                updateFieldsetMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={row.description}
                              onChange={(event) => {
                                const nextRows = [...fieldsetMappingRows]
                                nextRows[index] = { ...row, description: event.target.value }
                                updateFieldsetMappingRows(nextRows)
                              }}
                              disabled={isLoading || isSaving}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => updateFieldsetMappingRows(fieldsetMappingRows.filter((_, rowIndex) => rowIndex !== index))}
                              disabled={isLoading || isSaving}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('sync_akeneo.customFields.actions.remove', 'Remove')}
                            </Button>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                            {t('sync_akeneo.mapping.emptyFieldsets', 'No family fieldset mappings discovered yet. Save credentials and use rediscovery to generate them.')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
                  checked={state.createMissingChannels}
                  onChange={(event) => setState((current) => ({ ...current, createMissingChannels: event.target.checked }))}
                  disabled={isLoading || isSaving}
                />
                <span>{t('sync_akeneo.mapping.createMissingChannels', 'Create missing Open Mercato sales channels from Akeneo scopes by default')}</span>
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
                <Save className="mr-2 h-4 w-4" />
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
        <datalist id="akeneo-families">
          {(discovery?.families ?? []).map((family) => (
            <option key={family.code} value={family.code} />
          ))}
        </datalist>
      </div>

      <Dialog open={customFieldDialogOpen} onOpenChange={setCustomFieldDialogOpen}>
        <DialogContent
          className="sm:max-w-5xl"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              applyCustomFieldEditor()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('sync_akeneo.customFields.dialog.title', 'Akeneo custom field editor')}</DialogTitle>
            <DialogDescription>
              {t('sync_akeneo.customFields.dialog.description', 'Edit structured custom-field mappings, review which local field definitions already exist, and generate missing ones immediately.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border px-2 py-1 text-xs">
                {t('sync_akeneo.customFields.dialog.summary.total', `${customFieldEditorRows.length} mapping rows`)}
              </span>
              <span className={`rounded border px-2 py-1 text-xs ${dialogMissingCustomFieldCount > 0 ? 'border-amber-300 text-amber-700' : ''}`}>
                {dialogMissingCustomFieldCount > 0
                  ? t('sync_akeneo.customFields.dialog.summary.missing', `${dialogMissingCustomFieldCount} rows missing local fields`)
                  : t('sync_akeneo.customFields.dialog.summary.ready', 'Everything in this mapping already exists locally')}
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.attribute', 'Akeneo attribute')}</th>
                    <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.target', 'Target')}</th>
                    <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.key', 'Field key')}</th>
                    <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.kind', 'Kind')}</th>
                    <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.status', 'Status')}</th>
                    <th className="px-3 py-2 font-medium">{t('sync_akeneo.customFields.columns.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {customFieldEditorRows.length > 0 ? customFieldEditorRows.map((row, index) => {
                    const exists = row.target === 'product'
                      ? productFieldKeys.has(row.fieldKey.trim())
                      : variantFieldKeys.has(row.fieldKey.trim())
                    return (
                      <tr key={`${row.attributeCode}:${row.fieldKey}:${index}`} className="border-t">
                        <td className="px-3 py-2">
                          <Input
                            list="akeneo-attributes"
                            value={row.attributeCode}
                            onChange={(event) => {
                              const nextRows = [...customFieldEditorRows]
                              nextRows[index] = { ...row, attributeCode: event.target.value }
                              setCustomFieldEditorRows(nextRows)
                            }}
                            disabled={isLoading || isSaving || isCreatingCustomFields}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                            value={row.target}
                            onChange={(event) => {
                              const nextRows = [...customFieldEditorRows]
                              nextRows[index] = { ...row, target: event.target.value === 'variant' ? 'variant' : 'product' }
                              setCustomFieldEditorRows(nextRows)
                            }}
                            disabled={isLoading || isSaving || isCreatingCustomFields}
                          >
                            <option value="product">{t('sync_akeneo.customFields.targets.product', 'Product')}</option>
                            <option value="variant">{t('sync_akeneo.customFields.targets.variant', 'Variant')}</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={row.fieldKey}
                            onChange={(event) => {
                              const nextRows = [...customFieldEditorRows]
                              nextRows[index] = { ...row, fieldKey: normalizeFieldKey(event.target.value) }
                              setCustomFieldEditorRows(nextRows)
                            }}
                            disabled={isLoading || isSaving || isCreatingCustomFields}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2"
                            value={row.kind}
                            onChange={(event) => {
                              const nextRows = [...customFieldEditorRows]
                              nextRows[index] = {
                                ...row,
                                kind: event.target.value === ''
                                  ? ''
                                  : event.target.value as CustomFieldRow['kind'],
                              }
                              setCustomFieldEditorRows(nextRows)
                            }}
                            disabled={isLoading || isSaving || isCreatingCustomFields}
                          >
                            <option value="">{t('sync_akeneo.customFields.kinds.auto', 'Auto')}</option>
                            <option value="text">text</option>
                            <option value="multiline">multiline</option>
                            <option value="integer">integer</option>
                            <option value="float">float</option>
                            <option value="boolean">boolean</option>
                            <option value="select">select</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded border px-2 py-1 text-xs ${exists ? '' : 'border-amber-300 text-amber-700'}`}>
                            {exists
                              ? t('sync_akeneo.customFields.status.ready', 'Exists')
                              : t('sync_akeneo.customFields.status.missing', 'Missing')}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              const nextRows = customFieldEditorRows.filter((_, rowIndex) => rowIndex !== index)
                              setCustomFieldEditorRows(nextRows)
                            }}
                            disabled={isLoading || isSaving || isCreatingCustomFields}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('sync_akeneo.customFields.actions.remove', 'Remove')}
                          </Button>
                        </td>
                      </tr>
                    )
                  }) : (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {t('sync_akeneo.customFields.empty', 'No Akeneo custom fields are mapped yet. Use the suggestions below or add a row manually.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCustomFieldEditorRows([
                  ...customFieldEditorRows,
                  { attributeCode: '', target: 'product', fieldKey: '', kind: '' },
                ])}
                disabled={isLoading || isSaving || isCreatingCustomFields}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('sync_akeneo.customFields.actions.add', 'Add row')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void createMissingCustomFields(customFieldEditorRows)}
                disabled={isLoading || isSaving || isCreatingCustomFields || customFieldEditorRows.length === 0}
              >
                {isCreatingCustomFields ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {isCreatingCustomFields
                  ? t('sync_akeneo.customFields.actions.creating', 'Creating...')
                  : t('sync_akeneo.customFields.actions.createMissing', 'Create missing fields now')}
              </Button>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-3">
                <h4 className="text-sm font-medium">{t('sync_akeneo.customFields.suggestions.title', 'Suggested Akeneo attributes')}</h4>
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.customFields.suggestions.help', 'Quick-add discovered attributes that are not yet part of the Akeneo custom-field mapping.')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestedCustomFieldAttributes.map((attribute) => (
                  <Button
                    key={attribute.code}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setCustomFieldEditorRows([
                        ...customFieldEditorRows,
                        {
                          attributeCode: attribute.code,
                          target: 'product',
                          fieldKey: normalizeFieldKey(`akeneo_${attribute.code}`),
                          kind: inferCustomFieldKind(attribute.type),
                        },
                      ])
                    }}
                    disabled={isLoading || isSaving || isCreatingCustomFields}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {attribute.code}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={() => applyCustomFieldEditor()}
              disabled={isCreatingCustomFields}
            >
              <Save className="mr-2 h-4 w-4" />
              {t('sync_akeneo.customFields.dialog.apply', 'Apply')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setCustomFieldDialogOpen(false)} disabled={isCreatingCustomFields}>
              <X className="mr-2 h-4 w-4" />
              {t('sync_akeneo.customFields.dialog.close', 'Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
