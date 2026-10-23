/** @jest-environment node */

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
  AttachmentDocumentExtraction: class AttachmentDocumentExtraction {},
  AttachmentDocumentSection: class AttachmentDocumentSection {},
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  REQUEST_DOCUMENT_STRUCTURE_COMMAND_ID,
  requestDocumentStructureCommand,
  type RequestDocumentStructureCommandInput,
} from '../documentStructure'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444'
const EXTRACTION_ID = '55555555-5555-4555-8555-555555555555'

const auth = { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID }

function setup(options: { engineSupported?: boolean } = {}) {
  const service = {
    getStructure: jest.fn(async () => ({ attachmentId: ATTACHMENT_ID, extraction: null, outline: [] })),
    requestExtraction: jest.fn(async () => ({ extractionId: null, status: 'pending', enqueued: true, jobId: 'job-1' })),
  }
  const registry = {
    resolve: jest.fn(() => (options.engineSupported === false ? null : { id: 'text', version: 1 })),
  }
  const em = {}
  const container = {
    resolve: (name: string) => {
      if (name === 'attachmentDocumentStructureService') return service
      if (name === 'attachmentDocumentStructureEngines') return registry
      if (name === 'em') return em
      throw new Error(`[internal] unexpected resolve ${name}`)
    },
  }
  const ctx = {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
  return { service, registry, ctx }
}

const input: RequestDocumentStructureCommandInput = {
  attachmentId: ATTACHMENT_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return null
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES
  mockFindOneWithDecryption.mockResolvedValue({
    id: ATTACHMENT_ID,
    fileName: 'rules.md',
    mimeType: 'text/markdown',
    fileSize: 1024,
  })
})

describe('attachments.document_structure.request command', () => {
  it('is registered under the spec id and is not undoable', () => {
    expect(requestDocumentStructureCommand.id).toBe(REQUEST_DOCUMENT_STRUCTURE_COMMAND_ID)
    expect(REQUEST_DOCUMENT_STRUCTURE_COMMAND_ID).toBe('attachments.document_structure.request')
    expect(requestDocumentStructureCommand.isUndoable).toBe(false)
  })

  it('queues an extraction in the caller scope with the requesting user', async () => {
    const { service, ctx } = setup()
    const result = await requestDocumentStructureCommand.execute({ ...input, force: true, ocr: 'never' }, ctx)
    expect(result).toEqual({ attachmentId: ATTACHMENT_ID, extractionId: null, status: 'pending', enqueued: true })
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID, auth }
    expect(service.getStructure).toHaveBeenCalledWith({ attachmentId: ATTACHMENT_ID, scope, includeOutline: false })
    expect(service.requestExtraction).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT_ID,
      scope,
      force: true,
      ocr: 'never',
      requestedByUserId: USER_ID,
    })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { id: ATTACHMENT_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      expect.anything(),
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  it('returns 404 when the attachment is not accessible', async () => {
    const { service, ctx } = setup()
    service.getStructure.mockResolvedValueOnce(null as never)
    const error = await captureError(requestDocumentStructureCommand.execute(input, ctx))
    expect(isCrudHttpError(error) && error.status).toBe(404)
    expect(service.requestExtraction).not.toHaveBeenCalled()
  })

  it('returns 413 when the file exceeds the structure size cap', async () => {
    process.env.OM_ATTACHMENT_STRUCTURE_MAX_BYTES = '512'
    const { service, ctx } = setup()
    const error = await captureError(requestDocumentStructureCommand.execute(input, ctx))
    expect(isCrudHttpError(error) && error.status).toBe(413)
    expect(isCrudHttpError(error) && error.body).toEqual(expect.objectContaining({ code: 'too_large' }))
    expect(service.requestExtraction).not.toHaveBeenCalled()
  })

  it('returns 422 for a file type no engine supports', async () => {
    const { service, registry, ctx } = setup({ engineSupported: false })
    const error = await captureError(requestDocumentStructureCommand.execute(input, ctx))
    expect(registry.resolve).toHaveBeenCalledWith('text/markdown', 'md')
    expect(isCrudHttpError(error) && error.status).toBe(422)
    expect(isCrudHttpError(error) && error.body).toEqual(expect.objectContaining({ code: 'unsupported_type' }))
    expect(service.requestExtraction).not.toHaveBeenCalled()
  })

  it('returns the current extraction without re-checking the file when not forced', async () => {
    const { service, ctx } = setup({ engineSupported: false })
    service.getStructure.mockResolvedValueOnce({
      attachmentId: ATTACHMENT_ID,
      extraction: { id: EXTRACTION_ID, status: 'completed' },
      outline: [],
    } as never)
    service.requestExtraction.mockResolvedValueOnce({
      extractionId: EXTRACTION_ID,
      status: 'completed',
      enqueued: false,
      jobId: null,
    } as never)
    const result = await requestDocumentStructureCommand.execute(input, ctx)
    expect(result).toEqual({ attachmentId: ATTACHMENT_ID, extractionId: EXTRACTION_ID, status: 'completed', enqueued: false })
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('builds an audit log entry for the attachment', async () => {
    const { ctx } = setup()
    const log = await requestDocumentStructureCommand.buildLog?.({
      input: { ...input, force: true },
      result: { attachmentId: ATTACHMENT_ID, extractionId: null, status: 'pending', enqueued: true },
      ctx,
      snapshots: {},
    })
    expect(log).toEqual(
      expect.objectContaining({
        actionLabel: 'Document structure extraction requested',
        resourceKind: 'attachments.attachment',
        resourceId: ATTACHMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }),
    )
  })
})
