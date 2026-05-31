import type { AppContainer } from '@open-mercato/shared/lib/di/container'

export function register(container: AppContainer) {
  container.register({
    dataQualityTargetRegistry: {
      resolve: () => {
        const { loadTargetRegistry } = require('./lib/targetRegistry') as typeof import('./lib/targetRegistry')
        return loadTargetRegistry()
      },
    },
  })
}
