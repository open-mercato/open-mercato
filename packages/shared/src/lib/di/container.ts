import { createContainer, asValue, AwilixContainer, InjectionMode } from 'awilix'
import { RequestContext } from '@mikro-orm/core'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { commandRegistry, CommandBus } from '@open-mercato/shared/lib/commands'

export type AppContainer = AwilixContainer
export type DiRegistrar = (container: AwilixContainer) => void

// Registration pattern for publishable packages
// Use globalThis to survive tsx/esbuild module duplication issue where the same
// file can be loaded as multiple module instances when mixing dynamic and static imports
const GLOBAL_KEY = '__openMercatoDiRegistrars__'

function getGlobalRegistrars(): DiRegistrar[] | null {
  return (globalThis as any)[GLOBAL_KEY] ?? null
}

function setGlobalRegistrars(registrars: DiRegistrar[]): void {
  (globalThis as any)[GLOBAL_KEY] = registrars
}

export function registerDiRegistrars(registrars: DiRegistrar[]) {
  const existing = getGlobalRegistrars()
  if (existing !== null && process.env.NODE_ENV === 'development') {
    console.debug('[Bootstrap] DI registrars re-registered (this may occur during HMR)')
  }
  setGlobalRegistrars(registrars)
}

export function getDiRegistrars(): DiRegistrar[] {
  const registrars = getGlobalRegistrars()
  if (!registrars) {
    throw new Error('[Bootstrap] DI registrars not registered. Call registerDiRegistrars() at bootstrap.')
  }
  return registrars
}

export async function createRequestContainer(): Promise<AppContainer> {
  const diRegistrars = getDiRegistrars()
  const orm = await getOrm()
  // Use a fresh event manager so request-level subscribers (e.g., encryption) don't pile up globally
  const baseEm = (RequestContext.getEntityManager() as any) ?? orm.em
  const em = baseEm.fork({ clear: true, freshEventManager: true, useContext: true }) as unknown as EntityManager
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  // Pre-register eventBus as null so module DI factories that optionally depend
  // on it (sales, catalog, notifications) can resolve via Awilix CLASSIC mode
  // without crashing if bootstrap() hasn't run yet or fails.
  // bootstrap() overwrites this with the real event bus.
  container.register({
    em: asValue(em),
    eventBus: asValue(null),
    queryEngine: asValue(new BasicQueryEngine(em, undefined, () => {
      try { return container.resolve('tenantEncryptionService') as any } catch { return null }
    })),
    dataEngine: asValue(new DefaultDataEngine(em, container as any)),
    commandRegistry: asValue(commandRegistry),
    commandBus: asValue(new CommandBus()),
  })
  // Allow modules to override/extend
  for (const reg of diRegistrars) {
    try { reg?.(container) } catch {}
  }
  // Core bootstrap (cache, event bus, encryption subscriber/KMS, module subscribers)
  try {
    const { bootstrap } = await import('@open-mercato/core/bootstrap') as any
    if (bootstrap && typeof bootstrap === 'function') {
      // Check if a real (non-null) eventBus is already registered — skip if so
      const existingBus = (() => { try { return container.resolve('eventBus') } catch { return null } })()
      if (!existingBus) {
        await bootstrap(container)
      }
    }
  } catch (err) {
    console.warn('[di] Core bootstrap failed — eventBus and other services may be unavailable:', (err as Error)?.message || err)
  }
  // App-level DI override (last chance)
  // This import path resolves only in the app context, not in packages
  try {
    // @ts-ignore - @/di only exists in app context, not in packages
    const appDi = await import('@/di') as any
    if (appDi?.register) {
      try {
        const maybe = appDi.register(container)
        if (maybe && typeof maybe.then === 'function') await maybe
      } catch {}
    }
  } catch {}
  // Ensure tenant encryption subscriber is always registered on the fresh request-scoped EM
  try {
    const emForEnc = container.resolve('em') as any
    const tenantEncryptionService = container.hasRegistration('tenantEncryptionService')
      ? (container.resolve('tenantEncryptionService') as any)
      : null
    if (emForEnc && tenantEncryptionService?.isEnabled?.()) {
      const { registerTenantEncryptionSubscriber } = await import('@open-mercato/shared/lib/encryption/subscriber')
      registerTenantEncryptionSubscriber(emForEnc, tenantEncryptionService)
    }
  } catch {
    // best-effort; do not block container creation
  }
  return container
}
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('server-only')
} catch {
  // allow CLI/generator usage where Next server-only is not present
}
