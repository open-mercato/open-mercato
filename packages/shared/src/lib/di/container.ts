import { asFunction, createContainer, asValue, AwilixContainer, InjectionMode, type Resolver, Lifetime } from 'awilix'
import { RequestContext } from '@mikro-orm/core'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { commandRegistry, CommandBus } from '@open-mercato/shared/lib/commands'
import { applyDiOverridesToContainer, composeDiOverrides } from '@open-mercato/shared/modules/overrides'
import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { getAllOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { createCommandOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isTenantDataEncryptionEnabled } from '../encryption/toggles'
import { createLogger } from '../logger'
import { bindRequestScopeContainer, runWithRequestScopeContainer } from './request-scope'
import { parseBooleanWithDefault } from '../boolean'
import { onModulesRegistered } from '../modules/registry'
import { asScopedService, getProcessDiRegistrar, isProcessDiRegistrar, runCallerSetups, runProcessActivations } from './process-registrar'

const logger = createLogger('shared').child({ component: 'di' })

type DynamicCradle = Record<string, any>

export type AppContainer = AwilixContainer<DynamicCradle>
export type DiRegistrar = (container: AppContainer) => void
export type AppDiRegistrar = (container: AppContainer) => void | Promise<void>

// Registration pattern for publishable packages
// Use globalThis to survive tsx/esbuild module duplication issue where the same
// file can be loaded as multiple module instances when mixing dynamic and static imports
const GLOBAL_KEY = '__openMercatoDiRegistrars__'
const APP_DI_REGISTRAR_KEY = '__openMercatoAppDiRegistrar__'
const APP_DI_LOAD_WARNING_KEY = '__openMercatoAppDiLoadWarningEmitted__'
const APP_DI_REGISTER_WARNING_KEY = '__openMercatoAppDiRegisterWarningEmitted__'
// Set once the legacy `@/di` fallback proves the specifier is unresolvable in this process.
// Worker/CLI processes run against built package output where the app's `@/` alias does not
// exist, so retrying the import per request container only repeats a failed module resolution
// (and its log line) once per job.
const APP_DI_MODULE_UNRESOLVABLE_KEY = '__openMercatoAppDiModuleUnresolvable__'
// Phase 5 — process-scoped bootstrap cache. The cache/event-bus/encryption
// services bootstrap() creates are inherently process-scoped (they hold
// state across requests). Caching them on globalThis after the first
// successful bootstrap call lets every subsequent request skip the
// `await bootstrap(container)` body and just re-register the cached
// instances. Same globalThis pattern as registerDiRegistrars so HMR
// keeps working.
const BOOTSTRAP_CACHE_KEY = '__openMercatoBootstrapCache__'
const ENCRYPTION_ENABLED_KEY = '__openMercatoEncryptionEnabledCache__'

const BOOTSTRAP_CACHE_KEYS = [
  'cache',
  'eventBus',
  'kmsService',
  'tenantEncryptionService',
  'rateLimiterService',
  'searchModuleConfigs',
  'searchIndexer',
] as const

type BootstrapCacheEntry = Partial<Record<(typeof BOOTSTRAP_CACHE_KEYS)[number], unknown>>

// Phase 5 is opt-in. Some bootstrap services close over per-request state
// (e.g. tenantEncryptionService captures the first request's `em.fork`, the
// event-bus's resolver closes over the first container) so naively replaying
// them on later requests yields stale references — observed as a 500 from
// CRUD list endpoints in `next start`. Default OFF preserves develop's
// per-request bootstrap. Set `OM_BOOTSTRAP_CACHE=1` to opt in once each
// cached service is verified safe for cross-request reuse.
function isBootstrapCacheEnabled(): boolean {
  if (isProcessContainerRootEnabled()) return false
  const raw = process.env.OM_BOOTSTRAP_CACHE
  if (raw === undefined) return false
  const normalized = raw.trim().toLowerCase()
  if (!normalized.length) return false
  if (normalized === '0' || normalized === 'off' || normalized === 'false' || normalized === 'no') return false
  return true
}

function getBootstrapCache(): BootstrapCacheEntry | null {
  if (!isBootstrapCacheEnabled()) return null
  const existing = (globalThis as any)[BOOTSTRAP_CACHE_KEY]
  return existing && typeof existing === 'object' ? (existing as BootstrapCacheEntry) : null
}

function setBootstrapCache(entry: BootstrapCacheEntry): void {
  if (!isBootstrapCacheEnabled()) return
  ;(globalThis as any)[BOOTSTRAP_CACHE_KEY] = entry
}

function harvestBootstrapCache(container: AwilixContainer): BootstrapCacheEntry {
  const entry: BootstrapCacheEntry = {}
  for (const key of BOOTSTRAP_CACHE_KEYS) {
    try {
      const value: unknown = container.resolve(key as never)
      if (value !== undefined && value !== null) entry[key] = value
    } catch {
      // not registered — skip
    }
  }
  return entry
}

// Caches the STATIC config toggle only. It deliberately does not consult
// `tenantEncryptionService.isEnabled()`, which ANDs the toggle with the
// volatile `kms.isHealthy()` — memoizing that for the process lifetime pinned a
// transient Vault outage into a permanent "encryption off" verdict, so the
// subscriber was never registered again until a restart (#5948). KMS health is
// re-checked by the subscriber on every read/write instead.
function getCachedEncryptionConfigured(): boolean {
  const cached = (globalThis as Record<string, unknown>)[ENCRYPTION_ENABLED_KEY]
  if (typeof cached === 'boolean') return cached
  const result = isTenantDataEncryptionEnabled()
  ;(globalThis as Record<string, unknown>)[ENCRYPTION_ENABLED_KEY] = result
  return result
}

function getGlobalRegistrars(): DiRegistrar[] | null {
  return (globalThis as any)[GLOBAL_KEY] ?? null
}

function setGlobalRegistrars(registrars: DiRegistrar[]): void {
  (globalThis as any)[GLOBAL_KEY] = registrars
}

export function registerDiRegistrars(registrars: DiRegistrar[]) {
  const existing = getGlobalRegistrars()
  if (existing !== null && process.env.NODE_ENV === 'development') {
    logger.debug('DI registrars re-registered (this may occur during HMR)')
  }
  setGlobalRegistrars(registrars)
  invalidateProcessContainer()
  // Force re-bootstrap on HMR — module subscribers may have changed.
  ;(globalThis as any)[BOOTSTRAP_CACHE_KEY] = null
  ;(globalThis as any)[ENCRYPTION_ENABLED_KEY] = undefined
  // An app that gains a src/di.ts mid-session reloads through here, so the negative
  // resolution result must not outlive the reload.
  ;(globalThis as Record<string, unknown>)[APP_DI_MODULE_UNRESOLVABLE_KEY] = undefined
}

export function getDiRegistrars(): DiRegistrar[] {
  const registrars = getGlobalRegistrars()
  if (!registrars) {
    throw new Error('[Bootstrap] DI registrars not registered. Call registerDiRegistrars() at bootstrap.')
  }
  return registrars
}

function getAppDiRegistrar(): AppDiRegistrar | null {
  const registrar = (globalThis as Record<string, unknown>)[APP_DI_REGISTRAR_KEY]
  return typeof registrar === 'function' ? registrar as AppDiRegistrar : null
}

export function registerAppDiRegistrar(registrar: AppDiRegistrar | null): void {
  ;(globalThis as Record<string, unknown>)[APP_DI_REGISTRAR_KEY] = registrar
  invalidateProcessContainer()
}

/** Test-only helper to drop process-scoped request-container state. */
export function resetBootstrapCache(): void {
  invalidateProcessContainer()
  ;(globalThis as any)[BOOTSTRAP_CACHE_KEY] = null
  ;(globalThis as any)[ENCRYPTION_ENABLED_KEY] = undefined
  ;(globalThis as Record<string, unknown>)[APP_DI_LOAD_WARNING_KEY] = undefined
  ;(globalThis as Record<string, unknown>)[APP_DI_REGISTER_WARNING_KEY] = undefined
  ;(globalThis as Record<string, unknown>)[APP_DI_MODULE_UNRESOLVABLE_KEY] = undefined
}

function isAppDiModuleUnresolvable(): boolean {
  return (globalThis as Record<string, unknown>)[APP_DI_MODULE_UNRESOLVABLE_KEY] === true
}

function markAppDiModuleUnresolvable(): void {
  ;(globalThis as Record<string, unknown>)[APP_DI_MODULE_UNRESOLVABLE_KEY] = true
}

function isAppDiModuleNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  const text = typeof message === 'string' ? message : ''
  const moduleNotFound =
    code === 'MODULE_NOT_FOUND'
    || code === 'ERR_MODULE_NOT_FOUND'
    || text.startsWith('Cannot find module')
    || text.startsWith('Cannot find package')
  return moduleNotFound && /(?:module|package) ['"]@\/di['"]/.test(text)
}

function warnAppDiFailureOnce(
  key: typeof APP_DI_LOAD_WARNING_KEY | typeof APP_DI_REGISTER_WARNING_KEY,
  message: string,
  error: unknown,
): void {
  const globalScope = globalThis as Record<string, unknown>
  if (globalScope[key] === true) return
  globalScope[key] = true
  logger.warn(message, { err: error })
}

function isAwilixResolver(value: unknown): value is Resolver<unknown> {
  return Boolean(value && typeof value === 'object' && typeof (value as { resolve?: unknown }).resolve === 'function')
}

function toAwilixRegistrations(registrations: Record<string, unknown>): Record<string, Resolver<any>> {
  return Object.fromEntries(
    Object.entries(registrations).map(([key, value]) => [
      key,
      isAwilixResolver(value) ? value : asValue(value),
    ]),
  )
}

const PROCESS_ROOT_STATE_KEY = Symbol.for('@open-mercato/shared/di/process-root')

type InitializedProcessRoot = { container: AppContainer; activate: () => void }
type ProcessRootState = {
  generation: number
  pending: Promise<AppContainer | null> | null
  rootInitializations: number
  registrarExecutions: number
  callerScopes: number
  legacyContainers: number
  compatibilityReason: string | null
  overrideEntries: Array<[string, unknown]>
  registryListenerInstalled: boolean
}

type ProcessRootGlobal = typeof globalThis & { [PROCESS_ROOT_STATE_KEY]?: ProcessRootState }

function getProcessRootState(): ProcessRootState {
  const globalState = globalThis as ProcessRootGlobal
  if (!globalState[PROCESS_ROOT_STATE_KEY]) {
    globalState[PROCESS_ROOT_STATE_KEY] = {
      generation: 0,
      pending: null,
      rootInitializations: 0,
      registrarExecutions: 0,
      callerScopes: 0,
      legacyContainers: 0,
      compatibilityReason: null,
      overrideEntries: [],
      registryListenerInstalled: false,
    }
  }
  return globalState[PROCESS_ROOT_STATE_KEY]
}

export function isProcessContainerRootEnabled(): boolean {
  return parseBooleanWithDefault(process.env.OM_PROCESS_CONTAINER_ROOT, false)
}

export function invalidateProcessContainer(): void {
  const state = getProcessRootState()
  state.generation += 1
  state.pending = null
}

export function getProcessContainerStats() {
  const { generation, rootInitializations, registrarExecutions, callerScopes, legacyContainers, compatibilityReason } = getProcessRootState()
  return { generation, rootInitializations, registrarExecutions, callerScopes, legacyContainers, compatibilityReason }
}

function processContainerCompatibilityReason(registrars: DiRegistrar[], appRegistrar: AppDiRegistrar | null): string | null {
  if (!parseBooleanWithDefault(process.env.OM_EVENTS_SHARED_PRODUCER, true)) return 'process event producer sharing is disabled'
  if (!parseBooleanWithDefault(process.env.OM_CACHE_SINGLETON, true)) return 'process cache singleton is disabled'
  if (parseBooleanWithDefault(process.env.SEARCH_DISABLE_SINGLETON_CACHE, false)) return 'process search infrastructure is disabled'
  if (registrars.some((registrar) => !isProcessDiRegistrar(registrar))) return 'an enabled module registrar is not process-safe'
  if (appRegistrar && !isProcessDiRegistrar(appRegistrar)) return 'the app registrar is not process-safe'
  if (!appRegistrar && !isAppDiModuleUnresolvable()) {
    return 'the app registrar has not been explicitly registered'
  }
  const state = getProcessRootState()
  const entries = typeof composeDiOverrides === 'function' ? Object.entries(composeDiOverrides()) : []
  if (entries.length !== state.overrideEntries.length || entries.some(([key, value], index) => {
    const previous = state.overrideEntries[index]
    return previous?.[0] !== key || previous?.[1] !== value
  })) {
    state.overrideEntries = entries
    invalidateProcessContainer()
  }
  return entries.length > 0 ? 'module DI overrides require legacy registration ordering' : null
}

function guardProcessRootRegistrations(root: AppContainer): void {
  const register = root.register.bind(root)
  const wrap = (resolver: Resolver<unknown>): Resolver<unknown> => ({
    ...resolver,
    resolve: (caller) => {
      if (caller === root && resolver.isLeakSafe !== true && resolver.lifetime !== Lifetime.SINGLETON) {
        throw new Error('[internal] Request-scoped services cannot be resolved from the process DI root')
      }
      return resolver.resolve(resolver.lifetime === Lifetime.SINGLETON ? root : caller)
    },
  })
  root.register = ((nameOrRegistrations: string | symbol | Record<string | symbol, Resolver<unknown>>, resolver?: Resolver<unknown>) => {
    if (typeof nameOrRegistrations === 'string' || typeof nameOrRegistrations === 'symbol') {
      if (!resolver) throw new Error('[internal] Missing DI resolver')
      return register(nameOrRegistrations, wrap(resolver))
    }
    return register(Object.fromEntries(Reflect.ownKeys(nameOrRegistrations).map((key) => [key, wrap(nameOrRegistrations[key])])))
  }) as AppContainer['register']
}

function isolateCallerRegistrations(caller: AppContainer): void {
  const register = caller.register.bind(caller)
  const createScope = caller.createScope.bind(caller)
  caller.createScope = (() => {
    const nested = createScope()
    isolateCallerRegistrations(nested)
    return nested
  }) as AppContainer['createScope']
  const local = (name: string | symbol, resolver: Resolver<unknown>): Resolver<unknown> => {
    if (resolver.lifetime !== Lifetime.SINGLETON) return resolver
    return {
      ...resolver,
      lifetime: Lifetime.TRANSIENT,
      resolve: (resolvingScope) => {
        const cached = caller.cache.get(name)
        if (cached) return cached.value
        const value = resolver.resolve(resolvingScope)
        caller.cache.set(name, { resolver, value })
        return value
      },
    }
  }
  caller.register = ((nameOrRegistrations: string | symbol | Record<string | symbol, Resolver<unknown>>, resolver?: Resolver<unknown>) => {
    if (typeof nameOrRegistrations === 'string' || typeof nameOrRegistrations === 'symbol') {
      if (!resolver) throw new Error('[internal] Missing DI resolver')
      return register(nameOrRegistrations, local(nameOrRegistrations, resolver))
    }
    return register(Object.fromEntries(Reflect.ownKeys(nameOrRegistrations).map((key) => [key, local(key, nameOrRegistrations[key])])))
  }) as AppContainer['register']
}

async function buildProcessContainer(
  registrars: DiRegistrar[],
  appRegistrar: AppDiRegistrar | null,
): Promise<InitializedProcessRoot | null> {
  const orm = await getOrm()
  const root = createContainer<DynamicCradle>({ injectionMode: InjectionMode.CLASSIC })
  guardProcessRootRegistrations(root)
  root.register({
    em: asScopedService(() => {
      const baseEm = RequestContext.getEntityManager() ?? orm.em
      return baseEm.fork({ clear: true, freshEventManager: true, useContext: true }) as unknown as EntityManager
    }),
    queryEngine: asScopedService((caller) => new BasicQueryEngine(caller.resolve<EntityManager>('em'), undefined, () => {
      try { return caller.resolve('tenantEncryptionService') } catch { return null }
    })),
    dataEngine: asScopedService((caller) => new DefaultDataEngine(caller.resolve<EntityManager>('em'), caller)),
    commandRegistry: asValue(commandRegistry),
    commandBus: asScopedService(() => new CommandBus()),
    crudMutationGuardService: asScopedService((caller) => createOptimisticLockGuardService({
      getEm: () => caller.resolve<EntityManager>('em'),
      readers: getAllOptimisticLockReaders(),
    })),
    commandOptimisticLockGuardService: asScopedService(() => createCommandOptimisticLockGuardService()),
  })
  try {
    for (const registrar of registrars) {
      const processRegistrar = getProcessDiRegistrar(registrar)
      if (!processRegistrar) throw new Error('[internal] Process DI registrar lost its safety declaration')
      getProcessRootState().registrarExecutions += 1
      await processRegistrar(root)
    }
    if (root.hasRegistration('eventBus')) {
      await root.dispose()
      return null
    }
    const { bootstrapProcessRoot } = await import('@open-mercato/core/bootstrap')
    const activate = await bootstrapProcessRoot(root)
    const generationEventBus = root.registrations.eventBus
    if (appRegistrar) {
      const processRegistrar = getProcessDiRegistrar(appRegistrar)
      if (!processRegistrar) throw new Error('[internal] Process app registrar lost its safety declaration')
      getProcessRootState().registrarExecutions += 1
      await processRegistrar(root)
    }
    if (root.registrations.eventBus !== generationEventBus) {
      await root.dispose()
      return null
    }
    return { container: root, activate }
  } catch (error) {
    await root.dispose()
    throw error
  }
}

export async function initializeProcessContainer(): Promise<AppContainer | null> {
  if (!isProcessContainerRootEnabled()) return null
  const state = getProcessRootState()
  if (!state.registryListenerInstalled) {
    onModulesRegistered(invalidateProcessContainer)
    state.registryListenerInstalled = true
  }
  for (;;) {
    const registrars = getDiRegistrars()
    const appRegistrar = getAppDiRegistrar()
    const reason = processContainerCompatibilityReason(registrars, appRegistrar)
    if (reason) {
      if (state.compatibilityReason !== reason) logger.debug('Process DI root unavailable; using legacy containers', { reason })
      state.compatibilityReason = reason
      return null
    }
    state.compatibilityReason = null
    const generation = state.generation
    if (!state.pending) {
      state.rootInitializations += 1
      const pending = buildProcessContainer(registrars, appRegistrar).then(async (initialized) => {
        if (!initialized) return null
        const { container, activate } = initialized
        if (state.generation !== generation) {
          await container.dispose()
          return container
        }
        try {
          runProcessActivations(container)
          activate()
          return container
        } catch (error) {
          await container.dispose()
          throw error
        }
      })
      state.pending = pending
      void pending.catch(() => {
        if (state.pending === pending) state.pending = null
      })
    }
    try {
      const root = await state.pending
      if (state.generation === generation) {
        state.compatibilityReason = root ? null : 'custom event buses require legacy registration ordering'
        return root
      }
    } catch (error) {
      if (state.generation === generation) throw error
    }
  }
}

export async function createRequestContainer(): Promise<AppContainer> {
  const root = await initializeProcessContainer()
  if (root) {
    const caller = root.createScope()
    isolateCallerRegistrations(caller)
    caller.register({ em: asValue(caller.resolve<EntityManager>('em')) })
    await attachRequestEncryptionSubscriber(caller)
    await runWithRequestScopeContainer(caller, () => runCallerSetups(root, caller))
    getProcessRootState().callerScopes += 1
    bindRequestScopeContainer(caller)
    return caller
  }
  getProcessRootState().legacyContainers += 1
  return buildLegacyRequestContainer()
}

async function buildLegacyRequestContainer(): Promise<AppContainer> {
  const diRegistrars = getDiRegistrars()
  const orm = await getOrm()
  // Use a fresh event manager so request-level subscribers (e.g., encryption) don't pile up globally
  const baseEm = (RequestContext.getEntityManager() as any) ?? orm.em
  const em = baseEm.fork({ clear: true, freshEventManager: true, useContext: true }) as unknown as EntityManager
  const container = createContainer<DynamicCradle>({ injectionMode: InjectionMode.CLASSIC })
  // Core registrations
  container.register({
    em: asValue(em),
    queryEngine: asValue(new BasicQueryEngine(em, undefined, () => {
      try { return container.resolve('tenantEncryptionService') as any } catch { return null }
    })),
    dataEngine: asValue(new DefaultDataEngine(em, container as any)),
    commandRegistry: asValue(commandRegistry),
    commandBus: asValue(new CommandBus()),
    // Default OSS optimistic-lock guard. Reads from the global reader store
    // (populated by `makeCrudRoute` auto-registration + any module-DI
    // hand-wired calls to `registerOptimisticLockReaders`). Service is
    // strictly additive: when `OM_OPTIMISTIC_LOCK=off` (or no header is
    // sent) it short-circuits at validateMutation. Module-level di.ts
    // registrations override this default via Awilix replace semantics —
    // see the enterprise `record_locks` module for the canonical override.
    // Spec: .ai/specs/implemented/2026-05-25-oss-optimistic-locking.md
    // `.proxy()` is load-bearing, not stylistic. The container runs in CLASSIC
    // injection mode, where Awilix resolves dependencies by parsing PARAMETER
    // NAMES out of the function source. A bundler that renames `em` to `em2` —
    // Turbopack does, on a scope collision — makes Awilix look up a registration
    // that does not exist, and `resolveCrudMutationGuardService` swallows the
    // AwilixResolutionError and returns null, so `bridgeLegacyGuard` silently
    // drops the guard and every mutation runs with optimistic locking NOT
    // enforced. Reading `cradle.em` resolves by property name, which survives
    // mangling. Pinned by `di-injection-mode.test.ts`.
    crudMutationGuardService: asFunction((cradle: { em: EntityManager }) =>
      createOptimisticLockGuardService({
        getEm: () => cradle.em,
        readers: getAllOptimisticLockReaders(),
      }),
    ).scoped().proxy(),
    // Default OSS command-level optimistic-lock guard, awaited by
    // `enforceCommandOptimisticLockWithGuards` for Command-pattern writes.
    // Header/explicit-token compare only (no `resolveExpected`), so it is
    // behaviourally identical to calling `enforceCommandOptimisticLock`
    // directly. The enterprise `record_locks` module overrides this DI key
    // with a lock-backed `resolveExpected` via Awilix replace semantics.
    // Spec: .ai/specs/enterprise/2026-06-09-record-locks-unified-coverage.md (Phase 0)
    commandOptimisticLockGuardService: asFunction(() =>
      createCommandOptimisticLockGuardService(),
    ).scoped(),
  })
  // Allow modules to override/extend. Fail-open by design (one broken module's
  // di.ts must not take down every request container), but never silently: the
  // module's services would otherwise vanish with no trace until an unrelated
  // Awilix resolution error surfaces much later.
  for (const [registrarIndex, reg] of diRegistrars.entries()) {
    try {
      if (reg) {
        getProcessRootState().registrarExecutions += 1
        reg(container)
      }
    } catch (error) {
      logger.error('Module DI registrar failed', { registrarIndex, err: error })
    }
  }
  // Core bootstrap (cache, event bus, encryption subscriber/KMS, module subscribers)
  // Phase 5 — process-scoped once-guard. The first request runs the full
  // bootstrap() body; later requests re-register the cached services
  // directly on this request's container without re-importing or
  // re-initializing anything. HMR clears the cache (see
  // registerDiRegistrars). Skippable if a caller already wired eventBus.
  const alreadyBootstrappedOnThisContainer = !!container.registrations?.eventBus
  if (!alreadyBootstrappedOnThisContainer) {
    const cached = getBootstrapCache()
    if (cached) {
      const replay: Record<string, any> = {}
      for (const [key, value] of Object.entries(cached)) {
        if (value !== undefined && value !== null) replay[key] = asValue(value)
      }
      if (Object.keys(replay).length > 0) container.register(replay)
    } else {
      try {
        const { bootstrap } = await import('@open-mercato/core/bootstrap') as any
        if (bootstrap && typeof bootstrap === 'function') {
          await bootstrap(container)
          setBootstrapCache(harvestBootstrapCache(container))
        }
      } catch { /* optional */ }
    }
  }
  // App-level DI override. Scaffolded apps register this callback explicitly
  // from their own bootstrap module so app aliases resolve in app context.
  const appDiRegistrar = getAppDiRegistrar()
  if (appDiRegistrar) {
    try {
      getProcessRootState().registrarExecutions += 1
      await appDiRegistrar(container)
    } catch (error) {
      logger.error('App-level DI registrar failed', { err: error })
    }
  } else if (!isAppDiModuleUnresolvable()) {
    // Backward-compatible fallback for apps that have not adopted explicit wiring.
    try {
      // @ts-ignore - @/di only exists in app context, not in packages
      const appDi = await import('@/di') as any
      if (appDi?.register) {
        try {
          getProcessRootState().registrarExecutions += 1
          const maybe = appDi.register(container)
          if (maybe && typeof maybe.then === 'function') await maybe
        } catch (err) {
          warnAppDiFailureOnce(
            APP_DI_REGISTER_WARNING_KEY,
            'App-level DI override (src/di.ts register()) threw; its registrations are skipped',
            err,
          )
        }
      }
    } catch (err) {
      if (isAppDiModuleNotFound(err)) {
        markAppDiModuleUnresolvable()
        logger.debug('App-level DI override module (@/di) not resolvable; skipping', { err })
      } else {
        warnAppDiFailureOnce(
          APP_DI_LOAD_WARNING_KEY,
          'App-level DI override module (@/di) failed to load; its registrations are skipped',
          err,
        )
      }
    }
  }
  applyDiOverridesToContainer({
    register: (registrations) => container.register(toAwilixRegistrations(registrations)),
    unregister: (key) => container.register({ [key]: asValue(undefined) }),
  })
  await attachRequestEncryptionSubscriber(container)
  bindRequestScopeContainer(container)
  return container
}
async function attachRequestEncryptionSubscriber(container: AppContainer): Promise<void> {
  // Ensure tenant encryption subscriber is always registered on the fresh request-scoped EM
  // Phase 5 — cache the tenant-encryption config toggle for the process
  // lifetime. That toggle does not change at runtime, so reading it once skips
  // a config lookup per request; KMS health is NOT part of this decision.
  try {
    const emForEnc = container.resolve('em') as any
    const tenantEncryptionService = container.hasRegistration('tenantEncryptionService')
      ? (container.resolve('tenantEncryptionService') as any)
      : null
    // The subscriber calls `service.isEnabled()` on every read/write, so a DI
    // override supplying a service without it would throw per operation. Keep
    // the shape check that the old health-probe helper performed.
    const serviceCanReportEnabled = typeof tenantEncryptionService?.isEnabled === 'function'
    if (emForEnc && serviceCanReportEnabled && getCachedEncryptionConfigured()) {
      const { registerTenantEncryptionSubscriber } = await import('@open-mercato/shared/lib/encryption/subscriber')
      registerTenantEncryptionSubscriber(emForEnc, tenantEncryptionService)
    }
  } catch {
    // best-effort; do not block container creation
  }
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('server-only')
} catch {
  // allow CLI/generator usage where Next server-only is not present
}
