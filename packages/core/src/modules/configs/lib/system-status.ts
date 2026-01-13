import type {
  SystemStatusCategory,
  SystemStatusCategoryKey,
  SystemStatusItem,
  SystemStatusSnapshot,
  SystemStatusVariableKind,
  SystemStatusState,
  SystemStatusRuntimeMode,
} from './system-status.types'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

type SystemStatusVariableDefinition = {
  key: string
  category: SystemStatusCategoryKey
  kind: SystemStatusVariableKind
  labelKey: string
  descriptionKey: string
  docUrl: string | null
  defaultValue: string | null
}

const CATEGORY_ORDER: SystemStatusCategoryKey[] = ['profiling', 'logging', 'caching', 'query_index', 'entities']

const CATEGORY_METADATA: Record<
  SystemStatusCategoryKey,
  { labelKey: string; descriptionKey: string | null }
> = {
  profiling: {
    labelKey: 'configs.systemStatus.categories.profiling',
    descriptionKey: 'configs.systemStatus.categories.profilingDescription',
  },
  logging: {
    labelKey: 'configs.systemStatus.categories.logging',
    descriptionKey: 'configs.systemStatus.categories.loggingDescription',
  },
  caching: {
    labelKey: 'configs.systemStatus.categories.caching',
    descriptionKey: 'configs.systemStatus.categories.cachingDescription',
  },
  query_index: {
    labelKey: 'configs.systemStatus.categories.queryIndex',
    descriptionKey: 'configs.systemStatus.categories.queryIndexDescription',
  },
  entities: {
    labelKey: 'configs.systemStatus.categories.entities',
    descriptionKey: 'configs.systemStatus.categories.entitiesDescription',
  },
}

const SYSTEM_STATUS_DOC_BASE = 'https://docs.openmercato.com/docs/framework/operations/system-status'

export const SYSTEM_STATUS_VARIABLES: SystemStatusVariableDefinition[] = [
  {
    key: 'OM_PROFILE',
    category: 'profiling',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.omProfile.label',
    descriptionKey: 'configs.systemStatus.variables.omProfile.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#om_profile`,
    defaultValue: '',
  },
  {
    key: 'NEXT_PUBLIC_OM_PROFILE',
    category: 'profiling',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.nextPublicOmProfile.label',
    descriptionKey: 'configs.systemStatus.variables.nextPublicOmProfile.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#next_public_om_profile`,
    defaultValue: '',
  },
  {
    key: 'OM_CRUD_PROFILE',
    category: 'profiling',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.omCrudProfile.label',
    descriptionKey: 'configs.systemStatus.variables.omCrudProfile.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#om_crud_profile`,
    defaultValue: '',
  },
  {
    key: 'OM_QE_PROFILE',
    category: 'profiling',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.omQeProfile.label',
    descriptionKey: 'configs.systemStatus.variables.omQeProfile.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#om_qe_profile`,
    defaultValue: '',
  },
  {
    key: 'QUERY_ENGINE_DEBUG_SQL',
    category: 'logging',
    kind: 'boolean',
    labelKey: 'configs.systemStatus.variables.queryEngineDebugSql.label',
    descriptionKey: 'configs.systemStatus.variables.queryEngineDebugSql.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#query_engine_debug_sql`,
    defaultValue: 'false',
  },
  {
    key: 'LOG_VERBOSITY',
    category: 'logging',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.logVerbosity.label',
    descriptionKey: 'configs.systemStatus.variables.logVerbosity.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#log_verbosity`,
    defaultValue: '',
  },
  {
    key: 'LOG_LEVEL',
    category: 'logging',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.logLevel.label',
    descriptionKey: 'configs.systemStatus.variables.logLevel.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#log_level`,
    defaultValue: '',
  },
  {
    key: 'ENABLE_CRUD_API_CACHE',
    category: 'caching',
    kind: 'boolean',
    labelKey: 'configs.systemStatus.variables.enableCrudApiCache.label',
    descriptionKey: 'configs.systemStatus.variables.enableCrudApiCache.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#enable_crud_api_cache`,
    defaultValue: 'false',
  },
  {
    key: 'CACHE_STRATEGY',
    category: 'caching',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.cacheStrategy.label',
    descriptionKey: 'configs.systemStatus.variables.cacheStrategy.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#cache_strategy`,
    defaultValue: 'memory',
  },
  {
    key: 'CACHE_TTL',
    category: 'caching',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.cacheTtl.label',
    descriptionKey: 'configs.systemStatus.variables.cacheTtl.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#cache_ttl`,
    defaultValue: '',
  },
  {
    key: 'CACHE_SQLITE_PATH',
    category: 'caching',
    kind: 'string',
    labelKey: 'configs.systemStatus.variables.cacheSqlitePath.label',
    descriptionKey: 'configs.systemStatus.variables.cacheSqlitePath.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#cache_sqlite_path`,
    defaultValue: './data/cache.db',
  },
  {
    key: 'SCHEDULE_AUTO_REINDEX',
    category: 'query_index',
    kind: 'boolean',
    labelKey: 'configs.systemStatus.variables.scheduleAutoReindex.label',
    descriptionKey: 'configs.systemStatus.variables.scheduleAutoReindex.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#schedule_auto_reindex`,
    defaultValue: 'true',
  },
  {
    key: 'OPTIMIZE_INDEX_COVERAGE_STATS',
    category: 'query_index',
    kind: 'boolean',
    labelKey: 'configs.systemStatus.variables.optimizeIndexCoverageStats.label',
    descriptionKey: 'configs.systemStatus.variables.optimizeIndexCoverageStats.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#optimize_index_coverage_stats`,
    defaultValue: 'false',
  },
  {
    key: 'FORCE_QUERY_INDEX_ON_PARTIAL_INDEXES',
    category: 'query_index',
    kind: 'boolean',
    labelKey: 'configs.systemStatus.variables.forceQueryIndexOnPartialIndexes.label',
    descriptionKey: 'configs.systemStatus.variables.forceQueryIndexOnPartialIndexes.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#force_query_index_on_partial_indexes`,
    defaultValue: 'true',
  },
  {
    key: 'ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM',
    category: 'entities',
    kind: 'boolean',
    labelKey: 'configs.systemStatus.variables.entitiesBackcompatEav.label',
    descriptionKey: 'configs.systemStatus.variables.entitiesBackcompatEav.description',
    docUrl: `${SYSTEM_STATUS_DOC_BASE}#entities_backcompat_eav_for_custom`,
    defaultValue: 'false',
  },
]

type AnalyzedValue = { state: SystemStatusState; value: string | null; normalizedValue: string | null }

function analyzeBooleanValue(raw: string | undefined): AnalyzedValue {
  if (typeof raw !== 'string') {
    return { state: 'unset', value: null, normalizedValue: null }
  }
  const trimmed = raw.trim()
  if (!trimmed) return { state: 'unset', value: null, normalizedValue: null }
  const parsed = parseBooleanToken(trimmed)
  if (parsed === true) {
    return { state: 'enabled', value: trimmed, normalizedValue: 'true' }
  }
  if (parsed === false) {
    return { state: 'disabled', value: trimmed, normalizedValue: 'false' }
  }
  return { state: 'unknown', value: trimmed, normalizedValue: trimmed }
}

function analyzeStringValue(raw: string | undefined): AnalyzedValue {
  if (typeof raw !== 'string') {
    return { state: 'unset', value: null, normalizedValue: null }
  }
  const trimmed = raw.trim()
  if (!trimmed) return { state: 'unset', value: null, normalizedValue: null }
  return { state: 'set', value: trimmed, normalizedValue: trimmed }
}

function toItem(definition: SystemStatusVariableDefinition, env: Record<string, string | undefined>): SystemStatusItem {
  const raw = env[definition.key]
  const analyzed = definition.kind === 'boolean' ? analyzeBooleanValue(raw) : analyzeStringValue(raw)
  return {
    key: definition.key,
    category: definition.category,
    kind: definition.kind,
    labelKey: definition.labelKey,
    descriptionKey: definition.descriptionKey,
    docUrl: definition.docUrl,
    defaultValue: definition.defaultValue,
    state: analyzed.state,
    value: analyzed.value,
    normalizedValue: analyzed.normalizedValue,
  }
}

function buildCategorySnapshot(
  key: SystemStatusCategoryKey,
  items: SystemStatusItem[],
): SystemStatusCategory {
  const metadata = CATEGORY_METADATA[key]
  return {
    key,
    labelKey: metadata.labelKey,
    descriptionKey: metadata.descriptionKey,
    items,
  }
}

function resolveRuntimeMode(env: Record<string, string | undefined>): SystemStatusRuntimeMode {
  const raw = env.NODE_ENV
  if (typeof raw !== 'string') return 'unknown'
  const value = raw.trim().toLowerCase()
  if (value === 'development') return 'development'
  if (value === 'production') return 'production'
  if (value === 'test') return 'test'
  return 'unknown'
}

export function buildSystemStatusSnapshot(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SystemStatusSnapshot {
  const byCategory = new Map<SystemStatusCategoryKey, SystemStatusItem[]>()
  for (const definition of SYSTEM_STATUS_VARIABLES) {
    const bucket = byCategory.get(definition.category)
    const item = toItem(definition, env)
    if (bucket) {
      bucket.push(item)
    } else {
      byCategory.set(definition.category, [item])
    }
  }

  const categories: SystemStatusCategory[] = []
  for (const categoryKey of CATEGORY_ORDER) {
    const items = byCategory.get(categoryKey) ?? []
    categories.push(buildCategorySnapshot(categoryKey, items))
  }

  return {
    generatedAt: new Date().toISOString(),
    runtimeMode: resolveRuntimeMode(env),
    categories,
  }
}
