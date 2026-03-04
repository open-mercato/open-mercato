import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createGatewayTransactionService } from './lib/gateway-transaction-service'

export function register(container: AppContainer): void {
  container.register({
    gatewayTransactionService: asFunction(({ em }) => createGatewayTransactionService(em)).scoped(),
  })
}
