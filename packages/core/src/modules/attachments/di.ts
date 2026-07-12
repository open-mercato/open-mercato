import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { StorageDriverFactory } from './lib/drivers/driverFactory'
import { DefaultAttachmentService } from './lib/attachment-service'

export function register(container: AppContainer) {
  container.register({
    storageDriverFactory: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      new StorageDriverFactory(em),
    )
      .singleton()
      .proxy(),
    attachmentService: asFunction(({
      em,
      storageDriverFactory,
    }: {
      em: ConstructorParameters<typeof DefaultAttachmentService>[0]
      storageDriverFactory: ConstructorParameters<typeof DefaultAttachmentService>[1]
    }) => new DefaultAttachmentService(em, storageDriverFactory))
      .scoped()
      .proxy(),
  })
}
