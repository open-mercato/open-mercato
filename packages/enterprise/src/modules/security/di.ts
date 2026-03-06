import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { PasswordService } from './services/PasswordService'

export function register(container: AppContainer) {
  container.register({
    passwordService: asClass(PasswordService).scoped(),
  })
}
