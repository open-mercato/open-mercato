import { createContainer, asValue, AwilixContainer, InjectionMode } from 'awilix'
import { RequestContext } from '@mikro-orm/core'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { EntityManager } from '@mikro-orm/postgresql'
import * as diGenerated from '@/generated/di.generated'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { commandRegistry, CommandBus } from '@open-mercato/shared/lib/commands'

export type AppContainer = AwilixContainer

const diRegistrars = diGenerated.diRegistrars ?? diGenerated.default ?? []

export async function createRequestContainer(): Promise<AppContainer> {
  const orm = await getOrm()
  // Use a fresh event manager so request-level subscribers (e.g., encryption) don't pile up globally
  const baseEm = (RequestContext.getEntityManager() as any) ?? orm.em
  const em = baseEm.fork({ clear: true, freshEventManager: true, useContext: true }) as unknown as EntityManager
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  // Core registrations
  container.register({
    em: asValue(em),
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
      // Avoid double bootstrap if caller already wired it
      const alreadyBootstrapped = !!container.registrations?.eventBus
      if (!alreadyBootstrapped) {
        await bootstrap(container)
      }
    }
  } catch { /* optional */ }
  // App-level DI override (last chance)
  try {
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
