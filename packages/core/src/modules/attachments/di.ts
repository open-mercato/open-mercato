import { asClass, asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { StorageDriverFactory } from './lib/drivers/driverFactory'
import { DefaultAttachmentService } from './lib/attachment-service'
import { createAttachmentQuotaService, type AttachmentQuotaService } from './lib/quota-service'
import { scheduleAttachmentQuotaRecovery } from './lib/quota-recovery-queue'
import { AttachmentTargetAccessService } from './lib/target-access-service'
import { ScopedAttachmentUploadService } from './lib/scoped-upload-service'
import { LocalAttachmentQuarantineStore } from './lib/quarantine'
import {
  DefaultAttachmentScanGate,
  UnavailableAttachmentScanner,
  resolveAttachmentScanPolicy,
  resolveAttachmentScanTimeoutMs,
  type AttachmentScanGate,
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
    ))
      .scoped()
      .proxy(),
    attachmentQuotaRecoveryScheduler: asValue(scheduleAttachmentQuotaRecovery),
    attachmentQuotaService: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      createAttachmentQuotaService(em),
    )
      .scoped()
      .proxy(),
    attachmentTargetAccessService: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      new AttachmentTargetAccessService(em),
    )
      .scoped()
      .proxy(),
    attachmentScopedUploadService: asFunction(({
      em,
      dataEngine,
      storageDriverFactory,
      attachmentQuotaService,
      attachmentQuotaRecoveryScheduler,
      attachmentScanGate,
    }: {
      em: ConstructorParameters<typeof StorageDriverFactory>[0]
      dataEngine: DataEngine
      storageDriverFactory: StorageDriverFactory
      attachmentQuotaService: AttachmentQuotaService
      attachmentQuotaRecoveryScheduler: typeof scheduleAttachmentQuotaRecovery
      attachmentScanGate: AttachmentScanGate
    }) => new ScopedAttachmentUploadService({
      em,
      dataEngine,
      storageDriverFactory,
      attachmentQuotaService,
      attachmentQuotaRecoveryScheduler,
      attachmentScanGate,
    }))
      .scoped()
      .proxy(),
    storageDriverFactory: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      new StorageDriverFactory(em),
    )
      .singleton()
      .proxy(),
    // The scoped upload service is handed over as a lazy resolver so module
    // uploads share the public attachment route's single fenced reservation
    // ledger, without dragging that service's own dependencies into every
    // container that merely constructs an `attachmentService`.
    attachmentService: asFunction((cradle: {
      em: ConstructorParameters<typeof DefaultAttachmentService>[0]
      storageDriverFactory: ConstructorParameters<typeof DefaultAttachmentService>[1]
      attachmentScopedUploadService: ScopedAttachmentUploadService
    }) => new DefaultAttachmentService(
      cradle.em,
      cradle.storageDriverFactory,
      () => cradle.attachmentScopedUploadService ?? null,
    ))
      .scoped()
      .proxy(),
    attachmentEnvironmentPrivacyHandler: asClass(AttachmentEnvironmentPrivacyHandler).scoped(),
  })
}
