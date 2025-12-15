import { createContainer, asValue, AwilixContainer, InjectionMode } from 'awilix'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { EntityManager } from '@mikro-orm/postgresql'
import * as diGenerated from '@/generated/di.generated'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { commandRegistry, CommandBus } from '@open-mercato/shared/lib/commands'

export type AppContainer = AwilixContainer

const diRegistrars = diGenerated.diRegistrars ?? diGenerated.default?.diRegistrars ?? []

export async function createRequestContainer(): Promise<AppContainer> {
  const orm = await getOrm()
  const em = orm.em.fork({ clear: true }) as unknown as EntityManager
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  // Core registrations
  container.register({
    em: asValue(em),
    queryEngine: asValue(new BasicQueryEngine(em)),
    dataEngine: asValue(new DefaultDataEngine(em, container as any)),
    commandRegistry: asValue(commandRegistry),
    commandBus: asValue(new CommandBus()),
  })
  // Allow modules to override/extend
  for (const reg of diRegistrars) {
    try { reg?.(container) } catch {}
  }
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
  return container
}
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('server-only')
} catch {
  // allow CLI/generator usage where Next server-only is not present
}
