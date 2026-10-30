/** @jest-environment node */

import { Attachment, AttachmentPartition } from '../../data/entities'
import { DOCUMENT_STRUCTURE_QUEUE_DI_KEY } from '../../lib/documentStructure/queue'
import handle, { metadata } from '../enqueue-structure-extraction'

type Row = Record<string, unknown>

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(
    async (em: { __find: (entity: unknown, where: Row) => Row[] }, entity: unknown, where: Row) =>
      em.__find(entity, where)[0] ?? null,
  ),
}))

const mockReportError = jest.fn()
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555'

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => (row[key] ?? null) === (value ?? null))
}

function createContext(options: { extractDocumentStructure: boolean; enqueue?: jest.Mock }) {
  const tables = new Map<unknown, Row[]>([
    [Attachment, [{ id: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A, partitionCode: 'privateAttachments' }]],
    [AttachmentPartition, [{ code: 'privateAttachments', extractDocumentStructure: options.extractDocumentStructure }]],
  ])
  const em = {
    __find: (entity: unknown, where: Row) => (tables.get(entity) ?? []).filter((row) => matches(row, where)),
    fork: () => em,
  }
  const enqueue = options.enqueue ?? jest.fn(async () => 'job-1')
  const queue = { enqueue }
  const resolve = <T,>(name: string): T => {
    if (name === 'em') return em as T
    if (name === DOCUMENT_STRUCTURE_QUEUE_DI_KEY) return queue as T
    throw new Error(`[internal] unregistered ${name}`)
  }
  return { ctx: { resolve }, enqueue }
}

describe('enqueue-structure-extraction subscriber', () => {
  beforeEach(() => {
    mockReportError.mockClear()
  })

  it('subscribes persistently to attachment creation', () => {
    expect(metadata).toEqual({
      event: 'attachments.attachment.created',
      persistent: true,
      id: 'attachments:enqueue-structure-extraction',
    })
  })

  it('enqueues extraction when the partition opts in', async () => {
    const { ctx, enqueue } = createContext({ extractDocumentStructure: true })

    await handle({ id: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A }, ctx)

    expect(enqueue).toHaveBeenCalledWith({ attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A })
  })

  it('skips extraction when the partition flag is off', async () => {
    const { ctx, enqueue } = createContext({ extractDocumentStructure: false })

    await handle({ id: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A }, ctx)

    expect(enqueue).not.toHaveBeenCalled()
  })

  it('skips extraction when the event scope does not match the attachment', async () => {
    const { ctx, enqueue } = createContext({ extractDocumentStructure: true })

    await handle({ id: ATTACHMENT_ID, tenantId: TENANT_B, organizationId: ORG_B }, ctx)
    await handle({ id: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: null }, ctx)
    await handle({ id: 'not-a-uuid', tenantId: TENANT_A, organizationId: ORG_A }, ctx)

    expect(enqueue).not.toHaveBeenCalled()
  })

  it('reports enqueue failures without throwing into the event bus', async () => {
    const failure = new Error('queue down')
    const { ctx } = createContext({ extractDocumentStructure: true, enqueue: jest.fn(async () => { throw failure }) })

    await expect(handle({ id: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A }, ctx)).resolves.toBeUndefined()

    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({ module: 'attachments' }))
  })
})
