import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { PushNotificationDelivery } from './data/entities'
import { ensurePushStubAdapterRegistered } from './lib/push-stub-adapter'
import { pushNotificationService } from './lib/send-custom-push'

export function register(container: AppContainer) {
  // Test-only: register the network-free `push_stub` channel adapter when
  // `OM_ENABLE_PUSH_STUB_ADAPTER` is set (no-op in production). Lets the integration harness drive
  // the strategy → delivery-row → worker → sendMessage chain without a real provider. Mirrors the
  // communication_channels test-seed adapter registration. See lib/push-stub-adapter.ts.
  ensurePushStubAdapterRegistered()

  container.register({
    PushNotificationDelivery: asValue(PushNotificationDelivery),
    // Stateless service backing the admin custom-send push (decoupled via DI). The caller passes
    // its own scoped `resolve` in the call args.
    pushNotificationService: asValue(pushNotificationService),
  })
}
