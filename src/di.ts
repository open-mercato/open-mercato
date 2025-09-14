import type { AppContainer } from '@/lib/di/container'
import { bootstrap } from '@mercato-core/bootstrap'

// App-level DI overrides/registrations.
// This runs after core defaults and module DI registrars.
export function register(container: AppContainer) {
  // Call core bootstrap to setup eventBus and auto-register subscribers
  // Feel free to remove or customize this for your app needs
  bootstrap(container)
  // App-level overrides can follow here
}
