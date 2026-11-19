import { asFunction } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY } from '@open-mercato/shared/security/tenantModuleAvailability'
import { createProbeAvailabilityProvider, isProbeEnabled } from './lib/availabilityStore'

export function register(container: AppContainer) {
  if (!isProbeEnabled()) return
  if (container.hasRegistration(TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY)) return
  container.register({
    [TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY]: asFunction(() => createProbeAvailabilityProvider(
      () => (container.hasRegistration('cache') ? container.resolve<CacheStrategy>('cache') : null),
    )).singleton(),
  })
}
