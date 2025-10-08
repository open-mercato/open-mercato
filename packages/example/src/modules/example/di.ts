import type { AppContainer } from '@/lib/di/container'

// Example DI registrar; modules can register their own services/components
export function register(container: AppContainer) {
  // container.register({ exampleService: asClass(ExampleService).scoped() })
  
  // Note: Custom entity registration moved to CLI command: yarn mercato example setup-entities
}
