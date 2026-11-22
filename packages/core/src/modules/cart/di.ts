import { defineProcessDiRegistrar, asScopedService } from '@open-mercato/shared/lib/di/process-registrar'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CartServiceImpl } from './lib/cartService'

export function register(container: AppContainer): void {
  container.register({
    cartService: asScopedService((scope) => new CartServiceImpl(scope)),
  })
}

export default { register }

defineProcessDiRegistrar(register)
