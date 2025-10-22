import { asClass } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { VectorSearchService } from './services/vectorSearchService'

export function register(container: AppContainer) {
  container.register({ vectorSearchService: asClass(VectorSearchService).scoped() })
}
