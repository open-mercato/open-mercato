import { createContainer, asClass, asValue, AwilixContainer, InjectionMode } from 'awilix'
import { getOrm } from '@mercato-shared/lib/db/mikro'
import { EntityManager } from '@mikro-orm/postgresql'
import { diRegistrars } from '@/generated/di.generated'
import { AuthService } from '@mercato-core/modules/auth/services/authService'

export type AppContainer = AwilixContainer

export async function createRequestContainer(): Promise<AppContainer> {
  const orm = await getOrm()
  const em = orm.em.fork({ clear: true }) as unknown as EntityManager
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  // Core registrations
  container.register({
    em: asValue(em),
    authService: asClass(AuthService).scoped(),
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
