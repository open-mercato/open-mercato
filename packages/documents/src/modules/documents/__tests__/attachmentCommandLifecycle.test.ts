import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { DocumentAttachment } from '../data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockAssertDocumentCommandCapability = jest.fn(async () => ['documents.edit'])
const mockLockDocumentAggregateRoot = jest.fn(async () => ({ id: DOCUMENT_ID }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../commands/aggregate', () => ({
  lockDocumentAggregateRoot: (...args: unknown[]) => mockLockDocumentAggregateRoot(...args),
}))

jest.mock('../commands/shared', () => ({
  ...jest.requireActual('../commands/shared'),
  assertDocumentCommandCapability: (...args: unknown[]) => mockAssertDocumentCommandCapability(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { error: jest.fn(), child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { createLogger: jest.fn(() => logger) }
})

import {
  deleteDocumentAttachmentCommand,
  releaseAllDocumentAttachments,
  runAttachmentProviderCleanups,
  type DocumentAttachmentDeleteCommandInput,
} from '../commands/attachments'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const LINK_ID = '55555555-5555-4555-8555-555555555555'
const ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666'
const CURRENT_UPDATED_AT = new Date('2026-07-12T12:00:00.000Z')
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

function makeLink(id = LINK_ID, attachmentId = ATTACHMENT_ID): DocumentAttachment {
  return Object.assign(new DocumentAttachment(), {
    id,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    attachmentId,
    createdByUserId: USER_ID,
    createdAt: CURRENT_UPDATED_AT,
    updatedAt: CURRENT_UPDATED_AT,
    deletedAt: null,
  })
}

function makeHarness(expectedUpdatedAt: string) {
  const order: string[] = []
  const providerCleanup = jest.fn(async () => { order.push('provider-delete') })
  const releaseScoped = jest.fn(async () => providerCleanup)
  const attachmentService = {
    validateUpload: jest.fn(),
    createScoped: jest.fn(),
    readScoped: jest.fn(),
    releaseScoped,
  }
  let inTransaction = false
  const em = {
    begin: jest.fn(async () => { inTransaction = true; order.push('begin') }),
    flush: jest.fn(async () => { order.push('flush') }),
    commit: jest.fn(async () => { inTransaction = false; order.push('commit') }),
    rollback: jest.fn(async () => { inTransaction = false; order.push('rollback') }),
    isInTransaction: jest.fn(() => inTransaction),
  } as unknown as EntityManager
  const ctx = {
    container: {
      resolve: (name: string) => {
        if (name === 'attachmentService') return attachmentService
        throw new Error(`Unexpected dependency: ${name}`)
      },
    } as CommandRuntimeContext['container'],
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
    } as CommandRuntimeContext['auth'],
    selectedOrganizationId: ORGANIZATION_ID,
    transactionalEm: em,
    request: new Request('http://localhost/attachments', {
      method: 'DELETE',
      headers: { [LOCK_HEADER]: expectedUpdatedAt },
    }),
  } satisfies CommandRuntimeContext
  return { ctx, em, releaseScoped, providerCleanup, order }
}

function input(): DocumentAttachmentDeleteCommandInput {
  return {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    attachmentId: ATTACHMENT_ID,
  }
}

describe('document attachment command lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ now: CURRENT_UPDATED_AT })
    mockFindOneWithDecryption.mockResolvedValue(makeLink())
    mockFindWithDecryption.mockResolvedValue([])
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('rejects a stale detach before provider or quota cleanup', async () => {
    const harness = makeHarness('2026-07-12T11:59:59.000Z')

    await expect(deleteDocumentAttachmentCommand.execute(input(), harness.ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'optimistic_lock_conflict' }),
    })

    expect(harness.releaseScoped).not.toHaveBeenCalled()
  })

  it('permanently releases the scoped blob and versions the audited link', async () => {
    const harness = makeHarness(CURRENT_UPDATED_AT.toISOString())
    const link = makeLink()
    mockFindOneWithDecryption.mockResolvedValue(link)

    const result = await deleteDocumentAttachmentCommand.execute(input(), harness.ctx)

    expect(harness.releaseScoped).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      expectedOwner: { entityId: 'documents:document', recordId: DOCUMENT_ID },
      expectedAssignment: { type: 'documents:document', id: DOCUMENT_ID },
      expectedPartitionCode: 'privateAttachments',
    }, { em: harness.em, flush: false })
    expect(link.deletedAt).toEqual(new Date('2026-07-12T12:00:00.001Z'))
    expect(result.updatedAt).toBe('2026-07-12T12:00:00.001Z')
    expect(harness.order).toEqual(['begin', 'flush', 'commit', 'provider-delete'])
    expect(deleteDocumentAttachmentCommand.isUndoable).toBe(false)
    expect(deleteDocumentAttachmentCommand.undo).toBeUndefined()
  })

  it('releases every active document attachment during document deletion', async () => {
    const harness = makeHarness(CURRENT_UPDATED_AT.toISOString())
    const first = makeLink()
    const second = makeLink(
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
    )
    mockFindWithDecryption.mockResolvedValue([first, second])

    const cleanups = await releaseAllDocumentAttachments(
      harness.ctx,
      harness.em,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      DOCUMENT_ID,
    )

    expect(harness.releaseScoped).toHaveBeenCalledTimes(2)
    expect(harness.releaseScoped).toHaveBeenNthCalledWith(2, expect.objectContaining({
      attachmentId: second.attachmentId,
      expectedOwner: { entityId: 'documents:document', recordId: DOCUMENT_ID },
    }), { em: harness.em, flush: false })
    expect(first.deletedAt).toBeInstanceOf(Date)
    expect(second.deletedAt).toBeInstanceOf(Date)
    expect(harness.providerCleanup).not.toHaveBeenCalled()
    await runAttachmentProviderCleanups(cleanups)
    expect(harness.providerCleanup).toHaveBeenCalledTimes(2)
  })

  it('does not run staged cleanup when a later transaction phase rolls back', async () => {
    const harness = makeHarness(CURRENT_UPDATED_AT.toISOString())
    mockFindWithDecryption.mockResolvedValue([makeLink()])
    let cleanups: Array<() => Promise<void>> = []

    await expect(withAtomicFlush(harness.em, [
      async () => {
        cleanups = await releaseAllDocumentAttachments(
          harness.ctx,
          harness.em,
          { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
          DOCUMENT_ID,
        )
      },
      () => { throw new Error('later document mutation failed') },
    ], { transaction: true })).rejects.toThrow('later document mutation failed')

    expect(cleanups).toHaveLength(1)
    expect(harness.providerCleanup).not.toHaveBeenCalled()
    expect(harness.order).toEqual(['begin', 'flush', 'rollback'])
  })

  it('continues cleanup after one provider fails post-commit', async () => {
    const calls: string[] = []
    await expect(runAttachmentProviderCleanups([
      async () => { calls.push('first') },
      async () => { calls.push('second'); throw new Error('provider unavailable') },
      async () => { calls.push('third') },
    ])).resolves.toBeUndefined()

    expect(calls).toEqual(['first', 'second', 'third'])
  })
})
