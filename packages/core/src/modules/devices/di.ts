import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { UserDevice } from './data/entities'

export function register(container: AppContainer) {
  container.register({
    UserDevice: asValue(UserDevice),
  })
}
