import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { StorageDriverFactory } from './lib/drivers/driverFactory'
import { createAttachmentQuotaService } from './lib/quota-service'
import { scheduleAttachmentQuotaRecovery } from './lib/quota-recovery-queue'

export function register(container: AppContainer) {
  container.register({
    attachmentQuotaRecoveryScheduler: asValue(scheduleAttachmentQuotaRecovery),
    attachmentQuotaService: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      createAttachmentQuotaService(em),
    )
      .scoped()
      .proxy(),
    storageDriverFactory: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      new StorageDriverFactory(em),
    )
      .singleton()
      .proxy(),
  })
}
