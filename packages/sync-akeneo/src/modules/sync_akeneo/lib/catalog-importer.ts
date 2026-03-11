import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataMapping } from '@open-mercato/core/modules/data_sync/lib/adapter'
import type { ExternalIdMappingService } from '@open-mercato/core/modules/data_sync/lib/id-mapping'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import {
  CatalogOffer,
  CatalogOptionSchemaTemplate,
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductPrice,
  CatalogProductVariant,
  CatalogProductVariantRelation,
} from '@open-mercato/core/modules/catalog/data/entities'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { buildAttachmentFileUrl, buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { deletePartitionFile, storePartitionFile } from '@open-mercato/core/modules/attachments/lib/storage'
import { ensureDefaultPartitions, resolveDefaultPartitionCode } from '@open-mercato/core/modules/attachments/lib/partitions'
import { mergeAttachmentMetadata } from '@open-mercato/core/modules/attachments/lib/metadata'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import {
  dedupeStrings,
  labelFromLocalizedRecord,
  safeRecord,
  slugifyAkeneoCode,
  type AkeneoAttribute,
  type AkeneoCategory,
  type AkeneoCustomFieldKind,
  type AkeneoDataMapping,
  type AkeneoFamily,
  type AkeneoFamilyVariant,
  type AkeneoProduct,
  type AkeneoProductMappingSettings,
  type AkeneoReconciliationSettings,
  type AkeneoValues,
} from './shared'
import type { AkeneoClient } from './client'

type ImportScope = {
  organizationId: string
  tenantId: string
}

type UpsertResult = {
  localId: string
  action: 'create' | 'update' | 'skip'
}

type CustomFieldSyncItem = {
  externalId: string
  action: 'create' | 'update' | 'skip'
  data: Record<string, unknown>
}

type ResolvedHierarchy = {
  rootExternalId: string
  family: string | null
  familyVariantCode: string | null
  rootValues: AkeneoValues
  leafValues: AkeneoValues
  mergedValues: AkeneoValues
  categories: string[]
  parentChain: string[]
  associationSource: AkeneoProduct
  axisCodes: string[]
}

type DesiredOffer = {
  externalId: string
  channelCode: string
  channelId: string
  akeneoChannel: string | null
  title: string
  description: string | null
  prices: DesiredPrice[]
}

type DesiredPrice = {
  externalId: string
  priceKindCode: string
  priceKindId: string
  channelId: string
  currencyCode: string
  amount: number
  variantId: string
}

type MediaReference = {
  codeOrUrl: string
  fileNameHint: string | null
  mimeTypeHint: string | null
}

type DesiredAsset = {
  externalId: string
  entityId: string
  recordId: string
  kind: 'image' | 'file'
  remote: MediaReference
}

const PRODUCT_ENTITY_ID = 'catalog:catalog_product'
const VARIANT_ENTITY_ID = 'catalog:catalog_product_variant'

function readPreferredValue(
  values: AkeneoValues | undefined | null,
  attributeCode: string,
  locale: string,
  channel: string | null,
): unknown {
  const entries = Array.isArray(values?.[attributeCode]) ? values?.[attributeCode] ?? [] : []
  if (entries.length === 0) return null

  const normalize = (value: string | null | undefined) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null)
  const wantedLocale = normalize(locale)
  const wantedChannel = normalize(channel)

  const scored = entries
    .map((entry) => {
      const entryLocale = normalize(entry.locale)
      const entryChannel = normalize(entry.scope)
      let score = 0
      if (wantedLocale && entryLocale === wantedLocale) score += 4
      else if (!wantedLocale && !entryLocale) score += 2
      else if (!entryLocale) score += 1
      if (wantedChannel && entryChannel === wantedChannel) score += 4
      else if (!wantedChannel && !entryChannel) score += 2
      else if (!entryChannel) score += 1
      return { score, entry }
    })
    .sort((left, right) => right.score - left.score)

  return scored[0]?.entry?.data ?? null
}

function readLayeredValue(
  layers: AkeneoValues[],
  attributeCode: string,
  locale: string,
  channel: string | null,
): unknown {
  for (const layer of layers) {
    const value = readPreferredValue(layer, attributeCode, locale, channel)
    if (value !== null && value !== undefined && !(typeof value === 'string' && value.trim().length === 0)) {
      return value
    }
  }
  return null
}

function coerceString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function coerceMetricAmount(value: unknown): number | null {
  const record = safeRecord(value)
  const amount = record?.amount
  if (typeof amount === 'string' && amount.trim().length > 0) {
    const numeric = Number(amount)
    return Number.isFinite(numeric) ? numeric : null
  }
  if (typeof amount === 'number' && Number.isFinite(amount)) return amount
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true' || lowered === '1' || lowered === 'yes') return true
    if (lowered === 'false' || lowered === '0' || lowered === 'no') return false
  }
  return null
}

function mergeValueLayers(...layers: Array<AkeneoValues | undefined | null>): AkeneoValues {
  const merged: AkeneoValues = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const [key, value] of Object.entries(layer)) {
      merged[key] = Array.isArray(value) ? value : []
    }
  }
  return merged
}

function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
}

function mapAkeneoAttributeInputType(attributeType: string): 'select' | 'text' | 'textarea' | 'number' | null {
  if (attributeType === 'pim_catalog_simpleselect' || attributeType === 'akeneo_reference_entity' || attributeType === 'akeneo_reference_entity_collection') {
    return 'select'
  }
  if (attributeType === 'pim_catalog_multiselect') return 'select'
  if (attributeType === 'pim_catalog_text') return 'text'
  if (attributeType === 'pim_catalog_textarea') return 'textarea'
  if (
    attributeType === 'pim_catalog_number'
    || attributeType === 'pim_catalog_metric'
    || attributeType === 'pim_catalog_price_collection'
  ) {
    return 'number'
  }
  return null
}

function mapAkeneoAttributeToCustomFieldKind(attribute: AkeneoAttribute, preferredKind?: AkeneoCustomFieldKind | null): AkeneoCustomFieldKind | null {
  if (preferredKind) return preferredKind
  if (attribute.type === 'pim_catalog_boolean') return 'boolean'
  if (attribute.type === 'pim_catalog_number') {
    return attribute.decimals_allowed === false ? 'integer' : 'float'
  }
  if (attribute.type === 'pim_catalog_metric') return 'float'
  if (
    attribute.type === 'pim_catalog_simpleselect'
    || attribute.type === 'pim_catalog_multiselect'
    || attribute.type === 'akeneo_reference_entity'
    || attribute.type === 'akeneo_reference_entity_collection'
  ) {
    return 'select'
  }
  if (attribute.type === 'pim_catalog_textarea') return 'multiline'
  if (attribute.type === 'pim_catalog_text') return 'text'
  if (attribute.type === 'pim_catalog_date') return 'text'
  return null
}

function buildValidationRules(attribute: AkeneoAttribute): Array<{ rule: string; param?: unknown }> {
  const rules: Array<{ rule: string; param?: unknown }> = []
  if (attribute.is_required_for_completeness) rules.push({ rule: 'required' })
  if (typeof attribute.max_characters === 'number' && Number.isFinite(attribute.max_characters)) {
    rules.push({ rule: 'maxLength', param: attribute.max_characters })
  }
  if (attribute.validation_rule === 'regexp' && typeof attribute.validation_regexp === 'string' && attribute.validation_regexp.trim().length > 0) {
    rules.push({ rule: 'pattern', param: attribute.validation_regexp.trim() })
  }
  const minimumValue = coerceNumber(attribute.minimum_value)
  if (minimumValue !== null) rules.push({ rule: 'min', param: minimumValue })
  const maximumValue = coerceNumber(attribute.maximum_value)
  if (maximumValue !== null) rules.push({ rule: 'max', param: maximumValue })
  return rules
}

function buildAttributeMetadata(attribute: AkeneoAttribute, locale: string): Record<string, unknown> {
  return {
    provider: 'akeneo',
    attributeCode: attribute.code,
    type: attribute.type,
    label: labelFromLocalizedRecord(attribute.labels ?? null, locale, attribute.code),
    groupCode: attribute.group ?? null,
    groupLabel: attribute.group_labels ? labelFromLocalizedRecord(attribute.group_labels, locale, attribute.group ?? 'Akeneo') : null,
    localizable: Boolean(attribute.localizable),
    scopable: Boolean(attribute.scopable),
    isRequiredForCompleteness: Boolean(attribute.is_required_for_completeness),
    unique: Boolean(attribute.unique),
    useableAsGridFilter: Boolean(attribute.useable_as_grid_filter),
    validationRule: attribute.validation_rule ?? null,
    validationRegexp: attribute.validation_regexp ?? null,
    decimalsAllowed: attribute.decimals_allowed ?? null,
    negativeAllowed: attribute.negative_allowed ?? null,
    minimumValue: attribute.minimum_value ?? null,
    maximumValue: attribute.maximum_value ?? null,
    metricFamily: attribute.metric_family ?? null,
    defaultMetricUnit: attribute.default_metric_unit ?? null,
    referenceDataName: attribute.reference_data_name ?? null,
  }
}

function familyRequiresAttribute(family: AkeneoFamily, attributeCode: string): boolean {
  const requirements = family.attribute_requirements
  if (!requirements || typeof requirements !== 'object') return false
  return Object.values(requirements).some((codes) => Array.isArray(codes) && codes.includes(attributeCode))
}

function parsePriceCollection(value: unknown): Array<{ currencyCode: string; amount: number }> {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const record = safeRecord(entry)
      const currencyCode = typeof record?.currency === 'string' ? record.currency.trim().toUpperCase() : ''
      const amount = coerceNumber(record?.amount)
      if (!currencyCode || amount === null) return null
      return { currencyCode, amount }
    })
    .filter((entry): entry is { currencyCode: string; amount: number } => Boolean(entry))
}

function collectMediaReferences(value: unknown): MediaReference[] {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]
  return values
    .map((entry) => {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        return {
          codeOrUrl: entry.trim(),
          fileNameHint: null,
          mimeTypeHint: null,
        }
      }
      const record = safeRecord(entry)
      if (!record) return null
      const linkRecord = safeRecord(record._links)
      const downloadRecord = safeRecord(linkRecord?.download)
      const codeOrUrl = coerceString(record.code)
        ?? coerceString(record.download_link)
        ?? coerceString(record.href)
        ?? coerceString(downloadRecord?.href)
      if (!codeOrUrl) return null
      return {
        codeOrUrl,
        fileNameHint: coerceString(record.original_filename) ?? coerceString(record.file_path),
        mimeTypeHint: coerceString(record.mime_type),
      }
    })
    .filter((entry): entry is MediaReference => Boolean(entry))
}

function resolveCustomFieldValue(value: unknown, attribute: AkeneoAttribute, kind: AkeneoCustomFieldKind): unknown {
  if (kind === 'boolean') return coerceBoolean(value)
  if (kind === 'integer') return coerceNumber(value) === null ? null : Math.trunc(Number(value))
  if (kind === 'float') return attribute.type === 'pim_catalog_metric' ? coerceMetricAmount(value) : coerceNumber(value)
  if (kind === 'multiline') return coerceString(value)
  if (kind === 'text') {
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return value ? JSON.stringify(value) : null
  }
  if (kind === 'select') {
    if (Array.isArray(value)) {
      const items = value.map((entry) => coerceString(entry)).filter((entry): entry is string => Boolean(entry))
      return items.length > 0 ? items : null
    }
    return coerceString(value)
  }
  return null
}

function relationTypeFromAssociation(associationType: string): 'bundle' | 'grouped' {
  const normalized = associationType.trim().toLowerCase()
  return normalized.includes('pack') || normalized.includes('bundle') ? 'bundle' : 'grouped'
}

export async function createAkeneoImporter(client: AkeneoClient, scope: ImportScope) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const commandBus = container.resolve('commandBus') as CommandBus
  const dataEngine = container.resolve('dataEngine') as DataEngine
  const externalIdMappingService = container.resolve('externalIdMappingService') as ExternalIdMappingService
  const categoryCache = new Map<string, Promise<string | null>>()
  const optionSchemaCache = new Map<string, Promise<UpsertResult | null>>()
  const channelCache = new Map<string, Promise<{ id: string; code: string } | null>>()
  const priceKindCache = new Map<string, Promise<{ id: string; code: string; displayMode: string } | null>>()
  const customFieldSyncCache = new Map<string, Promise<CustomFieldSyncItem[]>>()

  function buildCommandContext(): CommandRuntimeContext {
    return {
      container,
      auth: null,
      organizationScope: {
        selectedId: scope.organizationId,
        filterIds: [scope.organizationId],
        allowedIds: [scope.organizationId],
        tenantId: scope.tenantId,
      },
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }
  }

  async function executeCommand<TResult>(commandId: string, input: Record<string, unknown>): Promise<TResult> {
    const executed = await commandBus.execute<Record<string, unknown>, TResult>(commandId, {
      input,
      ctx: buildCommandContext(),
    })
    return executed.result
  }

  async function lookupProductBySku(sku: string | null): Promise<string | null> {
    if (!sku) return null
    const product = await findOneWithDecryption(
      em,
      CatalogProduct,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        sku,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    return product?.id ?? null
  }

  async function lookupVariantBySku(sku: string | null): Promise<string | null> {
    if (!sku) return null
    const variant = await findOneWithDecryption(
      em,
      CatalogProductVariant,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        sku,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    return variant?.id ?? null
  }

  async function resolveCategoryId(code: string | null | undefined, locale: string): Promise<string | null> {
    if (!code) return null
    if (!categoryCache.has(code)) {
      categoryCache.set(code, (async () => {
        const mapped = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product_category', code, scope)
        if (mapped) return mapped

        const existing = await findOneWithDecryption(
          em,
          CatalogProductCategory,
          {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            slug: slugifyAkeneoCode(code),
            deletedAt: null,
          },
          undefined,
          scope,
        )
        if (existing) {
          await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_product_category', existing.id, code, scope)
          return existing.id
        }

        const remote = await client.getCategory(code)
        if (!remote) return null
        const result = await upsertCategory(remote, locale)
        return result.localId
      })())
    }
    return categoryCache.get(code) ?? null
  }

  async function resolveChannel(code: string): Promise<{ id: string; code: string } | null> {
    const normalizedCode = code.trim().toLowerCase()
    if (!normalizedCode) return null
    if (!channelCache.has(normalizedCode)) {
      channelCache.set(normalizedCode, (async () => {
        const channel = await em.findOne(SalesChannel, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          code: normalizedCode,
          deletedAt: null,
          isActive: true,
        })
        return channel ? { id: channel.id, code: channel.code ?? normalizedCode } : null
      })())
    }
    return channelCache.get(normalizedCode) ?? null
  }

  async function resolvePriceKind(code: string): Promise<{ id: string; code: string; displayMode: string } | null> {
    const normalizedCode = code.trim().toLowerCase()
    if (!normalizedCode) return null
    if (!priceKindCache.has(normalizedCode)) {
      priceKindCache.set(normalizedCode, (async () => {
        const priceKind = await findOneWithDecryption(
          em,
          CatalogPriceKind,
          {
            tenantId: scope.tenantId,
            code: normalizedCode,
            deletedAt: null,
            isActive: true,
          },
          undefined,
          scope,
        )
        return priceKind ? { id: priceKind.id, code: priceKind.code, displayMode: priceKind.displayMode } : null
      })())
    }
    return priceKindCache.get(normalizedCode) ?? null
  }

  async function upsertCategory(category: AkeneoCategory, locale: string): Promise<UpsertResult> {
    const mappedId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product_category', category.code, scope)
    const existingId = mappedId
      ?? (await findOneWithDecryption(
        em,
        CatalogProductCategory,
        {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          slug: slugifyAkeneoCode(category.code),
          deletedAt: null,
        },
        undefined,
        scope,
      ))?.id
      ?? null

    const parentId = category.parent ? await resolveCategoryId(category.parent, locale) : null
    const input = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      name: labelFromLocalizedRecord(category.labels ?? null, locale, category.code),
      slug: slugifyAkeneoCode(category.code),
      description: undefined,
      parentId,
      isActive: true,
    }

    if (existingId) {
      await executeCommand('catalog.categories.update', {
        id: existingId,
        ...input,
      })
      await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_product_category', existingId, category.code, scope)
      return { localId: existingId, action: 'update' }
    }

    const created = await executeCommand<{ categoryId: string }>('catalog.categories.create', input)
    await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_product_category', created.categoryId, category.code, scope)
    return { localId: created.categoryId, action: 'create' }
  }

  async function buildOptionSchemaDefinition(attribute: AkeneoAttribute, family: AkeneoFamily, locale: string) {
    const inputType = mapAkeneoAttributeInputType(attribute.type)
    if (!inputType) return null

    const definition: Record<string, unknown> = {
      code: slugifyAkeneoCode(attribute.code),
      label: labelFromLocalizedRecord(attribute.labels ?? null, locale, attribute.code),
      description: typeof attribute.group === 'string' ? `Akeneo group: ${attribute.group}` : undefined,
      inputType,
      isRequired: familyRequiresAttribute(family, attribute.code),
    }

    if (attribute.type === 'pim_catalog_multiselect') {
      definition.isMultiple = true
    }

    if (inputType === 'select' && (attribute.type === 'pim_catalog_simpleselect' || attribute.type === 'pim_catalog_multiselect')) {
      const options = await client.listAttributeOptions(attribute.code).catch(() => [])
      definition.choices = options.map((option) => ({
        code: slugifyAkeneoCode(option.code),
        label: labelFromLocalizedRecord(option.labels ?? null, locale, option.code),
      }))
    }

    return definition
  }

  async function ensureOptionSchemaForFamily(
    family: AkeneoFamily,
    familyVariant: AkeneoFamilyVariant | null,
    includeTextAttributes: boolean,
    includeNumericAttributes: boolean,
    locale: string,
  ): Promise<UpsertResult | null> {
    const cacheKey = `${family.code}:${familyVariant?.code ?? 'family'}:${locale}:${includeTextAttributes}:${includeNumericAttributes}`
    if (!optionSchemaCache.has(cacheKey)) {
      optionSchemaCache.set(cacheKey, (async () => {
        const externalId = familyVariant?.code ?? family.code
        const schemaCode = slugifyAkeneoCode(`akeneo-${externalId}`)
        const mappedId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_option_schema', externalId, scope)
        const existing = mappedId
          ? await findOneWithDecryption(em, CatalogOptionSchemaTemplate, { id: mappedId, deletedAt: null }, undefined, scope)
          : await findOneWithDecryption(
            em,
            CatalogOptionSchemaTemplate,
            {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              code: schemaCode,
              deletedAt: null,
            },
            undefined,
            scope,
          )

        const familyAttributes = Array.isArray(family.attributes) ? family.attributes : []
        const familyVariantAttributes = familyVariant?.variant_attribute_sets?.flatMap((set) => [
          ...(Array.isArray(set.attributes) ? set.attributes : []),
          ...(Array.isArray(set.axes) ? set.axes : []),
        ]) ?? []
        const attributeCodes = dedupeStrings([...familyAttributes, ...familyVariantAttributes])
        const definitions: Record<string, unknown>[] = []
        const richAttributes: Record<string, unknown> = {}
        for (const code of attributeCodes) {
          const attribute = await client.getAttribute(code)
          if (!attribute) continue
          const inputType = mapAkeneoAttributeInputType(attribute.type)
          if (!inputType) continue
          if ((inputType === 'text' || inputType === 'textarea') && !includeTextAttributes) continue
          if (inputType === 'number' && !includeNumericAttributes) continue
          const definition = await buildOptionSchemaDefinition(attribute, family, locale)
          if (!definition) continue
          definitions.push(definition)
          richAttributes[code] = {
            ...buildAttributeMetadata(attribute, locale),
            validation: buildValidationRules(attribute),
          }
          if (definitions.length >= 64) break
        }

        const schemaInput = {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          name: labelFromLocalizedRecord(family.labels ?? null, locale, family.code),
          code: schemaCode,
          description: familyVariant?.code ? `Akeneo family variant ${familyVariant.code}` : `Akeneo family ${family.code}`,
          schema: {
            version: 1,
            name: labelFromLocalizedRecord(family.labels ?? null, locale, family.code),
            description: familyVariant?.code ? `Akeneo family variant ${familyVariant.code}` : `Akeneo family ${family.code}`,
            options: definitions,
          },
          metadata: {
            source: 'akeneo',
            familyCode: family.code,
            familyVariantCode: familyVariant?.code ?? null,
            attributeCodes,
            richAttributes,
            attributeAsLabel: family.attribute_as_label ?? null,
            attributeAsImage: family.attribute_as_image ?? null,
            variantAxes: familyVariant?.variant_attribute_sets?.map((set) => ({
              level: set.level ?? null,
              axes: Array.isArray(set.axes) ? set.axes : [],
              attributes: Array.isArray(set.attributes) ? set.attributes : [],
            })) ?? [],
          },
          isActive: true,
        }

        if (existing) {
          await executeCommand('catalog.optionSchemas.update', {
            id: existing.id,
            ...schemaInput,
          })
          await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_option_schema', existing.id, externalId, scope)
          return { localId: existing.id, action: 'update' }
        }

        const created = await executeCommand<{ schemaId: string }>('catalog.optionSchemas.create', schemaInput)
        await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_option_schema', created.schemaId, externalId, scope)
        return { localId: created.schemaId, action: 'create' }
      })())
    }

    return optionSchemaCache.get(cacheKey) ?? null
  }

  async function syncMappedCustomFields(mapping: AkeneoDataMapping, locale: string): Promise<CustomFieldSyncItem[]> {
    const settings = mapping.settings?.products
    if (!settings || settings.customFieldMappings.length === 0) return []
    const cacheKey = JSON.stringify(settings.customFieldMappings)
    if (!customFieldSyncCache.has(cacheKey)) {
      customFieldSyncCache.set(cacheKey, (async () => {
        const productFields: Array<CustomFieldDefinition & { sourceMetadata?: Record<string, unknown> }> = []
        const variantFields: Array<CustomFieldDefinition & { sourceMetadata?: Record<string, unknown> }> = []
        const items: CustomFieldSyncItem[] = []

        for (const fieldMapping of settings.customFieldMappings) {
          const attribute = await client.getAttribute(fieldMapping.attributeCode)
          if (!attribute) continue
          const kind = mapAkeneoAttributeToCustomFieldKind(attribute, fieldMapping.kind)
          if (!kind) continue
          const options = kind === 'select' && (attribute.type === 'pim_catalog_simpleselect' || attribute.type === 'pim_catalog_multiselect')
            ? await client.listAttributeOptions(attribute.code).catch(() => [])
            : []
          const field: CustomFieldDefinition & { sourceMetadata?: Record<string, unknown> } = {
            key: normalizeFieldKey(fieldMapping.fieldKey),
            kind,
            label: labelFromLocalizedRecord(attribute.labels ?? null, locale, fieldMapping.fieldKey),
            description: `Akeneo attribute ${fieldMapping.attributeCode}`,
            multi: attribute.type === 'pim_catalog_multiselect' || attribute.type === 'akeneo_reference_entity_collection',
            options: options.map((option) => ({
              value: option.code,
              label: labelFromLocalizedRecord(option.labels ?? null, locale, option.code),
            })),
            filterable: Boolean(attribute.useable_as_grid_filter),
            listVisible: false,
            validation: buildValidationRules(attribute),
            group: attribute.group ? {
              code: normalizeFieldKey(attribute.group),
              title: attribute.group_labels ? labelFromLocalizedRecord(attribute.group_labels, locale, attribute.group) : attribute.group,
            } : undefined,
            sourceMetadata: buildAttributeMetadata(attribute, locale),
          }
          if (fieldMapping.target === 'product') productFields.push(field)
          else variantFields.push(field)
          items.push({
            externalId: `${fieldMapping.target}:${fieldMapping.attributeCode}`,
            action: 'update',
            data: {
              key: field.key,
              target: fieldMapping.target,
              attributeCode: fieldMapping.attributeCode,
            },
          })
        }

        const sets = []
        if (productFields.length > 0) {
          sets.push({
            entity: PRODUCT_ENTITY_ID,
            fields: productFields,
            source: 'akeneo',
          })
        }
        if (variantFields.length > 0) {
          sets.push({
            entity: VARIANT_ENTITY_ID,
            fields: variantFields,
            source: 'akeneo',
          })
        }

        if (sets.length > 0) {
          await ensureCustomFieldDefinitions(em, sets, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
          })
        }

        return items
      })())
    }
    return customFieldSyncCache.get(cacheKey) ?? []
  }

  async function upsertAttributeFamily(
    family: AkeneoFamily,
    locale: string,
    includeTextAttributes: boolean,
    includeNumericAttributes: boolean,
  ): Promise<UpsertResult | null> {
    return ensureOptionSchemaForFamily(family, null, includeTextAttributes, includeNumericAttributes, locale)
  }

  async function resolveProductHierarchy(product: AkeneoProduct): Promise<ResolvedHierarchy> {
    if (!product.parent) {
      return {
        rootExternalId: product.uuid,
        family: product.family ?? null,
        familyVariantCode: null,
        rootValues: mergeValueLayers(product.values),
        leafValues: mergeValueLayers(product.values),
        mergedValues: mergeValueLayers(product.values),
        categories: Array.isArray(product.categories) ? product.categories : [],
        parentChain: [],
        associationSource: product,
        axisCodes: [],
      }
    }

    const chain: Array<{ code: string; values: AkeneoValues; categories: string[]; family?: string | null; familyVariant?: string | null }> = []
    let nextCode: string | null = product.parent
    while (nextCode) {
      const model = await client.getProductModel(nextCode)
      if (!model) break
      chain.unshift({
        code: model.code,
        values: mergeValueLayers(model.values),
        categories: Array.isArray(model.categories) ? model.categories : [],
        family: model.family ?? null,
        familyVariant: model.family_variant ?? null,
      })
      nextCode = model.parent ?? null
    }

    const root = chain[0]
    return {
      rootExternalId: root?.code ?? product.uuid,
      family: product.family ?? root?.family ?? null,
      familyVariantCode: chain[chain.length - 1]?.familyVariant ?? root?.familyVariant ?? null,
      rootValues: root?.values ?? mergeValueLayers(product.values),
      leafValues: mergeValueLayers(product.values),
      mergedValues: mergeValueLayers(
        ...chain.map((model) => model.values),
        product.values,
      ),
      categories: Array.from(new Set([
        ...chain.flatMap((model) => model.categories),
        ...(product.categories ?? []),
      ])),
      parentChain: chain.map((model) => model.code),
      associationSource: product,
      axisCodes: [],
    }
  }

  async function applyCustomFieldMappings(params: {
    mapping: AkeneoDataMapping
    hierarchy: ResolvedHierarchy
    product: AkeneoProduct
    localProductId: string
    localVariantId: string
  }): Promise<void> {
    const settings = params.mapping.settings?.products
    if (!settings || settings.customFieldMappings.length === 0) return

    await syncMappedCustomFields(params.mapping, settings.locale)

    const productCustomFields: Record<string, unknown> = {}
    const variantCustomFields: Record<string, unknown> = {}

    for (const fieldMapping of settings.customFieldMappings) {
      const attribute = await client.getAttribute(fieldMapping.attributeCode)
      if (!attribute) continue
      const kind = mapAkeneoAttributeToCustomFieldKind(attribute, fieldMapping.kind)
      if (!kind) continue
      const sourceLayers = fieldMapping.target === 'product'
        ? [params.hierarchy.rootValues, params.hierarchy.mergedValues]
        : [params.product.values ?? {}, params.hierarchy.mergedValues]
      const rawValue = readLayeredValue(sourceLayers, fieldMapping.attributeCode, settings.locale, settings.channel ?? null)
      const value = resolveCustomFieldValue(rawValue, attribute, kind)
      if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue
      if (fieldMapping.target === 'product') {
        productCustomFields[normalizeFieldKey(fieldMapping.fieldKey)] = value
      } else {
        variantCustomFields[normalizeFieldKey(fieldMapping.fieldKey)] = value
      }
    }

    await Promise.all([
      setCustomFieldsIfAny({
        dataEngine,
        entityId: PRODUCT_ENTITY_ID,
        recordId: params.localProductId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        values: productCustomFields,
      }),
      setCustomFieldsIfAny({
        dataEngine,
        entityId: VARIANT_ENTITY_ID,
        recordId: params.localVariantId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        values: variantCustomFields,
      }),
    ])
  }

  async function upsertOffersAndPrices(params: {
    mapping: AkeneoDataMapping
    settings: AkeneoProductMappingSettings
    hierarchy: ResolvedHierarchy
    localProductId: string
    localVariantId: string
    resolvedProductTitle: string
    resolvedProductDescription: string | null
    variantExternalId: string
  }): Promise<void> {
    const desiredOffers = new Map<string, DesiredOffer>()
    for (const priceMapping of params.settings.priceMappings) {
      const channel = await resolveChannel(priceMapping.localChannelCode)
      const priceKind = await resolvePriceKind(priceMapping.priceKindCode)
      if (!channel || !priceKind) continue
      const akeneoChannel = priceMapping.akeneoChannel ?? params.settings.channel ?? null
      const rawPrices = readLayeredValue(
        [params.hierarchy.leafValues, params.hierarchy.mergedValues],
        priceMapping.attributeCode,
        params.settings.locale,
        akeneoChannel,
      )
      const entries = parsePriceCollection(rawPrices)
      if (entries.length === 0) continue
      const offerExternalId = `${params.hierarchy.rootExternalId}:offer:${channel.code}`
      const existingOffer = desiredOffers.get(offerExternalId)
      const title = coerceString(readLayeredValue(
        [params.hierarchy.rootValues, params.hierarchy.mergedValues],
        params.settings.fieldMap.title,
        params.settings.locale,
        akeneoChannel,
      )) ?? params.resolvedProductTitle
      const description = coerceString(readLayeredValue(
        [params.hierarchy.rootValues, params.hierarchy.mergedValues],
        params.settings.fieldMap.description,
        params.settings.locale,
        akeneoChannel,
      )) ?? params.resolvedProductDescription
      const bucket = existingOffer ?? {
        externalId: offerExternalId,
        channelCode: channel.code,
        channelId: channel.id,
        akeneoChannel,
        title,
        description,
        prices: [],
      }
      for (const entry of entries) {
        bucket.prices.push({
          externalId: `${params.variantExternalId}:price:${priceKind.code}:${channel.code}:${entry.currencyCode}`,
          priceKindCode: priceKind.code,
          priceKindId: priceKind.id,
          channelId: channel.id,
          currencyCode: entry.currencyCode,
          amount: entry.amount,
          variantId: params.localVariantId,
        })
      }
      desiredOffers.set(offerExternalId, bucket)
    }

    const existingOffers = await findWithDecryption(
      em,
      CatalogOffer,
      {
        product: params.localProductId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    const existingOfferByChannelId = new Map(existingOffers.map((offer) => [offer.channelId, offer]))
    const desiredOfferExternalIds = new Set(desiredOffers.keys())

    for (const offer of desiredOffers.values()) {
      const mappedOfferId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_offer', offer.externalId, scope)
      const existingOffer = mappedOfferId
        ? existingOffers.find((entry) => entry.id === mappedOfferId) ?? null
        : existingOfferByChannelId.get(offer.channelId) ?? null
      const input = {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        productId: params.localProductId,
        channelId: offer.channelId,
        title: offer.title,
        description: offer.description ?? undefined,
        metadata: {
          source: 'akeneo',
          externalId: offer.externalId,
          channelCode: offer.channelCode,
          akeneoChannel: offer.akeneoChannel,
        },
        isActive: true,
      }
      const offerId = existingOffer
        ? (await executeCommand<{ offerId: string }>('catalog.offers.update', { id: existingOffer.id, ...input })).offerId
        : (await executeCommand<{ offerId: string }>('catalog.offers.create', input)).offerId
      await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_offer', offerId, offer.externalId, scope)

      const existingPrices = await findWithDecryption(
        em,
        CatalogProductPrice,
        {
          offer: offerId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
        },
        undefined,
        scope,
      )
      const desiredPriceExternalIds = new Set(offer.prices.map((price) => price.externalId))
      for (const price of offer.prices) {
        const mappedPriceId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product_price', price.externalId, scope)
        const existingPrice = mappedPriceId
          ? existingPrices.find((entry) => entry.id === mappedPriceId) ?? null
          : existingPrices.find((entry) => entry.channelId === price.channelId && entry.currencyCode === price.currencyCode && entry.kind === price.priceKindCode) ?? null
        const input = {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          productId: params.localProductId,
          variantId: price.variantId,
          offerId,
          priceKindId: price.priceKindId,
          currencyCode: price.currencyCode,
          unitPriceNet: price.amount,
          unitPriceGross: price.amount,
          minQuantity: 1,
          channelId: price.channelId,
          metadata: {
            source: 'akeneo',
            externalId: price.externalId,
            priceKindCode: price.priceKindCode,
          },
        }
        const priceId = existingPrice
          ? (await executeCommand<{ priceId: string }>('catalog.prices.update', { id: existingPrice.id, ...input })).priceId
          : (await executeCommand<{ priceId: string }>('catalog.prices.create', input)).priceId
        await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_product_price', priceId, price.externalId, scope)
      }

      if (params.settings.reconciliation.deleteMissingPrices) {
        for (const existingPrice of existingPrices) {
          const externalId = await externalIdMappingService.lookupExternalId('sync_akeneo', 'catalog_product_price', existingPrice.id, scope)
          if (externalId && !desiredPriceExternalIds.has(externalId)) {
            await executeCommand('catalog.prices.delete', { id: existingPrice.id })
          }
        }
      }
    }

    if (params.settings.reconciliation.deleteMissingOffers) {
      for (const existingOffer of existingOffers) {
        const externalId = await externalIdMappingService.lookupExternalId('sync_akeneo', 'catalog_offer', existingOffer.id, scope)
        if (externalId && !desiredOfferExternalIds.has(externalId)) {
          const offerPrices = await findWithDecryption(
            em,
            CatalogProductPrice,
            { offer: existingOffer.id, organizationId: scope.organizationId, tenantId: scope.tenantId },
            undefined,
            scope,
          )
          for (const price of offerPrices) {
            await executeCommand('catalog.prices.delete', { id: price.id })
          }
          await executeCommand('catalog.offers.delete', { id: existingOffer.id })
        }
      }
    }
  }

  async function upsertAsset(asset: DesiredAsset): Promise<string> {
    const existingAttachmentId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'attachment', asset.externalId, scope)
    if (existingAttachmentId) return existingAttachmentId

    await ensureDefaultPartitions(em)
    const binary = await client.downloadMediaFile(asset.remote.codeOrUrl)
    const fileName = asset.remote.fileNameHint ?? binary.fileName ?? `akeneo-${randomUUID().slice(0, 8)}`
    const partitionCode = resolveDefaultPartitionCode(asset.entityId)
    const stored = await storePartitionFile({
      partitionCode,
      orgId: scope.organizationId,
      tenantId: scope.tenantId,
      fileName,
      buffer: binary.buffer,
    })
    const attachment = em.create(Attachment, {
      entityId: asset.entityId,
      recordId: asset.recordId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      partitionCode,
      fileName,
      mimeType: asset.remote.mimeTypeHint ?? binary.contentType ?? 'application/octet-stream',
      fileSize: binary.contentLength ?? binary.buffer.byteLength,
      storageDriver: 'local',
      storagePath: stored.storagePath,
      storageMetadata: mergeAttachmentMetadata(null, {
        assignments: [{ type: asset.entityId, id: asset.recordId }],
      }),
      url: buildAttachmentFileUrl('pending'),
      content: null,
    })
    em.persist(attachment)
    await em.flush()
    attachment.url = asset.kind === 'image'
      ? buildAttachmentImageUrl(attachment.id, { slug: slugifyAttachmentFileName(fileName) })
      : buildAttachmentFileUrl(attachment.id)
    attachment.storageMetadata = {
      ...(attachment.storageMetadata ?? {}),
      source: 'akeneo',
      externalId: asset.externalId,
      kind: asset.kind,
      remoteCode: asset.remote.codeOrUrl,
    }
    await em.flush()
    await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'attachment', attachment.id, asset.externalId, scope)
    return attachment.id
  }

  async function reconcileAttachments(params: {
    entityId: string
    recordId: string
    desiredAssets: DesiredAsset[]
    reconciliation: AkeneoReconciliationSettings
  }): Promise<{ heroAttachmentId: string | null; heroAttachmentUrl: string | null }> {
    const desiredExternalIds = new Set(params.desiredAssets.map((asset) => asset.externalId))
    const desiredImages = params.desiredAssets.filter((asset) => asset.kind === 'image')
    const desiredFiles = params.desiredAssets.filter((asset) => asset.kind === 'file')
    const desiredAttachmentIds = await Promise.all(params.desiredAssets.map((asset) => upsertAsset(asset)))
    const heroAttachmentId = desiredImages.length > 0
      ? desiredAttachmentIds[params.desiredAssets.findIndex((asset) => asset.externalId === desiredImages[0]?.externalId)]
      : null
    const heroAttachmentUrl = heroAttachmentId ? buildAttachmentImageUrl(heroAttachmentId) : null

    const existing = await em.find(Attachment, {
      entityId: params.entityId,
      recordId: params.recordId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    for (const attachment of existing) {
      const metadata = safeRecord(attachment.storageMetadata)
      const externalId = typeof metadata?.externalId === 'string' ? metadata.externalId : null
      const kind = metadata?.kind === 'image' || metadata?.kind === 'file' ? metadata.kind : null
      if (!externalId || !kind) continue
      const shouldDelete = kind === 'image'
        ? params.reconciliation.deleteMissingMedia
        : params.reconciliation.deleteMissingAttachments
      if (!shouldDelete || desiredExternalIds.has(externalId)) continue
      await deletePartitionFile(attachment.partitionCode, attachment.storagePath, attachment.storageDriver)
      await em.removeAndFlush(attachment)
    }

    return {
      heroAttachmentId,
      heroAttachmentUrl,
    }
  }

  async function syncAssociations(params: {
    product: AkeneoProduct
    localVariantId: string
    localProductId: string
    settings: AkeneoProductMappingSettings
  }): Promise<void> {
    if (!params.settings.syncAssociations) return
    const existing = await em.find(CatalogProductVariantRelation, {
      parentVariant: params.localVariantId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })

    const desired = new Map<string, {
      relationType: 'bundle' | 'grouped'
      childVariantId: string | null
      childProductId: string | null
      associationType: string
      minQuantity: number | null
    }>()

    const addDesired = async (associationType: string, externalCandidate: string | null, quantity: number | null, mode: 'product' | 'productModel') => {
      if (!externalCandidate) return
      let childVariantId: string | null = null
      let childProductId: string | null = null
      if (mode === 'product') {
        childVariantId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product_variant', externalCandidate, scope)
          ?? await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product_variant', `${externalCandidate}:default`, scope)
          ?? await lookupVariantBySku(externalCandidate)
        childProductId = childVariantId
          ? null
          : await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product', externalCandidate, scope)
            ?? await lookupProductBySku(externalCandidate)
      } else {
        childProductId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product', externalCandidate, scope)
      }
      if (!childVariantId && !childProductId) return
      const relationType = relationTypeFromAssociation(associationType)
      const key = `${relationType}:${childVariantId ?? childProductId}`
      desired.set(key, {
        relationType,
        childVariantId,
        childProductId,
        associationType,
        minQuantity: quantity,
      })
    }

    for (const [associationType, payload] of Object.entries(params.product.associations ?? {})) {
      for (const productIdentifier of payload.products ?? []) {
        await addDesired(associationType, productIdentifier, null, 'product')
      }
      for (const productModelCode of payload.product_models ?? []) {
        await addDesired(associationType, productModelCode, null, 'productModel')
      }
    }

    for (const [associationType, payload] of Object.entries(params.product.quantified_associations ?? {})) {
      for (const productEntry of payload.products ?? []) {
        await addDesired(associationType, coerceString(productEntry.uuid) ?? coerceString(productEntry.identifier), coerceNumber(productEntry.quantity), 'product')
      }
      for (const productModelEntry of payload.product_models ?? []) {
        await addDesired(associationType, coerceString(productModelEntry.code) ?? coerceString(productModelEntry.identifier), coerceNumber(productModelEntry.quantity), 'productModel')
      }
    }

    const desiredKeys = new Set(desired.keys())
    for (const entry of desired.values()) {
      const existingRelation = existing.find((relation) => {
        const childVariantId = typeof relation.childVariant === 'string' ? relation.childVariant : relation.childVariant?.id ?? null
        const childProductId = typeof relation.childProduct === 'string' ? relation.childProduct : relation.childProduct?.id ?? null
        return relation.relationType === entry.relationType
          && childVariantId === entry.childVariantId
          && childProductId === entry.childProductId
      })
      if (existingRelation) {
        existingRelation.minQuantity = entry.minQuantity
        existingRelation.metadata = {
          source: 'akeneo',
          associationType: entry.associationType,
        }
        await em.flush()
        continue
      }
      const relation = em.create(CatalogProductVariantRelation, {
        parentVariant: em.getReference(CatalogProductVariant, params.localVariantId),
        childVariant: entry.childVariantId ? em.getReference(CatalogProductVariant, entry.childVariantId) : null,
        childProduct: entry.childProductId ? em.getReference(CatalogProduct, entry.childProductId) : null,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        relationType: entry.relationType,
        isRequired: false,
        minQuantity: entry.minQuantity,
        maxQuantity: null,
        position: 0,
        metadata: {
          source: 'akeneo',
          associationType: entry.associationType,
        },
      })
      em.persist(relation)
      await em.flush()
    }

    for (const relation of existing) {
      const metadata = safeRecord(relation.metadata)
      if (metadata?.source !== 'akeneo') continue
      const childVariantId = typeof relation.childVariant === 'string' ? relation.childVariant : relation.childVariant?.id ?? null
      const childProductId = typeof relation.childProduct === 'string' ? relation.childProduct : relation.childProduct?.id ?? null
      const key = `${relation.relationType}:${childVariantId ?? childProductId}`
      if (!desiredKeys.has(key)) {
        await em.removeAndFlush(relation)
      }
    }
  }

  async function upsertProduct(product: AkeneoProduct, mapping: AkeneoDataMapping): Promise<Array<{ externalId: string; action: 'create' | 'update' | 'skip'; data: Record<string, unknown> }>> {
    const settings = mapping.settings?.products as AkeneoProductMappingSettings | undefined
    const locale = settings?.locale ?? 'en_US'
    const channel = settings?.channel ?? null
    const family = product.family ? await client.getFamily(product.family) : null
    const hierarchy = await resolveProductHierarchy(product)
    const resolvedFamily = hierarchy.family ? await client.getFamily(hierarchy.family) : family
    const resolvedFamilyVariant = hierarchy.family && hierarchy.familyVariantCode
      ? await client.getFamilyVariant(hierarchy.family, hierarchy.familyVariantCode)
      : null
    hierarchy.axisCodes = dedupeStrings(resolvedFamilyVariant?.variant_attribute_sets?.flatMap((set) => set.axes ?? []) ?? [])

    let optionSchemaId: string | null = null
    if (resolvedFamily) {
      optionSchemaId = (await ensureOptionSchemaForFamily(
        resolvedFamily,
        resolvedFamilyVariant ?? null,
        true,
        true,
        locale,
      ))?.localId ?? null
    }

    const fieldMap = settings?.fieldMap ?? {
      title: 'name',
      subtitle: 'subtitle',
      description: 'description',
      sku: 'sku',
      barcode: 'ean',
      weight: 'weight',
      variantName: 'name',
    }

    const resolvedTitle = coerceString(readLayeredValue([hierarchy.rootValues, hierarchy.mergedValues], fieldMap.title, locale, channel))
      ?? coerceString(product.identifier)
      ?? hierarchy.rootExternalId
    const resolvedSubtitle = coerceString(readLayeredValue([hierarchy.rootValues, hierarchy.mergedValues], fieldMap.subtitle, locale, channel))
    const resolvedDescription = coerceString(readLayeredValue([hierarchy.rootValues, hierarchy.mergedValues], fieldMap.description, locale, channel))
    const resolvedSku = coerceString(readLayeredValue([hierarchy.leafValues, hierarchy.mergedValues], fieldMap.sku, locale, channel))
      ?? coerceString(product.identifier)
      ?? product.uuid
    const resolvedBarcode = coerceString(readLayeredValue([hierarchy.leafValues, hierarchy.mergedValues], fieldMap.barcode, locale, channel))
    const resolvedWeight = coerceMetricAmount(readLayeredValue([hierarchy.leafValues, hierarchy.mergedValues], fieldMap.weight, locale, channel))
      ?? coerceMetricAmount(readLayeredValue([hierarchy.rootValues, hierarchy.mergedValues], fieldMap.weight, locale, channel))
    const categoryIds = (
      await Promise.all(hierarchy.categories.map((code) => resolveCategoryId(code, locale)))
    ).filter((value): value is string => typeof value === 'string' && value.length > 0)

    const productExternalId = hierarchy.rootExternalId
    const existingProductId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product', productExternalId, scope)
      ?? (await lookupProductBySku(product.parent ? null : resolvedSku))

    const productInput = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: resolvedTitle,
      subtitle: resolvedSubtitle ?? undefined,
      description: resolvedDescription ?? undefined,
      sku: product.parent ? null : resolvedSku,
      productType: product.parent ? 'configurable' : 'simple',
      optionSchemaId,
      isConfigurable: Boolean(product.parent),
      isActive: product.enabled !== false,
      weightValue: resolvedWeight ?? undefined,
      categoryIds,
      metadata: {
        source: 'akeneo',
        externalId: productExternalId,
        sourceProductUuid: product.uuid,
        family: hierarchy.family,
        familyVariant: hierarchy.familyVariantCode,
        parentChain: hierarchy.parentChain,
        associations: product.associations ?? {},
        quantifiedAssociations: product.quantified_associations ?? {},
        updatedAt: product.updated ?? null,
      },
    }

    let localProductId: string
    let productAction: 'create' | 'update'
    if (existingProductId) {
      await executeCommand('catalog.products.update', {
        id: existingProductId,
        ...productInput,
      })
      localProductId = existingProductId
      productAction = 'update'
    } else {
      const created = await executeCommand<{ productId?: string; id?: string }>('catalog.products.create', productInput)
      localProductId = created.productId ?? created.id ?? ''
      if (!localProductId) {
        throw new Error(`Akeneo product ${product.uuid} did not return a local product id`)
      }
      productAction = 'create'
    }
    await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_product', localProductId, productExternalId, scope)

    const variantExternalId = product.parent ? product.uuid : `${product.uuid}:default`
    const existingVariantId = await externalIdMappingService.lookupLocalId('sync_akeneo', 'catalog_product_variant', variantExternalId, scope)
      ?? (await lookupVariantBySku(resolvedSku))

    const optionValues = hierarchy.axisCodes.length > 0
      ? Object.fromEntries(
          hierarchy.axisCodes
            .map((axis) => {
              const value = readLayeredValue([hierarchy.leafValues, hierarchy.mergedValues], axis, locale, channel)
              const normalized = Array.isArray(value)
                ? value.map((entry) => coerceString(entry)).filter((entry): entry is string => Boolean(entry)).join(', ')
                : coerceString(value)
              return [slugifyAkeneoCode(axis), normalized]
            })
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
        )
      : undefined

    const existingDefaultVariant = await findOneWithDecryption(
      em,
      CatalogProductVariant,
      {
        product: localProductId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        isDefault: true,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    const variantName = coerceString(readLayeredValue([hierarchy.leafValues, hierarchy.mergedValues], fieldMap.variantName, locale, channel))
      ?? (optionValues && Object.values(optionValues).length > 0 ? Object.values(optionValues).join(' / ') : resolvedTitle)

    const variantInput = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      productId: localProductId,
      name: variantName,
      sku: resolvedSku,
      barcode: resolvedBarcode ?? undefined,
      isDefault: existingVariantId ? existingVariantId === existingDefaultVariant?.id : !existingDefaultVariant,
      isActive: product.enabled !== false,
      weightValue: resolvedWeight ?? undefined,
      optionValues: optionValues && Object.keys(optionValues).length > 0 ? optionValues : undefined,
      metadata: {
        source: 'akeneo',
        externalId: variantExternalId,
        sourceProductUuid: product.uuid,
        sourceParentCode: product.parent ?? null,
        associations: product.associations ?? {},
        quantifiedAssociations: product.quantified_associations ?? {},
        updatedAt: product.updated ?? null,
      },
    }

    let localVariantId: string
    let variantAction: 'create' | 'update'
    if (existingVariantId) {
      await executeCommand('catalog.variants.update', {
        id: existingVariantId,
        ...variantInput,
      })
      localVariantId = existingVariantId
      variantAction = 'update'
    } else {
      const created = await executeCommand<{ variantId?: string; id?: string }>('catalog.variants.create', variantInput)
      localVariantId = created.variantId ?? created.id ?? ''
      if (!localVariantId) {
        throw new Error(`Akeneo variant ${variantExternalId} did not return a local variant id`)
      }
      variantAction = 'create'
    }
    await externalIdMappingService.storeExternalIdMapping('sync_akeneo', 'catalog_product_variant', localVariantId, variantExternalId, scope)

    if (settings) {
      await applyCustomFieldMappings({
        mapping,
        hierarchy,
        product,
        localProductId,
        localVariantId,
      })
      await upsertOffersAndPrices({
        mapping,
        settings,
        hierarchy,
        localProductId,
        localVariantId,
        resolvedProductTitle: resolvedTitle,
        resolvedProductDescription: resolvedDescription,
        variantExternalId,
      })

      const desiredAssets: DesiredAsset[] = []
      for (const mediaMapping of settings.mediaMappings) {
        const sourceLayers = mediaMapping.target === 'product'
          ? [hierarchy.rootValues, hierarchy.mergedValues]
          : [hierarchy.leafValues, hierarchy.mergedValues]
        const rawValue = readLayeredValue(sourceLayers, mediaMapping.attributeCode, locale, channel)
        const refs = collectMediaReferences(rawValue)
        refs.forEach((ref, index) => {
          desiredAssets.push({
            externalId: `${mediaMapping.target}:${mediaMapping.kind}:${mediaMapping.attributeCode}:${ref.codeOrUrl}:${index}`,
            entityId: mediaMapping.target === 'product' ? PRODUCT_ENTITY_ID : VARIANT_ENTITY_ID,
            recordId: mediaMapping.target === 'product' ? localProductId : localVariantId,
            kind: mediaMapping.kind,
            remote: ref,
          })
        })
      }

      const assetsByTarget = new Map<string, DesiredAsset[]>()
      for (const asset of desiredAssets) {
        const key = `${asset.entityId}:${asset.recordId}`
        const bucket = assetsByTarget.get(key) ?? []
        bucket.push(asset)
        assetsByTarget.set(key, bucket)
      }

      for (const assets of assetsByTarget.values()) {
        const firstAsset = assets[0]
        if (!firstAsset) continue
        const hero = await reconcileAttachments({
          entityId: firstAsset.entityId,
          recordId: firstAsset.recordId,
          desiredAssets: assets,
          reconciliation: settings.reconciliation,
        })
        if (firstAsset.entityId === PRODUCT_ENTITY_ID) {
          await executeCommand('catalog.products.update', {
            id: localProductId,
            defaultMediaId: hero.heroAttachmentId,
            defaultMediaUrl: hero.heroAttachmentUrl,
          })
        } else {
          await executeCommand('catalog.variants.update', {
            id: localVariantId,
            defaultMediaId: hero.heroAttachmentId,
            defaultMediaUrl: hero.heroAttachmentUrl,
          })
        }
      }

      await syncAssociations({
        product,
        localVariantId,
        localProductId,
        settings,
      })
    }

    return [
      {
        externalId: productExternalId,
        action: productAction,
        data: {
          localProductId,
          sku: resolvedSku,
          family: hierarchy.family,
        },
      },
      {
        externalId: variantExternalId,
        action: variantAction,
        data: {
          localVariantId,
          productId: localProductId,
          sku: resolvedSku,
        },
      },
    ]
  }

  async function deactivateMappedEntities(entityType: string, seenExternalIds: Set<string>, commandId: string): Promise<void> {
    const mappings = await em.find(SyncExternalIdMapping, {
      integrationId: 'sync_akeneo',
      internalEntityType: entityType,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    for (const mapping of mappings) {
      if (seenExternalIds.has(mapping.externalId)) continue
      await executeCommand(commandId, {
        id: mapping.internalEntityId,
        isActive: false,
      })
    }
  }

  async function reconcileCategories(seenExternalIds: Set<string>, locale: string, reconciliation: AkeneoReconciliationSettings): Promise<void> {
    if (!reconciliation.deactivateMissingCategories || seenExternalIds.size === 0) return
    await deactivateMappedEntities('catalog_product_category', seenExternalIds, 'catalog.categories.update')
  }

  async function reconcileAttributes(params: {
    seenFamilyExternalIds: Set<string>
    currentCustomFieldKeys: Set<string>
    reconciliation: AkeneoReconciliationSettings
  }): Promise<void> {
    if (!params.reconciliation.deactivateMissingAttributes) return
    if (params.seenFamilyExternalIds.size > 0) {
      await deactivateMappedEntities('catalog_option_schema', params.seenFamilyExternalIds, 'catalog.optionSchemas.update')
    }
    const defs = await em.find(CustomFieldDef, {
      entityId: { $in: [PRODUCT_ENTITY_ID, VARIANT_ENTITY_ID] },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    })
    for (const def of defs) {
      const sourceMetadata = safeRecord(def.configJson?.sourceMetadata)
      if (sourceMetadata?.provider !== 'akeneo') continue
      if (params.currentCustomFieldKeys.has(`${def.entityId}:${def.key}`)) continue
      def.isActive = false
    }
    await em.flush()
  }

  async function reconcileProducts(seenProductExternalIds: Set<string>, seenVariantExternalIds: Set<string>, reconciliation: AkeneoReconciliationSettings): Promise<void> {
    if (!reconciliation.deactivateMissingProducts) return
    if (seenProductExternalIds.size > 0) {
      await deactivateMappedEntities('catalog_product', seenProductExternalIds, 'catalog.products.update')
    }
    if (seenVariantExternalIds.size > 0) {
      await deactivateMappedEntities('catalog_product_variant', seenVariantExternalIds, 'catalog.variants.update')
    }
  }

  return {
    upsertCategory,
    upsertAttributeFamily,
    upsertProduct,
    syncMappedCustomFields,
    reconcileCategories,
    reconcileAttributes,
    reconcileProducts,
  }
}
