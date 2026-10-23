import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { StorageDriverFactory } from './lib/drivers/driverFactory'
import { DefaultAttachmentService } from './lib/attachment-service'
import { createAttachmentQuotaService, type AttachmentQuotaService } from './lib/quota-service'
import { scheduleAttachmentQuotaRecovery } from './lib/quota-recovery-queue'
import { AttachmentTargetAccessService } from './lib/target-access-service'
import { ScopedAttachmentUploadService } from './lib/scoped-upload-service'
import {
  createDocumentStructureEngineRegistry,
  DOCUMENT_STRUCTURE_ENGINES_DI_KEY,
} from './lib/documentStructure/engines/registry'
import {
  ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY,
  createAttachmentDocumentStructureService,
} from './lib/documentStructure/service'
import { enqueueDocumentStructureExtraction } from './lib/documentStructure/queue'

export function register(container: AppContainer) {
  container.register({
    attachmentQuotaRecoveryScheduler: asValue(scheduleAttachmentQuotaRecovery),
    [DOCUMENT_STRUCTURE_ENGINES_DI_KEY]: asFunction(() => createDocumentStructureEngineRegistry()).singleton(),
    [ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY]: asFunction(({ em }: { em: ConstructorParameters<typeof StorageDriverFactory>[0] }) =>
      createAttachmentDocumentStructureService({
        em,
        enqueue: (input) => enqueueDocumentStructureExtraction(container, input),
      }),
    )
      .scoped()
      .proxy(),
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
    }: {
      em: ConstructorParameters<typeof StorageDriverFactory>[0]
      dataEngine: DataEngine
      storageDriverFactory: StorageDriverFactory
      attachmentQuotaService: AttachmentQuotaService
      attachmentQuotaRecoveryScheduler: typeof scheduleAttachmentQuotaRecovery
    }) => new ScopedAttachmentUploadService({
      em,
      dataEngine,
      storageDriverFactory,
      attachmentQuotaService,
      attachmentQuotaRecoveryScheduler,
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
  })
}
