import { createContainer, asValue, AwilixContainer, InjectionMode } from 'awilix'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { EntityManager } from '@mikro-orm/postgresql'
import { diRegistrars } from '@/generated/di.generated'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'

export type AppContainer = AwilixContainer

export async function createRequestContainer(): Promise<AppContainer> {
  const orm = await getOrm()
  const em = orm.em.fork({ clear: true }) as unknown as EntityManager
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  // Core registrations
  container.register({
    em: asValue(em),
    queryEngine: asValue(new BasicQueryEngine(em)),
    dataEngine: asValue(new DefaultDataEngine(em, container as any)),
  })
  // Allow modules to override/extend
  for (const reg of diRegistrars) {
    try { reg?.(container) } catch {}
  }
  // App-level DI override (last chance)
  try {
    const appDi = await import('@/di') as any
    if (appDi?.register) {
      try { appDi.register(container) } catch {}
    }
  } catch {}
  return container
}
