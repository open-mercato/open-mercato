import { asValue, createContainer, InjectionMode } from 'awilix'
import { getProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { enqueueDocumentStructureExtraction } from '../lib/documentStructure/queue'
import { register } from '../di'

jest.mock('../lib/access-runner', () => ({ createAttachmentAccessContext: (scope: { resolve: (name: string) => unknown }) => scope.resolve('auth') }))
jest.mock('../lib/drivers/driverFactory', () => ({ StorageDriverFactory: class {} }))
jest.mock('../lib/attachment-service', () => ({
  DefaultAttachmentService: class {
    constructor(readonly em: unknown, readonly storage: unknown, readonly upload: unknown, readonly access: () => unknown, readonly data: () => unknown) {}
  },
}))
jest.mock('../lib/quota-service', () => ({ createAttachmentQuotaService: jest.fn() }))
jest.mock('../lib/quota-recovery-queue', () => ({ scheduleAttachmentQuotaRecovery: jest.fn() }))
jest.mock('../lib/target-access-service', () => ({ AttachmentTargetAccessService: class {} }))
jest.mock('../lib/scoped-upload-service', () => ({ ScopedAttachmentUploadService: class {} }))
jest.mock('../lib/documentStructure/engines/registry', () => ({ DOCUMENT_STRUCTURE_ENGINES_DI_KEY: 'engines', createDocumentStructureEngineRegistry: () => ({}) }))
jest.mock('../lib/documentStructure/service', () => ({ ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY: 'structure', createAttachmentDocumentStructureService: (options: unknown) => options }))
jest.mock('../lib/documentStructure/queue', () => ({ enqueueDocumentStructureExtraction: jest.fn(async () => {}) }))

it('binds merged document structure and attachment callbacks to each resolving caller', async () => {
  const root = createContainer({ injectionMode: InjectionMode.CLASSIC })
  getProcessDiRegistrar(register)!(root)
  const first = root.createScope().register({ em: asValue('first-em'), auth: asValue('first-auth'), dataEngine: asValue('first-data') })
  const second = root.createScope().register({ em: asValue('second-em'), auth: asValue('second-auth'), dataEngine: asValue('second-data') })
  for (const [scope, label] of [[first, 'first'], [second, 'second']] as const) {
    const structure = scope.resolve<{ em: unknown; accessContext: () => unknown; enqueue: (input: unknown) => Promise<void> }>('structure')
    expect(structure.em).toBe(`${label}-em`)
    expect(structure.accessContext()).toBe(`${label}-auth`)
    const payload = { attachmentId: label }
    await structure.enqueue(payload)
    expect(enqueueDocumentStructureExtraction).toHaveBeenLastCalledWith(scope, payload)
    const attachments = scope.resolve<{ em: unknown; access: () => unknown; data: () => unknown }>('attachmentService')
    expect(attachments.em).toBe(`${label}-em`)
    expect(attachments.access()).toBe(`${label}-auth`)
    expect(attachments.data()).toBe(`${label}-data`)
  }
  await Promise.all([first.dispose(), second.dispose(), root.dispose()])
})
