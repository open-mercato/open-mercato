import { asClass, asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { StorageDriverFactory } from './lib/drivers/driverFactory'
import { createAttachmentQuotaService } from './lib/quota-service'
import { scheduleAttachmentQuotaRecovery } from './lib/quota-recovery-queue'
import { LocalAttachmentQuarantineStore } from './lib/quarantine'
import {
  DefaultAttachmentScanGate,
  UnavailableAttachmentScanner,
  resolveAttachmentScanPolicy,
  resolveAttachmentScanTimeoutMs,
  type AttachmentScanner,
} from './lib/scanning'
import type { AttachmentQuarantineStore } from './lib/quarantine'
import { AttachmentEnvironmentPrivacyHandler } from './privacy'

export function register(container: AppContainer) {
  container.register({
    attachmentScanner: asClass(UnavailableAttachmentScanner).singleton(),
    attachmentQuarantineStore: asFunction(() => new LocalAttachmentQuarantineStore()).singleton(),
    attachmentScanGate: asFunction(({
      attachmentScanner,
      attachmentQuarantineStore,
    }: {
      attachmentScanner: AttachmentScanner
      attachmentQuarantineStore: AttachmentQuarantineStore
    }) => new DefaultAttachmentScanGate(
      attachmentScanner,
      attachmentQuarantineStore,
      resolveAttachmentScanPolicy(),
      resolveAttachmentScanTimeoutMs(),
    )).scoped(),
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
    attachmentEnvironmentPrivacyHandler: asClass(AttachmentEnvironmentPrivacyHandler).scoped(),
  })
}
