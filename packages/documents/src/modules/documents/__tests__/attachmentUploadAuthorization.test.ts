import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555'

const mockAssertTier = jest.fn(async () => 'editor')
const mockLockDocumentAggregateRoot = jest.fn(async () => ({ id: DOCUMENT_ID }))
const mockAssertDocumentCommandCapability = jest.fn()
const mockLoadScopedDocument = jest.fn(async () => ({ id: DOCUMENT_ID }))
const mockValidateMutationGuard = jest.fn(async () => null)
const mockRunMutationGuardAfterSuccess = jest.fn(async () => undefined)
const mockReadAttachmentUploadForm = jest.fn()
const mockCreateScoped = jest.fn()
const mockExecuteCommand = jest.fn()
const mockPersist = jest.fn()
const mockCreate = jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
  ...data,
  updatedAt: new Date('2026-07-14T10:00:00.000Z'),
}))

const tx = { create: mockCreate, persist: mockPersist }
const attachmentService = {
  validateUpload: jest.fn(),
  readScoped: jest.fn(),
  createScoped: mockCreateScoped,
}
const commandBus = { execute: mockExecuteCommand }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'attachmentService') return attachmentService
    if (name === 'commandBus') return commandBus
    throw new Error(`Unexpected dependency: ${name}`)
  }),
}
const routeContext = {
  container,
  em: {},
  auth: {
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    organizationId: ORGANIZATION_ID,
    features: ['documents.edit'],
    roleIds: [],
    resolvedRoleIds: [],
  },
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
}

jest.mock('../lib/permissions', () => ({
  assertTier: (...args: unknown[]) => mockAssertTier(...args),
}))

jest.mock('../commands/aggregate', () => ({
  lockDocumentAggregateRoot: (...args: unknown[]) => mockLockDocumentAggregateRoot(...args),
}))

jest.mock('../commands/shared', () => ({
  ...jest.requireActual('../commands/shared'),
  assertDocumentCommandCapability: (...args: unknown[]) => mockAssertDocumentCommandCapability(...args),
}))

jest.mock('../lib/attachmentServicePort', () => ({
  resolveAttachmentServicePort: () => attachmentService,
  readAttachmentUploadForm: (...args: unknown[]) => mockReadAttachmentUploadForm(...args),
}))

jest.mock('../api/_shared', () => ({
  assertDocumentNotArchived: jest.fn(async () => undefined),
  resolveDocumentsContext: async (request: Request) => ({ ...routeContext, request }),
  loadScopedDocument: (...args: unknown[]) => mockLoadScopedDocument(...args),
  resolveActorUserId: () => USER_ID,
  validateMutationGuard: (...args: unknown[]) => mockValidateMutationGuard(...args),
  runMutationGuardAfterSuccess: (...args: unknown[]) => mockRunMutationGuardAfterSuccess(...args),
  handleDocumentsRouteError: (error: unknown) => {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  },
  routeErrorSchema: {},
  withDocumentsContextErrors: (doc: unknown) => doc,
}))

type UploadRoute = typeof import('../api/[id]/attachments/route')
type AttachmentCommands = typeof import('../commands/attachments')

let POST: UploadRoute['POST']
let createDocumentAttachmentCommand: AttachmentCommands['createDocumentAttachmentCommand']

beforeAll(async () => {
  ;({ POST } = await import('../api/[id]/attachments/route'))
  ;({ createDocumentAttachmentCommand } = await import('../commands/attachments'))
})

beforeEach(() => {
  jest.clearAllMocks()
  const form = new FormData()
  form.set('file', new File([Buffer.from('safe image')], 'image.png', { type: 'image/png' }))
  mockReadAttachmentUploadForm.mockResolvedValue(form)
  mockCreateScoped.mockImplementation(async (input: {
    persistLink?: (em: typeof tx, attachmentId: string) => Promise<void>
  }) => {
    await input.persistLink?.(tx, ATTACHMENT_ID)
    return { id: ATTACHMENT_ID }
  })
  mockExecuteCommand.mockImplementation(async (
    commandId: string,
    options: Parameters<typeof createDocumentAttachmentCommand.execute> extends [infer Input, infer Context]
      ? { input: Input; ctx: Context }
      : never,
  ) => {
    if (commandId !== 'documents.attachment.create') throw new Error(`Unexpected command: ${commandId}`)
    return {
      result: await createDocumentAttachmentCommand.execute(options.input, options.ctx),
      logEntry: null,
    }
  })
})

function request(): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/attachments`, {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=test' },
  })
}

describe('document attachment upload authorization freshness', () => {
  it('rechecks edit capability under the document lock after upload buffering', async () => {
    mockAssertDocumentCommandCapability.mockRejectedValueOnce(
      new CrudHttpError(403, { error: 'Forbidden' }),
    )

    const response = await POST(request(), { params: Promise.resolve({ id: DOCUMENT_ID }) })

    expect(response.status).toBe(403)
    expect(mockAssertTier).toHaveBeenCalledTimes(1)
    expect(mockLockDocumentAggregateRoot).toHaveBeenCalledWith(
      tx,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )
    expect(mockAssertDocumentCommandCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        selectedOrganizationId: ORGANIZATION_ID,
        transactionalEm: tx,
      }),
      tx,
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      'canEdit',
    )
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockPersist).not.toHaveBeenCalled()
    expect(mockRunMutationGuardAfterSuccess).not.toHaveBeenCalled()
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      'documents.attachment.create',
      expect.objectContaining({
        input: {
          documentId: DOCUMENT_ID,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          fileName: 'image.png',
          fileType: 'image/png',
          fileSize: 10,
        },
      }),
    )
  })
})
