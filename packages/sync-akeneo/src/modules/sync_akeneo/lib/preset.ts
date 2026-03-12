import type { EntityManager } from '@mikro-orm/postgresql'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import { SyncMapping } from '@open-mercato/core/modules/data_sync/data/entities'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { createAkeneoClient } from './client'
import { inferAkeneoProductMapping } from './inference'
import {
  buildAkeneoFieldsetCode,
  buildDefaultAkeneoMapping,
  buildProductFieldMappings,
  normalizeAkeneoMapping,
  type AkeneoCredentialShape,
} from './shared'

const AKENEO_INTEGRATION_ID = 'sync_akeneo'

type IntegrationScope = {
  organizationId: string
  tenantId: string
}

type LocalChannelOption = {
  code: string
  name: string
}

type PriceKindOption = {
  code: string
  title: string
  displayMode: string
}

type DiscoverySnapshot = {
  locales: Array<{ code: string; label: string; enabled?: boolean }>
  channels: Array<{ code: string; label: string; locales: string[] }>
  attributes: Array<{
    code: string
    type: string
    label: string
    localizable: boolean
    scopable: boolean
    group?: string
    metricFamily?: string
  }>
  families: Array<{ code: string; label: string; attributeCount: number }>
  familyVariants: Array<{ familyCode: string; code: string; label: string; axes: string[]; attributes: string[] }>
}

type AkeneoEnvPreset = {
  credentials: AkeneoCredentialShape
  force: boolean
  productLocale?: string
  categoryLocale?: string
  productChannel?: string | null
  productChannels?: string[]
  importAllChannels?: boolean
  createMissingChannels?: boolean
  syncAssociations?: boolean
  familyCodeFilter?: string[]
  productsSettingsOverride?: Record<string, unknown>
  categoriesSettingsOverride?: Record<string, unknown>
  attributesSettingsOverride?: Record<string, unknown>
}

export type ApplyAkeneoPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured'; discoveryApplied: true }

function readEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function readCsvEnv(env: NodeJS.ProcessEnv, keys: string[]): string[] | undefined {
  const raw = readEnvValue(env, keys)
  if (!raw) return undefined
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  return values.length > 0 ? Array.from(new Set(values)) : undefined
}

function readBooleanEnv(env: NodeJS.ProcessEnv, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const parsed = parseBooleanToken(env[key])
    if (parsed !== null) return parsed
  }
  return undefined
}

function readJsonEnv(env: NodeJS.ProcessEnv, keys: string[], label: string): Record<string, unknown> | undefined {
  const raw = readEnvValue(env, keys)
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    throw new Error(`[sync_akeneo] ${label} is not valid JSON: ${message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`[sync_akeneo] ${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

export function readAkeneoEnvPreset(env: NodeJS.ProcessEnv = process.env): AkeneoEnvPreset | null {
  const credentialKeys = {
    apiUrl: ['OM_INTEGRATION_AKENEO_API_URL', 'OPENMERCATO_AKENEO_API_URL', 'AKENEO_API_URL'],
    clientId: ['OM_INTEGRATION_AKENEO_CLIENT_ID', 'OPENMERCATO_AKENEO_CLIENT_ID', 'AKENEO_CLIENT_ID'],
    clientSecret: ['OM_INTEGRATION_AKENEO_CLIENT_SECRET', 'OPENMERCATO_AKENEO_CLIENT_SECRET', 'AKENEO_CLIENT_SECRET'],
    username: ['OM_INTEGRATION_AKENEO_USERNAME', 'OPENMERCATO_AKENEO_USERNAME', 'AKENEO_USERNAME'],
    password: ['OM_INTEGRATION_AKENEO_PASSWORD', 'OPENMERCATO_AKENEO_PASSWORD', 'AKENEO_PASSWORD'],
  } as const

  const anyCredentialProvided = Object.values(credentialKeys).some((keys) => Boolean(readEnvValue(env, [...keys])))
  if (!anyCredentialProvided) {
    return null
  }

  const apiUrl = readEnvValue(env, [...credentialKeys.apiUrl])
  const clientId = readEnvValue(env, [...credentialKeys.clientId])
  const clientSecret = readEnvValue(env, [...credentialKeys.clientSecret])
  const username = readEnvValue(env, [...credentialKeys.username])
  const password = readEnvValue(env, [...credentialKeys.password])

  if (!apiUrl || !clientId || !clientSecret || !username || !password) {
    throw new Error(
      '[sync_akeneo] Incomplete Akeneo env preset. Set OM_INTEGRATION_AKENEO_API_URL, OM_INTEGRATION_AKENEO_CLIENT_ID, OM_INTEGRATION_AKENEO_CLIENT_SECRET, OM_INTEGRATION_AKENEO_USERNAME, and OM_INTEGRATION_AKENEO_PASSWORD.',
    )
  }

  return {
    credentials: {
      apiUrl,
      clientId,
      clientSecret,
      username,
      password,
    },
    force: readBooleanEnv(env, ['OM_INTEGRATION_AKENEO_FORCE_PRECONFIGURE', 'OPENMERCATO_AKENEO_FORCE_PRECONFIGURE', 'AKENEO_FORCE_PRECONFIGURE']) ?? false,
    productLocale: readEnvValue(env, ['OM_INTEGRATION_AKENEO_PRODUCT_LOCALE', 'OPENMERCATO_AKENEO_PRODUCT_LOCALE', 'AKENEO_PRODUCT_LOCALE']),
    categoryLocale: readEnvValue(env, ['OM_INTEGRATION_AKENEO_CATEGORY_LOCALE', 'OPENMERCATO_AKENEO_CATEGORY_LOCALE', 'AKENEO_CATEGORY_LOCALE']),
    productChannel: readEnvValue(env, ['OM_INTEGRATION_AKENEO_PRODUCT_CHANNEL', 'OPENMERCATO_AKENEO_PRODUCT_CHANNEL', 'AKENEO_PRODUCT_CHANNEL']) ?? undefined,
    productChannels: readCsvEnv(env, ['OM_INTEGRATION_AKENEO_IMPORT_CHANNELS', 'OPENMERCATO_AKENEO_IMPORT_CHANNELS', 'AKENEO_IMPORT_CHANNELS']),
    importAllChannels: readBooleanEnv(env, ['OM_INTEGRATION_AKENEO_IMPORT_ALL_CHANNELS', 'OPENMERCATO_AKENEO_IMPORT_ALL_CHANNELS', 'AKENEO_IMPORT_ALL_CHANNELS']),
    createMissingChannels: readBooleanEnv(env, ['OM_INTEGRATION_AKENEO_CREATE_MISSING_CHANNELS', 'OPENMERCATO_AKENEO_CREATE_MISSING_CHANNELS', 'AKENEO_CREATE_MISSING_CHANNELS']),
    syncAssociations: readBooleanEnv(env, ['OM_INTEGRATION_AKENEO_SYNC_ASSOCIATIONS', 'OPENMERCATO_AKENEO_SYNC_ASSOCIATIONS', 'AKENEO_SYNC_ASSOCIATIONS']),
    familyCodeFilter: readCsvEnv(env, ['OM_INTEGRATION_AKENEO_ATTRIBUTE_FAMILY_FILTER', 'OPENMERCATO_AKENEO_ATTRIBUTE_FAMILY_FILTER', 'AKENEO_ATTRIBUTE_FAMILY_FILTER']),
    productsSettingsOverride: readJsonEnv(
      env,
      ['OM_INTEGRATION_AKENEO_PRODUCTS_SETTINGS_JSON', 'OPENMERCATO_AKENEO_PRODUCTS_SETTINGS_JSON', 'AKENEO_PRODUCTS_SETTINGS_JSON'],
      'OM_INTEGRATION_AKENEO_PRODUCTS_SETTINGS_JSON',
    ),
    categoriesSettingsOverride: readJsonEnv(
      env,
      ['OM_INTEGRATION_AKENEO_CATEGORIES_SETTINGS_JSON', 'OPENMERCATO_AKENEO_CATEGORIES_SETTINGS_JSON', 'AKENEO_CATEGORIES_SETTINGS_JSON'],
      'OM_INTEGRATION_AKENEO_CATEGORIES_SETTINGS_JSON',
    ),
    attributesSettingsOverride: readJsonEnv(
      env,
      ['OM_INTEGRATION_AKENEO_ATTRIBUTES_SETTINGS_JSON', 'OPENMERCATO_AKENEO_ATTRIBUTES_SETTINGS_JSON', 'AKENEO_ATTRIBUTES_SETTINGS_JSON'],
      'OM_INTEGRATION_AKENEO_ATTRIBUTES_SETTINGS_JSON',
    ),
  }
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

function buildDiscoveredFieldsetMappings(discovery: DiscoverySnapshot): Array<{
  sourceType: 'family' | 'familyVariant'
  sourceCode: string
  target: 'product' | 'variant'
  fieldsetCode: string
  fieldsetLabel: string
  description: string
}> {
  const familyRows = discovery.families.flatMap((family) => {
    const fieldsetCode = buildAkeneoFieldsetCode('product', family.code)
    if (!fieldsetCode) return []
    return [{
      sourceType: 'family' as const,
      sourceCode: family.code,
      target: 'product' as const,
      fieldsetCode,
      fieldsetLabel: family.label || family.code,
      description: `Akeneo family ${family.code}`,
    }]
  })

  const familyVariantRows = discovery.familyVariants.flatMap((familyVariant) => {
    const fieldsetCode = buildAkeneoFieldsetCode('variant', familyVariant.code)
    if (!fieldsetCode) return []
    return [{
      sourceType: 'familyVariant' as const,
      sourceCode: familyVariant.code,
      target: 'variant' as const,
      fieldsetCode,
      fieldsetLabel: familyVariant.label || familyVariant.code,
      description: `Akeneo family variant ${familyVariant.code} from family ${familyVariant.familyCode}`,
    }]
  })

  return [...familyRows, ...familyVariantRows]
}

export function buildAkeneoMappingsFromPreset(input: {
  preset: AkeneoEnvPreset
  discovery: DiscoverySnapshot
  localChannels: LocalChannelOption[]
  priceKinds: PriceKindOption[]
}): {
  productsMapping: ReturnType<typeof buildDefaultAkeneoMapping>
  categoriesMapping: ReturnType<typeof buildDefaultAkeneoMapping>
  attributesMapping: ReturnType<typeof buildDefaultAkeneoMapping>
} {
  const { preset, discovery, localChannels, priceKinds } = input
  const baseProducts = buildDefaultAkeneoMapping('products')
  const productSettings = baseProducts.settings?.products
  if (!productSettings) {
    throw new Error('[sync_akeneo] Failed to resolve default product mapping settings.')
  }

  const discoveredFamilyVariant = discovery.familyVariants.length > 0
    ? {
        code: '__discovery__',
        variant_attribute_sets: discovery.familyVariants.map((familyVariant, index) => ({
          level: index + 1,
          axes: familyVariant.axes,
          attributes: familyVariant.attributes,
        })),
      }
    : null

  const inferred = inferAkeneoProductMapping({
    attributes: discovery.attributes.map((attribute) => ({
      code: attribute.code,
      type: attribute.type,
      labels: attribute.label ? { inferred: attribute.label } : undefined,
      localizable: attribute.localizable,
      scopable: attribute.scopable,
      group: attribute.group,
      metric_family: attribute.metricFamily,
    })),
    family: null,
    familyVariant: discoveredFamilyVariant,
    fieldMap: productSettings.fieldMap,
    explicitCustomFieldMappings: [],
    explicitMediaMappings: [],
  })

  const preferredLocale = preset.productLocale
    ?? productSettings.locale
    ?? discovery.locales.find((locale) => locale.enabled)?.code
    ?? discovery.locales[0]?.code
  const preferredAkeneoChannel = preset.productChannel
    ?? discovery.channels[0]?.code
    ?? productSettings.channel
  const preferredLocalChannel = localChannels.find((channel) => ['web', 'online', 'ecommerce', 'default'].includes(channel.code.trim().toLowerCase()))
    ?? localChannels[0]
    ?? null
  const selectedChannels = preset.productChannels
    ?? (preferredAkeneoChannel ? [preferredAkeneoChannel] : [])

  const discoveredPriceMappings = preferredLocalChannel
    ? inferred.autoPriceAttributeCodes.map((attributeCode) => {
        const inferredKind = inferPriceKindCode(attributeCode)
        const matchedPriceKind = priceKinds.find((priceKind) => priceKind.code === inferredKind)
        return {
          attributeCode,
          priceKindCode: matchedPriceKind?.code ?? inferredKind,
          akeneoChannel: preferredAkeneoChannel ?? null,
          localChannelCode: preferredLocalChannel.code,
        }
      })
    : []

  const productsOverride = preset.productsSettingsOverride ?? {}
  const overrideFieldMap = productsOverride.fieldMap && typeof productsOverride.fieldMap === 'object' && !Array.isArray(productsOverride.fieldMap)
    ? productsOverride.fieldMap as Record<string, unknown>
    : null
  const overrideReconciliation = productsOverride.reconciliation && typeof productsOverride.reconciliation === 'object' && !Array.isArray(productsOverride.reconciliation)
    ? productsOverride.reconciliation as Record<string, unknown>
    : null
  const {
    fieldMap: _ignoredFieldMap,
    reconciliation: _ignoredReconciliation,
    ...productsOverrideShallow
  } = productsOverride

  const rawProductsMapping = {
    ...baseProducts,
    settings: {
      products: {
        ...productSettings,
        locale: preferredLocale,
        channel: preferredAkeneoChannel ?? null,
        channels: selectedChannels,
        importAllChannels: preset.importAllChannels ?? productSettings.importAllChannels,
        customFieldMappings: inferred.autoCustomFieldMappings.map((mapping) => ({
          attributeCode: mapping.attributeCode,
          target: mapping.target,
          fieldKey: mapping.fieldKey,
          kind: mapping.kind ?? null,
          skip: mapping.skip ?? false,
        })),
        mediaMappings: inferred.autoMediaMappings.map((mapping) => ({
          attributeCode: mapping.attributeCode,
          target: mapping.target,
          kind: mapping.kind,
        })),
        priceMappings: discoveredPriceMappings,
        fieldsetMappings: buildDiscoveredFieldsetMappings(discovery),
        createMissingChannels: preset.createMissingChannels ?? productSettings.createMissingChannels,
        syncAssociations: preset.syncAssociations ?? productSettings.syncAssociations,
        ...productsOverrideShallow,
        fieldMap: {
          ...inferred.fieldMap,
          ...(overrideFieldMap ?? {}),
        },
        reconciliation: {
          ...productSettings.reconciliation,
          ...(overrideReconciliation ?? {}),
        },
      },
    },
  }
  const productsMapping = normalizeAkeneoMapping('products', rawProductsMapping as Record<string, unknown>)
  if (productsMapping.settings?.products) {
    productsMapping.fields = buildProductFieldMappings(productsMapping.settings.products)
  }

  const baseCategories = buildDefaultAkeneoMapping('categories')
  const categoriesMapping = normalizeAkeneoMapping('categories', {
    ...baseCategories,
    settings: {
      categories: {
        locale: preset.categoryLocale ?? preferredLocale,
        ...(preset.categoriesSettingsOverride ?? {}),
      },
    },
  })

  const baseAttributes = buildDefaultAkeneoMapping('attributes')
  const attributesMapping = normalizeAkeneoMapping('attributes', {
    ...baseAttributes,
    settings: {
      attributes: {
        ...baseAttributes.settings?.attributes,
        familyCodeFilter: preset.familyCodeFilter ?? baseAttributes.settings?.attributes?.familyCodeFilter ?? [],
        ...(preset.attributesSettingsOverride ?? {}),
      },
    },
  })

  return {
    productsMapping,
    categoriesMapping,
    attributesMapping,
  }
}

async function loadLocalDiscoveryContext(em: EntityManager, scope: IntegrationScope): Promise<{
  localChannels: LocalChannelOption[]
  priceKinds: PriceKindOption[]
}> {
  const [channels, priceKinds] = await Promise.all([
    findWithDecryption(em, SalesChannel, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      isActive: true,
    }, {
      fields: ['code', 'name'],
      orderBy: { name: 'asc' },
    }, scope),
    findWithDecryption(em, CatalogPriceKind, {
      tenantId: scope.tenantId,
      deletedAt: null,
      isActive: true,
    }, {
      fields: ['code', 'title', 'displayMode'],
      orderBy: { title: 'asc' },
    }, scope),
  ])

  return {
    localChannels: channels
      .filter((channel) => typeof channel.code === 'string' && channel.code.trim().length > 0)
      .map((channel) => ({ code: String(channel.code), name: channel.name })),
    priceKinds: priceKinds.map((priceKind) => ({
      code: priceKind.code,
      title: priceKind.title,
      displayMode: priceKind.displayMode,
    })),
  }
}

async function upsertSyncMapping(
  em: EntityManager,
  entityType: 'products' | 'categories' | 'attributes',
  mapping: Record<string, unknown>,
  scope: IntegrationScope,
): Promise<void> {
  const existing = await findOneWithDecryption(em, SyncMapping, {
    integrationId: AKENEO_INTEGRATION_ID,
    entityType,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  }, undefined, scope)

  if (existing) {
    existing.mapping = mapping
    await em.flush()
    return
  }

  const created = em.create(SyncMapping, {
    integrationId: AKENEO_INTEGRATION_ID,
    entityType,
    mapping,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  await em.persistAndFlush(created)
}

async function hasExistingAkeneoConfiguration(
  em: EntityManager,
  credentialsService: CredentialsService,
  scope: IntegrationScope,
): Promise<boolean> {
  const [credentials, mappings] = await Promise.all([
    credentialsService.getRaw(AKENEO_INTEGRATION_ID, scope),
    findOneWithDecryption(em, SyncMapping, {
      integrationId: AKENEO_INTEGRATION_ID,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    }, {
      fields: ['id'],
    }, scope),
  ])
  return Boolean(credentials) || Boolean(mappings)
}

export async function applyAkeneoEnvPreset(params: {
  em: EntityManager
  credentialsService: CredentialsService
  integrationStateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyAkeneoPresetResult> {
  const preset = readAkeneoEnvPreset(params.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No Akeneo preset env variables were provided.' }
  }

  const force = params.force ?? preset.force
  if (!force && await hasExistingAkeneoConfiguration(params.em, params.credentialsService, params.scope)) {
    return { status: 'skipped', reason: 'Akeneo credentials or mappings already exist. Use force to overwrite them.' }
  }

  await params.credentialsService.save(AKENEO_INTEGRATION_ID, preset.credentials, params.scope)

  const client = createAkeneoClient(preset.credentials)
  const [discovery, localContext] = await Promise.all([
    client.collectDiscoveryData(),
    loadLocalDiscoveryContext(params.em, params.scope),
  ])

  const mappings = buildAkeneoMappingsFromPreset({
    preset,
    discovery,
    localChannels: localContext.localChannels,
    priceKinds: localContext.priceKinds,
  })

  await upsertSyncMapping(params.em, 'products', mappings.productsMapping as unknown as Record<string, unknown>, params.scope)
  await upsertSyncMapping(params.em, 'categories', mappings.categoriesMapping as unknown as Record<string, unknown>, params.scope)
  await upsertSyncMapping(params.em, 'attributes', mappings.attributesMapping as unknown as Record<string, unknown>, params.scope)
  await params.integrationStateService.upsert(AKENEO_INTEGRATION_ID, { isEnabled: true }, params.scope)

  if (params.integrationLogService) {
    await params.integrationLogService.scoped(AKENEO_INTEGRATION_ID, params.scope).info(
      'Akeneo integration was preconfigured from environment variables.',
      {
        locale: mappings.productsMapping.settings?.products?.locale ?? null,
        channel: mappings.productsMapping.settings?.products?.channel ?? null,
        importAllChannels: mappings.productsMapping.settings?.products?.importAllChannels ?? null,
      },
    )
  }

  return { status: 'configured', discoveryApplied: true }
}
