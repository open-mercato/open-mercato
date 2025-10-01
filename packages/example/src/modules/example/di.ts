import type { AppContainer } from '@/lib/di/container'
import { upsertCustomEntity } from '@open-mercato/core/modules/custom_fields/lib/register'

// Ensure we upsert our virtual entities only once per process
let entitiesRegistered = false

// Example DI registrar; modules can register their own services/components
export function register(container: AppContainer) {
  // container.register({ exampleService: asClass(ExampleService).scoped() })

  if (!entitiesRegistered) {
    entitiesRegistered = true
    ;(async () => {
      try {
        const em = container.resolve('em') as any
        // Register a virtual entity so admins can attach fields to it
        await upsertCustomEntity(em, 'example:calendar_entity', {
          label: 'Calendar Entity',
          description: 'Example virtual entity defined from module DI',
          organizationId: null,
          tenantId: null,
        })
      } catch (e) {
        // Swallow errors to avoid breaking requests; visible in server logs
        console.error('[example.di] upsertCustomEntity failed', e)
      }
    })()
  }
}
