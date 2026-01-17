import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export function register(container: AppContainer) {
  // CRM module services will be registered in later phases.
  void container
}
