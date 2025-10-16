import type { AppContainer } from '@/lib/di/container'

export function register(container: AppContainer) {
  // CRM module services will be registered in later phases.
  void container
}
