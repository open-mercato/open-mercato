import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DEFAULT_DOCUMENT_GENERATORS_CONFIG, DOCUMENT_GENERATORS_CONFIG_KEY } from './lib/module-config'

export function register(container: AppContainer): void {
  container.register({
    [DOCUMENT_GENERATORS_CONFIG_KEY]: { resolve: () => DEFAULT_DOCUMENT_GENERATORS_CONFIG },
  })
}
