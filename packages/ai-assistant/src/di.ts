import type { AwilixContainer } from 'awilix'

/**
 * Register AI Assistant module services in the DI container.
 *
 * This is called by the app bootstrap to register package-level services.
 */
export async function register(container: AwilixContainer): Promise<void> {
  const { register: registerModule } = await import('./modules/ai_assistant/di')
  registerModule(container)
}
