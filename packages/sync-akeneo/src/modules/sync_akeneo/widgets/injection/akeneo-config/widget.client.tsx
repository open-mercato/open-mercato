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
import { buildDefaultAkeneoMapping, buildProductFieldMappings, normalizeAkeneoMapping, type AkeneoReconciliationSettings } from '../../../lib/shared'
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

type SyncScheduleRecord = {
  id: string
  entityType: string
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  fullSync: boolean
  isEnabled: boolean
  lastRunAt: string | null
}

type SyncScheduleResponse = {
  items?: SyncScheduleRecord[]
}

type ScheduleEditorState = {
  id?: string
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  fullSync: boolean
  isEnabled: boolean
  lastRunAt: string | null
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

const DEFAULT_WIDGET_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const SYNC_TARGETS: Array<{
  entityType: 'categories' | 'attributes' | 'products'
  label: string
  description: string
  defaultScheduleType: 'cron' | 'interval'
  defaultScheduleValue: string
  defaultFullSync: boolean
}> = [
  {
    entityType: 'categories',
    label: 'Categories',
    description: 'Create or refresh the Akeneo category tree before other imports.',
    defaultScheduleType: 'interval',
    defaultScheduleValue: '6h',
    defaultFullSync: true,
  },
  {
    entityType: 'attributes',
    label: 'Attributes',
    description: 'Sync family-driven schemas and mapped Akeneo custom fields.',
    defaultScheduleType: 'interval',
    defaultScheduleValue: '6h',
    defaultFullSync: true,
  },
  {
    entityType: 'products',
    label: 'Products',
    description: 'Import products, variants, prices, offers, media, and associations.',
    defaultScheduleType: 'interval',
    defaultScheduleValue: '1h',
    defaultFullSync: false,
  },
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
    .filter((row) => (
      row.attributeCode.length > 0
      || row.priceKindCode.length > 0
      || row.akeneoChannel.length > 0
      || row.localChannelCode.length > 0
    ))
}

function serializePriceMappingRows(rows: PriceMappingRow[]): string {
  return rows
    .filter((row) => (
      row.attributeCode.trim().length > 0
      && row.priceKindCode.trim().length > 0
      && row.localChannelCode.trim().length > 0
    ))
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
    .filter((row) => row.attributeCode.length > 0)
}

function serializeMediaMappingRows(rows: MediaMappingRow[]): string {
  return rows
    .filter((row) => row.attributeCode.trim().length > 0)
    .map((row) => `${row.attributeCode.trim()},${row.target},${row.kind}`)
    .join('\n')
}

function buildDefaultScheduleState(entityType: (typeof SYNC_TARGETS)[number]['entityType']): ScheduleEditorState {
  const target = SYNC_TARGETS.find((item) => item.entityType === entityType)
  return {
    scheduleType: target?.defaultScheduleType ?? 'interval',
    scheduleValue: target?.defaultScheduleValue ?? '1h',
    timezone: DEFAULT_WIDGET_TIMEZONE,
    fullSync: target?.defaultFullSync ?? false,
    isEnabled: true,
    lastRunAt: null,
  }
}

function buildScheduleEditors(records: SyncScheduleRecord[] | undefined): Record<string, ScheduleEditorState> {
  return Object.fromEntries(
    SYNC_TARGETS.map((target) => {
      const record = records?.find((item) => item.entityType === target.entityType)
      return [
        target.entityType,
        record
          ? {
            id: record.id,
            scheduleType: record.scheduleType,
            scheduleValue: record.scheduleValue,
            timezone: record.timezone,
            fullSync: record.fullSync,
            isEnabled: record.isEnabled,
            lastRunAt: record.lastRunAt,
          }
          : buildDefaultScheduleState(target.entityType),
      ]
    }),
  )
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

export default function AkeneoConfigWidget(props: InjectionWidgetComponentProps<AkeneoWidgetContext>) {
  const t = useT()
  const [state, setState] = React.useState<FormState>(() => buildInitialState())
  const [schedules, setSchedules] = React.useState<Record<string, ScheduleEditorState>>(() => buildScheduleEditors(undefined))
  const [discovery, setDiscovery] = React.useState<AkeneoDiscoveryResponse | null>(null)
  const [customFieldStatus, setCustomFieldStatus] = React.useState<CustomFieldStatusResponse | null>(null)
  const [customFieldDialogOpen, setCustomFieldDialogOpen] = React.useState(false)
  const [customFieldEditorRows, setCustomFieldEditorRows] = React.useState<CustomFieldRow[]>([])
  const [isCreatingCustomFields, setIsCreatingCustomFields] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [runningEntityType, setRunningEntityType] = React.useState<string | null>(null)
  const [savingScheduleEntityType, setSavingScheduleEntityType] = React.useState<string | null>(null)
  const [deletingScheduleEntityType, setDeletingScheduleEntityType] = React.useState<string | null>(null)
  const integrationEnabled = props.context?.state?.isEnabled ?? false

  const load = React.useCallback(async (refresh = false) => {
    setIsLoading(true)
    try {
      const [discoveryCall, productsCall, categoriesCall, attributesCall, customFieldsCall, schedulesCall] = await Promise.all([
        apiCall<AkeneoDiscoveryResponse>(`/api/sync_akeneo/discovery${refresh ? '?refresh=true' : ''}`),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=products&page=1&pageSize=1'),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=categories&page=1&pageSize=1'),
        apiCall<MappingRecordResponse>('/api/data_sync/mappings?integrationId=sync_akeneo&entityType=attributes&page=1&pageSize=1'),
        apiCall<CustomFieldStatusResponse>('/api/sync_akeneo/custom-fields'),
        apiCall<SyncScheduleResponse>('/api/data_sync/schedules?integrationId=sync_akeneo&page=1&pageSize=20'),
      ])

      const nextState = mergeMappingsIntoState(
        buildInitialState(),
        productsCall.result?.items?.[0]?.mapping,
        categoriesCall.result?.items?.[0]?.mapping,
        attributesCall.result?.items?.[0]?.mapping,
      )

      setState(nextState)
      setDiscovery(discoveryCall.result ?? null)
      setCustomFieldStatus(customFieldsCall.result ?? null)
      setSchedules(buildScheduleEditors(schedulesCall.result?.items))
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

  function updateScheduleEditor(entityType: string, patch: Partial<ScheduleEditorState>) {
    setSchedules((current) => ({
      ...current,
      [entityType]: {
        ...(current[entityType] ?? buildDefaultScheduleState(entityType as (typeof SYNC_TARGETS)[number]['entityType'])),
        ...patch,
      },
    }))
  }

  async function startSync(entityType: (typeof SYNC_TARGETS)[number]['entityType']) {
    if (!integrationEnabled) {
      flash(t('sync_akeneo.run.integrationDisabled', 'Enable the integration before starting a sync run.'), 'error')
      return
    }

    setRunningEntityType(entityType)
    try {
      const scheduleState = schedules[entityType] ?? buildDefaultScheduleState(entityType)
      const result = await apiCall<{ id: string }>('/api/data_sync/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrationId: 'sync_akeneo',
          entityType,
          direction: 'import',
          fullSync: scheduleState.fullSync,
          batchSize: 100,
        }),
      })

      if (!result.ok) {
        throw new Error((result.result as { error?: string } | null)?.error ?? 'Failed to start Akeneo sync')
      }

      flash(t('sync_akeneo.run.started', `${entityType} sync started. Open Data Sync to track progress.`), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start Akeneo sync'
      flash(message, 'error')
    } finally {
      setRunningEntityType(null)
    }
  }

  async function saveSchedule(entityType: (typeof SYNC_TARGETS)[number]['entityType']) {
    const scheduleState = schedules[entityType] ?? buildDefaultScheduleState(entityType)
    setSavingScheduleEntityType(entityType)
    try {
      const result = await apiCall<SyncScheduleRecord>('/api/data_sync/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          integrationId: 'sync_akeneo',
          entityType,
          direction: 'import',
          scheduleType: scheduleState.scheduleType,
          scheduleValue: scheduleState.scheduleValue,
          timezone: scheduleState.timezone,
          fullSync: scheduleState.fullSync,
          isEnabled: scheduleState.isEnabled,
        }),
      })

      if (!result.ok || !result.result) {
        throw new Error((result.result as { error?: string } | null)?.error ?? 'Failed to save schedule')
      }

      updateScheduleEditor(entityType, {
        id: result.result.id,
        scheduleType: result.result.scheduleType,
        scheduleValue: result.result.scheduleValue,
        timezone: result.result.timezone,
        fullSync: result.result.fullSync,
        isEnabled: result.result.isEnabled,
        lastRunAt: result.result.lastRunAt,
      })
      flash(t('sync_akeneo.schedule.saved', `${entityType} schedule saved.`), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save schedule'
      flash(message, 'error')
    } finally {
      setSavingScheduleEntityType(null)
    }
  }

  async function deleteSchedule(entityType: (typeof SYNC_TARGETS)[number]['entityType']) {
    const scheduleState = schedules[entityType]
    if (!scheduleState?.id) {
      updateScheduleEditor(entityType, buildDefaultScheduleState(entityType))
      return
    }

    setDeletingScheduleEntityType(entityType)
    try {
      const result = await apiCall(`/api/data_sync/schedules/${encodeURIComponent(scheduleState.id)}`, {
        method: 'DELETE',
      })

      if (!result.ok) {
        throw new Error((result.result as { error?: string } | null)?.error ?? 'Failed to delete schedule')
      }

      setSchedules((current) => ({
        ...current,
        [entityType]: buildDefaultScheduleState(entityType),
      }))
      flash(t('sync_akeneo.schedule.deleted', `${entityType} schedule removed.`), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete schedule'
      flash(message, 'error')
    } finally {
      setDeletingScheduleEntityType(null)
    }
  }

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
        <div>
          <h3 className="text-sm font-semibold">{t('sync_akeneo.run.heading', 'Run and schedule syncs')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('sync_akeneo.run.help', 'Start the first import directly from here, then save recurring runs per entity without leaving the Akeneo settings page.')}
          </p>
        </div>

        {!integrationEnabled ? (
          <Notice compact variant="warning">
            {t('sync_akeneo.run.integrationDisabled', 'Enable the integration first. Saved schedules stay here, but disabled integrations do not run until you switch them on.')}
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          {SYNC_TARGETS.map((target, index) => {
            const scheduleState = schedules[target.entityType] ?? buildDefaultScheduleState(target.entityType)
            const isRunning = runningEntityType === target.entityType
            const isSavingSchedule = savingScheduleEntityType === target.entityType
            const isDeletingSchedule = deletingScheduleEntityType === target.entityType
            return (
              <div key={target.entityType} className="space-y-4 rounded-lg border p-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-medium">
                      {index + 1}. {t(`sync_akeneo.run.targets.${target.entityType}.title`, target.label)}
                    </h4>
                    <span className={`rounded-full px-2 py-1 text-[11px] ${scheduleState.isEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                      {scheduleState.id
                        ? (scheduleState.isEnabled ? t('sync_akeneo.schedule.status.enabled', 'Scheduled') : t('sync_akeneo.schedule.status.disabled', 'Paused'))
                        : t('sync_akeneo.schedule.status.notConfigured', 'No schedule')}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t(`sync_akeneo.run.targets.${target.entityType}.description`, target.description)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {scheduleState.lastRunAt
                      ? t('sync_akeneo.schedule.lastRun', `Last run: ${new Date(scheduleState.lastRunAt).toLocaleString()}`)
                      : t('sync_akeneo.schedule.notRunYet', 'No successful scheduled run yet.')}
                  </p>
                </div>

                <div className="grid gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`akeneo-schedule-type-${target.entityType}`}>{t('sync_akeneo.schedule.type', 'Schedule type')}</Label>
                    <select
                      id={`akeneo-schedule-type-${target.entityType}`}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={scheduleState.scheduleType}
                      onChange={(event) => updateScheduleEditor(target.entityType, {
                        scheduleType: event.target.value === 'cron' ? 'cron' : 'interval',
                      })}
                      disabled={isLoading || isSavingSchedule || isDeletingSchedule}
                    >
                      <option value="interval">{t('sync_akeneo.schedule.interval', 'Interval')}</option>
                      <option value="cron">{t('sync_akeneo.schedule.cron', 'Cron')}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`akeneo-schedule-value-${target.entityType}`}>
                      {scheduleState.scheduleType === 'cron'
                        ? t('sync_akeneo.schedule.cronValue', 'Cron expression')
                        : t('sync_akeneo.schedule.intervalValue', 'Interval')}
                    </Label>
                    <Input
                      id={`akeneo-schedule-value-${target.entityType}`}
                      value={scheduleState.scheduleValue}
                      onChange={(event) => updateScheduleEditor(target.entityType, { scheduleValue: event.target.value })}
                      disabled={isLoading || isSavingSchedule || isDeletingSchedule}
                      placeholder={scheduleState.scheduleType === 'cron' ? '0 * * * *' : '1h'}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`akeneo-schedule-timezone-${target.entityType}`}>{t('sync_akeneo.schedule.timezone', 'Timezone')}</Label>
                    <Input
                      id={`akeneo-schedule-timezone-${target.entityType}`}
                      value={scheduleState.timezone}
                      onChange={(event) => updateScheduleEditor(target.entityType, { timezone: event.target.value })}
                      disabled={isLoading || isSavingSchedule || isDeletingSchedule}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scheduleState.fullSync}
                      onChange={(event) => updateScheduleEditor(target.entityType, { fullSync: event.target.checked })}
                      disabled={isLoading || isSavingSchedule || isDeletingSchedule}
                    />
                    <span>{t('sync_akeneo.schedule.fullSync', 'Run full sync')}</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scheduleState.isEnabled}
                      onChange={(event) => updateScheduleEditor(target.entityType, { isEnabled: event.target.checked })}
                      disabled={isLoading || isSavingSchedule || isDeletingSchedule}
                    />
                    <span>{t('sync_akeneo.schedule.enabled', 'Schedule enabled')}</span>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void startSync(target.entityType)}
                    disabled={isLoading || isRunning || !integrationEnabled}
                  >
                    {isRunning
                      ? t('sync_akeneo.run.starting', 'Starting...')
                      : t('sync_akeneo.run.start', 'Start now')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void saveSchedule(target.entityType)}
                    disabled={isLoading || isSavingSchedule}
                  >
                    {isSavingSchedule
                      ? t('sync_akeneo.schedule.saving', 'Saving...')
                      : t('sync_akeneo.schedule.save', 'Save schedule')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void deleteSchedule(target.entityType)}
                    disabled={isLoading || isDeletingSchedule || !scheduleState.id}
                  >
                    {isDeletingSchedule
                      ? t('sync_akeneo.schedule.deleting', 'Deleting...')
                      : t('sync_akeneo.schedule.delete', 'Remove')}
                  </Button>
                </div>
              </div>
            )
          })}
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
                <div className="flex items-center justify-between gap-3">
                  <Label>{t('sync_akeneo.mapping.customFields', 'Custom field mappings')}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => openCustomFieldDialog()} disabled={isLoading || isSaving}>
                      {t('sync_akeneo.mapping.customFields.editor', 'Open editor')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void createMissingCustomFields()} disabled={isLoading || isSaving || isCreatingCustomFields || customFieldRows.length === 0}>
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
                  <div className="space-y-2 rounded-lg border p-3">
                    {customFieldRows.map((row) => {
                      const exists = row.target === 'product'
                        ? productFieldKeys.has(row.fieldKey.trim())
                        : variantFieldKeys.has(row.fieldKey.trim())
                      return (
                        <div key={`${row.attributeCode}:${row.fieldKey}`} className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_auto_1fr_auto] md:items-center">
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('sync_akeneo.mapping.from', 'From')}</div>
                            <div className="text-sm font-medium">{row.attributeCode}</div>
                          </div>
                          <div className="text-center text-muted-foreground">→</div>
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('sync_akeneo.mapping.to', 'To')}</div>
                            <div className="text-sm font-medium">{row.target}.{row.fieldKey}</div>
                            <div className="text-xs text-muted-foreground">{row.kind || t('sync_akeneo.customFields.kinds.auto', 'Auto')}</div>
                          </div>
                          <div className={`rounded-full px-2 py-1 text-[11px] ${exists ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                            {exists
                              ? t('sync_akeneo.customFields.status.ready', 'Exists')
                              : t('sync_akeneo.customFields.status.missing', 'Missing')}
                          </div>
                        </div>
                      )
                    })}
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
                    {t('sync_akeneo.mapping.addRow', 'Add row')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.prices.help', 'One mapping per line: price_attribute,price_kind_code,akeneo_channel,local_channel_code. Each distinct local channel creates or updates an offer, and each price collection entry becomes a Catalog Product Price in the matching currency.')}
                </p>
                <div className="space-y-2 rounded-lg border p-3">
                  {priceMappingRows.length > 0 ? priceMappingRows.map((row, index) => (
                    <div key={`price-mapping-${index}`} className="grid gap-2 rounded-md border p-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto] lg:items-end">
                      <div className="space-y-1">
                        <Label>{t('sync_akeneo.mapping.from', 'From')}</Label>
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
                      </div>
                      <div className="pb-2 text-center text-muted-foreground">→</div>
                      <div className="space-y-1">
                        <Label>{t('sync_akeneo.mapping.priceKind', 'Price kind')}</Label>
                        <Input
                          value={row.priceKindCode}
                          onChange={(event) => {
                            const nextRows = [...priceMappingRows]
                            nextRows[index] = { ...row, priceKindCode: event.target.value }
                            updatePriceMappingRows(nextRows)
                          }}
                          disabled={isLoading || isSaving}
                        />
                      </div>
                      <div className="pb-2 text-center text-muted-foreground">@</div>
                      <div className="space-y-1">
                        <Label>{t('sync_akeneo.mapping.akeneoChannel', 'Akeneo channel')}</Label>
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
                      </div>
                      <div className="pb-2 text-center text-muted-foreground">→</div>
                      <div className="space-y-1">
                        <Label>{t('sync_akeneo.mapping.localChannel', 'Open Mercato channel')}</Label>
                        <Input
                          value={row.localChannelCode}
                          onChange={(event) => {
                            const nextRows = [...priceMappingRows]
                            nextRows[index] = { ...row, localChannelCode: event.target.value }
                            updatePriceMappingRows(nextRows)
                          }}
                          disabled={isLoading || isSaving}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => updatePriceMappingRows(priceMappingRows.filter((_, rowIndex) => rowIndex !== index))}
                        disabled={isLoading || isSaving}
                      >
                        {t('sync_akeneo.customFields.actions.remove', 'Remove')}
                      </Button>
                    </div>
                  )) : (
                    <Notice compact>
                      {t('sync_akeneo.mapping.emptyPrices', 'No price mappings configured yet.')}
                    </Notice>
                  )}
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
                    {t('sync_akeneo.mapping.addRow', 'Add row')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('sync_akeneo.mapping.media.help', 'One mapping per line: attribute_code,target(product|variant),kind(image|file). Image mappings are re-hosted into Open Mercato attachments and can become default media; file mappings are imported as attachments.')}
                </p>
                <div className="space-y-2 rounded-lg border p-3">
                  {mediaMappingRows.length > 0 ? mediaMappingRows.map((row, index) => (
                    <div key={`media-mapping-${index}`} className="grid gap-2 rounded-md border p-3 lg:grid-cols-[1fr_auto_1fr_1fr_auto] lg:items-end">
                      <div className="space-y-1">
                        <Label>{t('sync_akeneo.mapping.from', 'From')}</Label>
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
                      </div>
                      <div className="pb-2 text-center text-muted-foreground">→</div>
                      <div className="space-y-1">
                        <Label>{t('sync_akeneo.customFields.columns.target', 'Target')}</Label>
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
                      </div>
                      <div className="space-y-1">
                        <Label>{t('sync_akeneo.customFields.columns.kind', 'Kind')}</Label>
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
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => updateMediaMappingRows(mediaMappingRows.filter((_, rowIndex) => rowIndex !== index))}
                        disabled={isLoading || isSaving}
                      >
                        {t('sync_akeneo.customFields.actions.remove', 'Remove')}
                      </Button>
                    </div>
                  )) : (
                    <Notice compact>
                      {t('sync_akeneo.mapping.emptyMedia', 'No media mappings configured yet.')}
                    </Notice>
                  )}
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
                {t('sync_akeneo.customFields.actions.add', 'Add row')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void createMissingCustomFields(customFieldEditorRows)}
                disabled={isLoading || isSaving || isCreatingCustomFields || customFieldEditorRows.length === 0}
              >
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
              {t('sync_akeneo.customFields.dialog.apply', 'Apply')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setCustomFieldDialogOpen(false)} disabled={isCreatingCustomFields}>
              {t('sync_akeneo.customFields.dialog.close', 'Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
