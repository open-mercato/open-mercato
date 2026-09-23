/**
 * `wms`'s `AvailabilityProvider` registration (`id: 'wms'`).
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §3.1, §4.2
 *
 * Registered from `wms/di.ts`'s `register(container)`, which — like every
 * module DI registrar — runs once per `createRequestContainer()` call
 * (`packages/shared/src/lib/di/container.ts`), not once at process boot.
 * `availabilityProviderRegistry.register()` is idempotent replace-by-id, so
 * each request's registration simply re-points the shared registry entry at
 * a closure over that request's own container — the same pattern this
 * module already uses for its plain entity-class registrations in `di.ts`.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AvailabilityProvider, AvailabilityQuery, AvailabilityResult } from '@open-mercato/shared/lib/availability'
import { computeAvailabilityCached } from './availabilityCache'

type Resolver = { resolve: <T = unknown>(name: string) => T }

export function createWmsAvailabilityProvider(container: Resolver): AvailabilityProvider {
  return {
    id: 'wms',
    async getAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
      const em = (container.resolve('em') as EntityManager).fork()
      return computeAvailabilityCached(em, container, query)
    },
  }
}
