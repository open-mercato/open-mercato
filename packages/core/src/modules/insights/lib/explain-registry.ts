import { createLogger } from '@open-mercato/shared/lib/logger'
import { isCauseKind, type CauseKind } from '@open-mercato/shared/lib/causation/types'
import {
  EXPLAIN_CONFIG_VERSION,
  type ExplainCauseResolver,
  type ExplainFieldProvider,
  type ExplainModuleConfig,
  type ExplainReferenceResolver,
  type ExplainResourceDescriptor,
} from '@open-mercato/shared/modules/insights/explain'

const logger = createLogger('insights').child({ component: 'explain-registry' })

export type ExplainConfigRegistrationEntry = {
  moduleId: string
  config: unknown
}

export type RegisteredExplainResource = {
  moduleId: string
  descriptor: ExplainResourceDescriptor
}

export type RegisteredCauseResolver = {
  moduleId: string
  resolver: ExplainCauseResolver
}

export type RegisteredReferenceResolver = {
  moduleId: string
  resolver: ExplainReferenceResolver
}

export type RegisteredExplainProvider = {
  moduleId: string
  provider: ExplainFieldProvider
}

type ExplainRegistryState = {
  resources: Map<string, RegisteredExplainResource>
  logResourceKinds: Map<string, string>
  causeResolvers: Map<string, RegisteredCauseResolver>
  referenceResolvers: Map<string, RegisteredReferenceResolver>
  providers: Map<string, RegisteredExplainProvider>
}

const REGISTRY_KEY = Symbol.for('@open-mercato/core/insights/explain-registry')

type GlobalWithExplainRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: ExplainRegistryState
}

function createState(): ExplainRegistryState {
  return {
    resources: new Map(),
    logResourceKinds: new Map(),
    causeResolvers: new Map(),
    referenceResolvers: new Map(),
    providers: new Map(),
  }
}

function resolveState(): ExplainRegistryState {
  const scope = globalThis as GlobalWithExplainRegistry
  if (!scope[REGISTRY_KEY]) scope[REGISTRY_KEY] = createState()
  return scope[REGISTRY_KEY]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isRequiredFeatureList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
}

function isOptionalFeatureList(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every(isNonEmptyString))
}

function isValidFieldList(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every((field) => (
    isPlainObject(field)
    && isNonEmptyString(field.key)
    && isNonEmptyString(field.labelKey)
    && isNonEmptyString(field.valueKind)
    && isStringArray(field.snapshotPaths)
    && isOptionalFeatureList(field.requiredFeatures)
  ))
}

function isValidResource(value: unknown): value is ExplainResourceDescriptor {
  if (!isPlainObject(value)) return false
  if (!isNonEmptyString(value.resourceKind) || !isNonEmptyString(value.labelKey)) return false
  if (!isRequiredFeatureList(value.requiredFeatures)) return false
  if (typeof value.loadCurrent !== 'function') return false
  if (!isValidFieldList(value.fields)) return false
  if (value.logResourceKinds !== undefined && !isStringArray(value.logResourceKinds)) return false
  if (value.collections !== undefined) {
    if (!Array.isArray(value.collections)) return false
    const collectionsValid = value.collections.every((collection) => (
      isPlainObject(collection)
      && isNonEmptyString(collection.key)
      && isNonEmptyString(collection.snapshotPath)
      && isNonEmptyString(collection.itemIdPath)
      && (collection.itemResourceKinds === undefined || isStringArray(collection.itemResourceKinds))
      && isOptionalFeatureList(collection.requiredFeatures)
      && isValidFieldList(collection.fields)
    ))
    if (!collectionsValid) return false
  }
  if (value.customFields !== undefined) {
    if (!isPlainObject(value.customFields) || !isNonEmptyString(value.customFields.entityId)) return false
    if (!isOptionalFeatureList(value.customFields.requiredFeatures)) return false
  }
  return true
}

function isValidCauseResolver(value: unknown): value is ExplainCauseResolver {
  return isPlainObject(value)
    && isCauseKind(value.kind)
    && isRequiredFeatureList(value.requiredFeatures)
    && typeof value.resolve === 'function'
}

function isValidReferenceResolver(value: unknown): value is ExplainReferenceResolver {
  return isPlainObject(value)
    && isNonEmptyString(value.kind)
    && isRequiredFeatureList(value.requiredFeatures)
    && typeof value.resolve === 'function'
}

function isValidProvider(value: unknown): value is ExplainFieldProvider {
  return isPlainObject(value) && isNonEmptyString(value.id) && typeof value.explain === 'function'
}

function readModuleConfig(moduleId: string, config: unknown): ExplainModuleConfig | null {
  if (config === null || config === undefined) return null
  if (!isPlainObject(config)) {
    logger.warn('Ignoring explain config that is not an object', { moduleId })
    return null
  }
  if (config.version !== EXPLAIN_CONFIG_VERSION) {
    logger.warn('Ignoring explain config with an unsupported version', { moduleId, version: String(config.version) })
    return null
  }
  return config as ExplainModuleConfig
}

function claim<TEntry extends { moduleId: string }>(
  target: Map<string, TEntry>,
  key: string,
  entry: TEntry,
  kind: string,
): boolean {
  const existing = target.get(key)
  if (existing && existing.moduleId !== entry.moduleId) {
    logger.warn('Ignoring duplicate explain declaration; the first registration is kept', {
      kind,
      key,
      moduleId: entry.moduleId,
      registeredBy: existing.moduleId,
    })
    return false
  }
  target.set(key, entry)
  return true
}

function registerResource(state: ExplainRegistryState, moduleId: string, resource: unknown): void {
  if (!isValidResource(resource)) {
    logger.warn('Ignoring invalid explain resource declaration', {
      moduleId,
      resourceKind: isPlainObject(resource) && typeof resource.resourceKind === 'string' ? resource.resourceKind : null,
    })
    return
  }
  const registered = claim(state.resources, resource.resourceKind, { moduleId, descriptor: resource }, 'resource')
  if (!registered) return
  const logKinds = new Set([resource.resourceKind, ...(resource.logResourceKinds ?? [])])
  for (const logKind of logKinds) {
    const owner = state.logResourceKinds.get(logKind)
    if (owner && owner !== resource.resourceKind) {
      logger.warn('Ignoring duplicate explain log resource kind; the first registration is kept', {
        logResourceKind: logKind,
        resourceKind: resource.resourceKind,
        registeredFor: owner,
      })
      continue
    }
    state.logResourceKinds.set(logKind, resource.resourceKind)
  }
}

export function registerExplainConfigEntries(entries: readonly ExplainConfigRegistrationEntry[]): void {
  const state = resolveState()
  for (const entry of entries ?? []) {
    if (!entry || !isNonEmptyString(entry.moduleId)) continue
    const config = readModuleConfig(entry.moduleId, entry.config)
    if (!config) continue
    for (const resource of Array.isArray(config.resources) ? config.resources : []) {
      registerResource(state, entry.moduleId, resource)
    }
    for (const resolver of Array.isArray(config.causeResolvers) ? config.causeResolvers : []) {
      if (!isValidCauseResolver(resolver)) {
        logger.warn('Ignoring invalid explain cause resolver', { moduleId: entry.moduleId })
        continue
      }
      claim(state.causeResolvers, resolver.kind, { moduleId: entry.moduleId, resolver }, 'cause_resolver')
    }
    for (const resolver of Array.isArray(config.referenceResolvers) ? config.referenceResolvers : []) {
      if (!isValidReferenceResolver(resolver)) {
        logger.warn('Ignoring invalid explain reference resolver', { moduleId: entry.moduleId })
        continue
      }
      claim(state.referenceResolvers, resolver.kind, { moduleId: entry.moduleId, resolver }, 'reference_resolver')
    }
    for (const provider of Array.isArray(config.providers) ? config.providers : []) {
      if (!isValidProvider(provider)) {
        logger.warn('Ignoring invalid explain field provider', { moduleId: entry.moduleId })
        continue
      }
      claim(state.providers, provider.id, { moduleId: entry.moduleId, provider }, 'provider')
    }
  }
}

export function getExplainResource(resourceKind: string): RegisteredExplainResource | null {
  return resolveState().resources.get(resourceKind) ?? null
}

export function findExplainResourceByLogKind(logResourceKind: string): RegisteredExplainResource | null {
  const state = resolveState()
  const resourceKind = state.logResourceKinds.get(logResourceKind)
  return resourceKind ? state.resources.get(resourceKind) ?? null : null
}

export function listExplainResources(): RegisteredExplainResource[] {
  return Array.from(resolveState().resources.values())
}

export function getExplainCauseResolver(kind: CauseKind): RegisteredCauseResolver | null {
  return resolveState().causeResolvers.get(kind) ?? null
}

export function getExplainReferenceResolver(kind: string): RegisteredReferenceResolver | null {
  return resolveState().referenceResolvers.get(kind) ?? null
}

export function getExplainProvider(id: string): RegisteredExplainProvider | null {
  return resolveState().providers.get(id) ?? null
}

export function resetExplainRegistryForTests(): void {
  const scope = globalThis as GlobalWithExplainRegistry
  scope[REGISTRY_KEY] = createState()
}
