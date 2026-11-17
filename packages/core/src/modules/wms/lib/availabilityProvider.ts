/**
 * `wms`'s `AvailabilityProvider` registration (`id: 'wms'`).
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §3.1, §4.2
 *
 * The shared registry is process-wide, while `wms/di.ts`'s `register()` runs
 * once per `createRequestContainer()` call. The provider therefore captures
 * no container: every `getAvailability()` call resolves `em`, the cache and
 * the policy service from the calling request's container
 * (`context.container`), or builds a fresh request container when the caller
 * passed none. A request can never reach another request's container.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  AvailabilityDependencyResolver,
  AvailabilityProvider,
  AvailabilityProviderContext,
  AvailabilityQuery,
  AvailabilityResult,
} from '@open-mercato/shared/lib/availability'
import { computeAvailabilityCached } from './availabilityCache'

export const WMS_AVAILABILITY_PROVIDER_ID = 'wms'

export type WmsAvailabilityProviderOptions = {
  createContainer?: () => Promise<AvailabilityDependencyResolver>
}

async function createDefaultContainer(): Promise<AvailabilityDependencyResolver> {
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  return createRequestContainer()
}

export function createWmsAvailabilityProvider(options: WmsAvailabilityProviderOptions = {}): AvailabilityProvider {
  const createContainer = options.createContainer ?? createDefaultContainer
  return {
    id: WMS_AVAILABILITY_PROVIDER_ID,
    async getAvailability(query: AvailabilityQuery, context?: AvailabilityProviderContext): Promise<AvailabilityResult> {
      const container = context?.container ?? (await createContainer())
      const em = container.resolve<EntityManager>('em').fork()
      return computeAvailabilityCached(em, container, query)
    },
  }
}

export const wmsAvailabilityProvider: AvailabilityProvider = createWmsAvailabilityProvider()
