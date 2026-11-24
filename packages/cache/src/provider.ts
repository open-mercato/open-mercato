import type { CacheStrategy } from './types'
import type { CacheCodecOptions } from './codec'
import { decodeCacheText, encodeCacheText, resolveCacheCodecConfig } from './codec'
import { matchCacheKeyPattern } from './patterns'

export const CACHE_PROVIDER_API_VERSION = 1

export type CacheProviderPlacement = 'local' | 'shared'

export type CacheProviderSettingsIssue = {
  path: ReadonlyArray<PropertyKey>
  message: string
  code?: string
}

export type CacheProviderSettingsParseResult<TConfig> =
  | { success: true; data: TConfig }
  | { success: false; error: { issues: ReadonlyArray<CacheProviderSettingsIssue> } }

export type CacheProviderSettingsSchema<TConfig> = {
  safeParse(input: unknown): CacheProviderSettingsParseResult<TConfig>
}

export type CacheProviderLogMeta = Record<string, unknown>

export type CacheProviderLogger = {
  warn(message: string, meta?: CacheProviderLogMeta): void
  error(message: string, meta?: CacheProviderLogMeta): void
}

export type CacheProviderHelpers = {
  encode(json: string): string | Buffer
  /**
   * Throws on a corrupt or truncated frame. Providers MUST catch the error,
   * treat the record as a miss and may delete it; never surface it to callers.
   */
  decode(raw: string | Buffer): string
  matchPattern(key: string, pattern: string): boolean
}

export type CacheProviderHostContext = {
  namespace: string
  defaultTtl?: number
  codec: CacheCodecOptions
  helpers: CacheProviderHelpers
  logger: CacheProviderLogger
}

export type CacheProviderCapability = {
  placement: CacheProviderPlacement
}

export type CacheProviderDefinition<TConfig> = {
  apiVersion: typeof CACHE_PROVIDER_API_VERSION
  id: string
  settings: CacheProviderSettingsSchema<TConfig>
  capability(config: TConfig): CacheProviderCapability
  /**
   * Returns a base strategy over already tenant-scoped physical keys. The host
   * wrapper stores two records per logical entry (value + metadata, both with
   * the same tags), so `deleteByTags`, `cleanup` and `clear` MUST count each
   * removed physical record; the host halves the total into logical entries.
   */
  create(config: TConfig, context: CacheProviderHostContext): CacheStrategy | Promise<CacheStrategy>
  redact?(config: TConfig): Record<string, unknown>
}

export type CacheProviderRegistration = {
  id: string
  load: () => Promise<CacheProviderDefinition<unknown>>
  settings: () => unknown
}

export type ResolvedCacheProvider<TConfig = unknown> = {
  id: string
  definition: CacheProviderDefinition<TConfig>
  config: TConfig
  placement: CacheProviderPlacement
  namespace: string
}

export type CacheProviderEnv = Record<string, string | undefined>

export type ResolveCacheProviderOptions = {
  env?: CacheProviderEnv
  selectedId?: string | null
}

export type CacheProviderErrorCode =
  | 'invalid_registration'
  | 'duplicate_id'
  | 'reserved_id'
  | 'not_registered'
  | 'load_failed'
  | 'id_mismatch'
  | 'unsupported_api_version'
  | 'invalid_settings'
  | 'missing_namespace'
  | 'invalid_namespace'
  | 'conflicting_selection'
  | 'unavailable'
  | 'timeout'
  | 'not_resolved'

export type CacheProviderErrorOptions = {
  providerId?: string
  fieldPaths?: string[]
  cause?: unknown
}

export class CacheProviderError extends Error {
  public readonly code: CacheProviderErrorCode
  public readonly providerId?: string
  public readonly fieldPaths?: string[]
  declare public readonly originalError?: unknown

  constructor(code: CacheProviderErrorCode, message: string, options: CacheProviderErrorOptions = {}) {
    super(message)
    this.name = 'CacheProviderError'
    this.code = code
    if (options.providerId !== undefined) this.providerId = options.providerId
    if (options.fieldPaths !== undefined) this.fieldPaths = [...options.fieldPaths]
    Object.defineProperty(this, 'originalError', {
      value: options.cause,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }

  toJSON(): { name: string; code: CacheProviderErrorCode; message: string; providerId?: string; fieldPaths?: string[] } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.providerId !== undefined ? { providerId: this.providerId } : {}),
      ...(this.fieldPaths !== undefined ? { fieldPaths: [...this.fieldPaths] } : {}),
    }
  }
}

export function isCacheProviderError(error: unknown): error is CacheProviderError {
  return error instanceof CacheProviderError
    || (error instanceof Error && error.name === 'CacheProviderError' && typeof (error as { code?: unknown }).code === 'string')
}

const CACHE_PROVIDER_ERROR_CODES: ReadonlySet<string> = new Set<CacheProviderErrorCode>([
  'invalid_registration',
  'duplicate_id',
  'reserved_id',
  'not_registered',
  'load_failed',
  'id_mismatch',
  'unsupported_api_version',
  'invalid_settings',
  'missing_namespace',
  'invalid_namespace',
  'conflicting_selection',
  'unavailable',
  'timeout',
  'not_resolved',
])

/**
 * Pass a real `CacheProviderError` from this module through unchanged; wrap any
 * other error (including one that only looks like a `CacheProviderError`) into a
 * host-authored error so provider-controlled messages never reach callers or logs.
 * A look-alike keeps its `code` when it is a known code; everything else becomes
 * `unavailable`. The original error stays reachable only as a non-enumerable cause.
 */
export function toSanitizedCacheProviderError(
  error: unknown,
  fallback: { message: string; providerId?: string },
): CacheProviderError {
  if (error instanceof CacheProviderError) return error
  const lookalikeCode = isCacheProviderError(error) ? (error as { code: string }).code : null
  const code: CacheProviderErrorCode = lookalikeCode !== null && CACHE_PROVIDER_ERROR_CODES.has(lookalikeCode)
    ? lookalikeCode as CacheProviderErrorCode
    : 'unavailable'
  return new CacheProviderError(code, fallback.message, {
    ...(fallback.providerId !== undefined ? { providerId: fallback.providerId } : {}),
    cause: error,
  })
}

export const CACHE_PROVIDER_ENV = 'CACHE_PROVIDER'
export const CACHE_PROVIDER_NAMESPACE_ENV = 'CACHE_PROVIDER_NAMESPACE'
export const RESERVED_CACHE_PROVIDER_IDS: ReadonlyArray<string> = ['memory', 'redis', 'sqlite', 'jsonfile']

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/
const NAMESPACE_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/
const SENSITIVE_META_KEY_PATTERN = /(pass|secret|token|key|credential|auth|cookie|session|dsn|url|uri|endpoint|cert)/i

export function defineCacheProvider<TConfig>(
  definition: Omit<CacheProviderDefinition<TConfig>, 'apiVersion'>,
): CacheProviderDefinition<TConfig> {
  return { ...definition, apiVersion: CACHE_PROVIDER_API_VERSION }
}

export function defineCacheProviderRegistration<TConfig>(registration: {
  id: string
  load: () => Promise<CacheProviderDefinition<TConfig>>
  settings: () => unknown
}): CacheProviderRegistration {
  return {
    id: registration.id,
    load: registration.load as () => Promise<CacheProviderDefinition<unknown>>,
    settings: registration.settings,
  }
}

export function readSelectedCacheProviderId(env: CacheProviderEnv = process.env): string | null {
  const raw = env[CACHE_PROVIDER_ENV]
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value.length > 0 ? value : null
}

function describeId(id: unknown): string {
  return typeof id === 'string' && PROVIDER_ID_PATTERN.test(id) ? id : '<invalid>'
}

function isReservedProviderId(id: string): boolean {
  return RESERVED_CACHE_PROVIDER_IDS.includes(id) || !id.includes('/')
}

function assertProviderIdSyntax(id: unknown, subject: string): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new CacheProviderError('invalid_registration', `${subject} must declare a non-empty provider id`)
  }
  if (isReservedProviderId(id)) {
    throw new CacheProviderError(
      'reserved_id',
      `${subject} uses a reserved cache provider id; provider ids must be namespaced as "<scope>/<name>" and must not be a built-in strategy name`,
    )
  }
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new CacheProviderError(
      'invalid_registration',
      `${subject} uses an invalid cache provider id; expected "<scope>/<name>" with lowercase letters, digits, ".", "_" or "-"`,
    )
  }
}

export function validateCacheProviderRegistrations(registrations: ReadonlyArray<CacheProviderRegistration>): void {
  if (!Array.isArray(registrations)) {
    throw new CacheProviderError('invalid_registration', 'Cache provider registrations must be an array')
  }
  const seen = new Set<string>()
  registrations.forEach((registration, index) => {
    const subject = `Cache provider registration #${index}`
    if (typeof registration !== 'object' || registration === null) {
      throw new CacheProviderError('invalid_registration', `${subject} must be an object`)
    }
    assertProviderIdSyntax(registration.id, subject)
    if (typeof registration.load !== 'function') {
      throw new CacheProviderError('invalid_registration', `Cache provider "${registration.id}" registration must declare a load() function`, { providerId: registration.id })
    }
    if (typeof registration.settings !== 'function') {
      throw new CacheProviderError('invalid_registration', `Cache provider "${registration.id}" registration must declare a settings() function`, { providerId: registration.id })
    }
    if (seen.has(registration.id)) {
      throw new CacheProviderError('duplicate_id', `Cache provider "${registration.id}" is registered more than once`, { providerId: registration.id })
    }
    seen.add(registration.id)
  })
}

function formatFieldPath(path: ReadonlyArray<PropertyKey>): string {
  if (!Array.isArray(path) || path.length === 0) return '(root)'
  return path
    .map((segment) => (typeof segment === 'symbol' ? segment.description ?? 'symbol' : String(segment)))
    .join('.')
}

function collectFieldPaths(issues: unknown): string[] {
  if (!Array.isArray(issues)) return ['(root)']
  const paths = new Set<string>()
  for (const issue of issues) {
    const path = typeof issue === 'object' && issue !== null ? (issue as { path?: unknown }).path : undefined
    paths.add(formatFieldPath(Array.isArray(path) ? path : []))
  }
  return paths.size > 0 ? Array.from(paths) : ['(root)']
}

function assertDefinitionShape(definition: unknown, id: string): asserts definition is CacheProviderDefinition<unknown> {
  if (typeof definition !== 'object' || definition === null) {
    throw new CacheProviderError('invalid_registration', `Cache provider "${id}" load() did not return a provider definition`, { providerId: id })
  }
  const candidate = definition as Record<string, unknown>
  if (candidate.apiVersion !== CACHE_PROVIDER_API_VERSION) {
    throw new CacheProviderError(
      'unsupported_api_version',
      `Cache provider "${id}" targets an unsupported provider API version; this host supports version ${CACHE_PROVIDER_API_VERSION}`,
      { providerId: id },
    )
  }
  if (candidate.id !== id) {
    throw new CacheProviderError(
      'id_mismatch',
      `Cache provider registration "${id}" loaded a definition declaring id "${describeId(candidate.id)}"`,
      { providerId: id },
    )
  }
  const settings = candidate.settings as { safeParse?: unknown } | undefined
  if (typeof settings !== 'object' || settings === null || typeof settings.safeParse !== 'function') {
    throw new CacheProviderError('invalid_registration', `Cache provider "${id}" must declare a settings schema with safeParse()`, { providerId: id })
  }
  if (typeof candidate.capability !== 'function' || typeof candidate.create !== 'function') {
    throw new CacheProviderError('invalid_registration', `Cache provider "${id}" must declare capability() and create()`, { providerId: id })
  }
  if (candidate.redact !== undefined && typeof candidate.redact !== 'function') {
    throw new CacheProviderError('invalid_registration', `Cache provider "${id}" redact must be a function when declared`, { providerId: id })
  }
}

function resolveNamespace(env: CacheProviderEnv, id: string): string {
  const raw = env[CACHE_PROVIDER_NAMESPACE_ENV]
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) {
    throw new CacheProviderError(
      'missing_namespace',
      `Cache provider "${id}" requires ${CACHE_PROVIDER_NAMESPACE_ENV} to be set to a stable deployment namespace`,
      { providerId: id },
    )
  }
  return validateCacheProviderNamespace(value, id)
}

export function validateCacheProviderNamespace(namespace: unknown, providerId?: string): string {
  if (typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)) {
    throw new CacheProviderError(
      'invalid_namespace',
      `Cache provider namespace must be 1-64 characters of letters, digits, ".", "_" or "-"`,
      providerId !== undefined ? { providerId } : {},
    )
  }
  return namespace
}

export async function resolveCacheProvider(
  registrations: ReadonlyArray<CacheProviderRegistration>,
  options: ResolveCacheProviderOptions = {},
): Promise<ResolvedCacheProvider | null> {
  validateCacheProviderRegistrations(registrations)
  const env = options.env ?? process.env
  const explicit = typeof options.selectedId === 'string' ? options.selectedId.trim() : ''
  const selectedId = explicit.length > 0 ? explicit : readSelectedCacheProviderId(env)
  if (!selectedId) return null

  if (isReservedProviderId(selectedId)) {
    throw new CacheProviderError(
      'reserved_id',
      `${CACHE_PROVIDER_ENV} must name a registered "<scope>/<name>" provider; built-in strategies are selected with CACHE_STRATEGY`,
    )
  }

  const registration = registrations.find((entry) => entry.id === selectedId)
  if (!registration) {
    throw new CacheProviderError(
      'not_registered',
      `Cache provider "${describeId(selectedId)}" is selected but not registered by the application`,
      PROVIDER_ID_PATTERN.test(selectedId) ? { providerId: selectedId } : {},
    )
  }
  const id = registration.id

  let definition: unknown
  try {
    definition = await registration.load()
  } catch (error) {
    throw new CacheProviderError('load_failed', `Cache provider "${id}" failed to load`, { providerId: id, cause: error })
  }
  assertDefinitionShape(definition, id)

  let rawSettings: unknown
  try {
    rawSettings = registration.settings()
  } catch (error) {
    throw new CacheProviderError('invalid_settings', `Cache provider "${id}" settings could not be evaluated`, { providerId: id, cause: error })
  }

  let parsed: CacheProviderSettingsParseResult<unknown>
  try {
    parsed = definition.settings.safeParse(rawSettings)
  } catch (error) {
    throw new CacheProviderError('invalid_settings', `Cache provider "${id}" settings could not be validated`, { providerId: id, cause: error })
  }
  if (!parsed || typeof parsed !== 'object' || parsed.success !== true) {
    const issues = parsed && typeof parsed === 'object' && parsed.success === false ? parsed.error?.issues : undefined
    const fieldPaths = collectFieldPaths(issues)
    throw new CacheProviderError(
      'invalid_settings',
      `Cache provider "${id}" settings are invalid at: ${fieldPaths.join(', ')}`,
      { providerId: id, fieldPaths },
    )
  }
  const config = parsed.data

  const namespace = resolveNamespace(env, id)

  let capability: CacheProviderCapability
  try {
    capability = definition.capability(config)
  } catch (error) {
    throw new CacheProviderError('invalid_registration', `Cache provider "${id}" capability() failed`, { providerId: id, cause: error })
  }
  const placement = capability && typeof capability === 'object' ? capability.placement : undefined
  if (placement !== 'local' && placement !== 'shared') {
    throw new CacheProviderError('invalid_registration', `Cache provider "${id}" capability() must report placement "local" or "shared"`, { providerId: id })
  }

  return { id, definition, config, placement, namespace }
}

function sanitizeLogMeta(meta: CacheProviderLogMeta | undefined): CacheProviderLogMeta | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const sanitized: CacheProviderLogMeta = {}
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_META_KEY_PATTERN.test(key)) {
      sanitized[key] = '[redacted]'
    } else if (value instanceof Error) {
      sanitized[key] = { name: value.name }
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
    } else if (typeof value === 'string') {
      sanitized[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value
    } else {
      sanitized[key] = '[omitted]'
    }
  }
  return sanitized
}

export function createCacheProviderLogger(providerId: string): CacheProviderLogger {
  const prefix = `[cache] provider ${describeId(providerId)}:`
  return {
    warn(message, meta) {
      const safe = sanitizeLogMeta(meta)
      if (safe) console.warn(`${prefix} ${message}`, safe)
      else console.warn(`${prefix} ${message}`)
    },
    error(message, meta) {
      const safe = sanitizeLogMeta(meta)
      if (safe) console.error(`${prefix} ${message}`, safe)
      else console.error(`${prefix} ${message}`)
    },
  }
}

export function createCacheProviderHostContext(
  provider: Pick<ResolvedCacheProvider, 'id' | 'namespace'>,
  options: { defaultTtl?: number; codec?: CacheCodecOptions } = {},
): CacheProviderHostContext {
  const codec: CacheCodecOptions = { ...(options.codec ?? {}) }
  const codecConfig = resolveCacheCodecConfig(codec)
  return {
    namespace: validateCacheProviderNamespace(provider.namespace, provider.id),
    ...(options.defaultTtl !== undefined ? { defaultTtl: options.defaultTtl } : {}),
    codec,
    helpers: {
      encode: (json) => encodeCacheText(json, codecConfig),
      decode: (raw) => decodeCacheText(raw),
      matchPattern: (key, pattern) => matchCacheKeyPattern(key, pattern),
    },
    logger: createCacheProviderLogger(provider.id),
  }
}

const SELECTION_STATE_KEY = Symbol.for('@open-mercato/cache/provider-selection')

type CacheProviderSelectionState = {
  registrations: ReadonlyArray<CacheProviderRegistration>
  pending: Promise<ResolvedCacheProvider | null> | null
  settled: { selectedId: string | null; provider: ResolvedCacheProvider | null } | null
  failure: CacheProviderError | null
}

type GlobalWithSelectionState = typeof globalThis & {
  [SELECTION_STATE_KEY]?: CacheProviderSelectionState
}

function createSelectionState(): CacheProviderSelectionState {
  return { registrations: [], pending: null, settled: null, failure: null }
}

function selectionState(): CacheProviderSelectionState {
  const scope = globalThis as GlobalWithSelectionState
  if (!scope[SELECTION_STATE_KEY]) {
    scope[SELECTION_STATE_KEY] = createSelectionState()
  }
  return scope[SELECTION_STATE_KEY]
}

export function setCacheProviderRegistrations(registrations: ReadonlyArray<CacheProviderRegistration>): void {
  selectionState().registrations = Array.isArray(registrations) ? [...registrations] : registrations
}

export function getCacheProviderRegistrations(): ReadonlyArray<CacheProviderRegistration> {
  return selectionState().registrations
}

export function prepareCacheProviderSelection(options: { env?: CacheProviderEnv } = {}): Promise<ResolvedCacheProvider | null> {
  const state = selectionState()
  if (state.pending) return state.pending
  const env = options.env ?? process.env
  const selectedId = readSelectedCacheProviderId(env)
  state.pending = resolveCacheProvider(state.registrations, { env }).then(
    (provider) => {
      state.settled = { selectedId, provider }
      return provider
    },
    (error: unknown) => {
      const failure = toSanitizedCacheProviderError(error, { message: 'Cache provider selection failed' })
      state.failure = failure
      throw failure
    },
  )
  return state.pending
}

export function getPreparedCacheProvider(env: CacheProviderEnv = process.env): ResolvedCacheProvider | null {
  const selectedId = readSelectedCacheProviderId(env)
  if (!selectedId) return null
  const state = selectionState()
  if (state.failure) throw state.failure
  if (state.settled && state.settled.selectedId === selectedId && state.settled.provider) {
    return state.settled.provider
  }
  throw new CacheProviderError(
    'not_resolved',
    `${CACHE_PROVIDER_ENV} is set but the cache provider selection has not been prepared; call prepareCacheProviderSelection() during bootstrap before creating the cache service`,
    PROVIDER_ID_PATTERN.test(selectedId) ? { providerId: selectedId } : {},
  )
}

export function resetCacheProviderSelectionForTests(): void {
  const scope = globalThis as GlobalWithSelectionState
  scope[SELECTION_STATE_KEY] = createSelectionState()
}
