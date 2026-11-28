import { defineProcessDiRegistrar, asScopedService } from '@open-mercato/shared/lib/di/process-registrar'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { asFunction } from 'awilix'
import { createNotificationService } from './lib/notificationService'
import { createNotificationPreferenceService } from './lib/notificationPreferenceService'

export function register(container: AppContainer): void {
  container.register({
    notificationService: asScopedService((container) => (asFunction(({ em, eventBus, commandBus }) =>
      createNotificationService({ em, eventBus, commandBus, container })
    ).scoped().proxy()).resolve(container)),
    // Cross-module/worker seam advertised by AGENTS.md ("DI: notificationPreferenceService").
    // In-module routes resolve via resolveNotificationPreferenceService() (news up from the
    // request-scoped em) since the request container does not expose this binding.
    notificationPreferenceService: asFunction(({ em }) =>
      createNotificationPreferenceService({ em })
    ).scoped().proxy(),
  })
}

defineProcessDiRegistrar(register)
