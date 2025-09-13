import type { AppContainer } from '@/lib/di/container'

// App-level DI overrides/registrations.
// This runs after core defaults and module DI registrars.
export function register(container: AppContainer) {
  // Example:
  // container.register({ authService: asClass(CustomAuthService).scoped() })
}

