import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { loadTargetRegistry } from './lib/targetRegistry'

export function register(container: AppContainer) {
  container.register({
    dataQualityTargetRegistry: {
      resolve: () => loadTargetRegistry(),
    },
  })
}
