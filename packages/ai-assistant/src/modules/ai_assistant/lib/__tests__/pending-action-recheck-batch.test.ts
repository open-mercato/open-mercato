import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { checkRecordVersion, type PendingActionAuthContext } from '../pending-action-recheck'
import type { AiToolDefinition } from '../types'
import type { AiPendingAction } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

function previewRecord(recordId: string, recordVersion: string) {
  return { recordId, entityType: 'catalog.product', label: recordId, fieldDiff: [], recordVersion }
}

function makeAction(normalizedInput: unknown): AiPendingAction {
  return {
    id: 'pa_batch',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.update_product_media_descriptions',
    status: 'pending',
    fieldDiff: [],
    records: [previewRecord('m-1', 'v-1'), previewRecord('m-2', 'v-1')],
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: null,
    attachmentIds: [],
    normalizedInput,
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'attachment',
    targetRecordId: null,
    conversationId: null,
    idempotencyKey: 'idem_batch',
    createdByUserId: 'user-1',
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    expiresAt: new Date('2026-04-18T11:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
  } as unknown as AiPendingAction
}

function makeTool(currentVersions: Record<string, string>): AiToolDefinition {
  return {
    name: 'catalog.update_product_media_descriptions',
    description: 'media',
    inputSchema: z.object({}).passthrough(),
    handler: async () => ({ ok: true }),
    isMutation: true,
    isBulk: true,
    loadBeforeRecords: async () =>
      Object.entries(currentVersions).map(([recordId, recordVersion]) => ({
        recordId,
        entityType: 'attachment',
        label: recordId,
        recordVersion,
        before: {},
      })),
  } as AiToolDefinition
}

function makeCtx(): PendingActionAuthContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    userFeatures: ['ai_assistant.view'],
    isSuperAdmin: false,
    container: { resolve: () => ({}) } as unknown as AwilixContainer,
    em: {} as never,
  }
}

const mediaInput = {
  mediaUpdates: [
    { mediaId: 'm-1', altText: 'a' },
    { mediaId: 'm-2', altText: 'b' },
  ],
}

describe('checkRecordVersion — batch input that cannot be narrowed', () => {
  it('returns 412 stale_version when a row is stale and the input has no records[] ids', async () => {
    const result = await checkRecordVersion(makeAction(mediaInput), makeTool({ 'm-1': 'v-1', 'm-2': 'v-2' }), makeCtx())
    expect(result).toMatchObject({
      ok: false,
      status: 412,
      code: 'stale_version',
      extra: { staleRecords: ['m-2'] },
    })
  })

  it('keeps answering ok when nothing is stale', async () => {
    const result = await checkRecordVersion(makeAction(mediaInput), makeTool({ 'm-1': 'v-1', 'm-2': 'v-1' }), makeCtx())
    expect(result).toEqual({ ok: true })
  })

  it('keeps the partial-success answer when the input follows the records[] convention', async () => {
    const result = await checkRecordVersion(
      makeAction({
        records: [
          { recordId: 'm-1', title: 'a' },
          { recordId: 'm-2', title: 'b' },
        ],
      }),
      makeTool({ 'm-1': 'v-1', 'm-2': 'v-2' }),
      makeCtx(),
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.failedRecords?.map((entry) => entry.recordId)).toEqual(['m-2'])
  })

  it('returns 412 when the only fresh input rows were never previewed', async () => {
    const action = makeAction({
      records: [
        { recordId: 'm-2', title: 'b' },
        { recordId: 'm-9', title: 'never previewed' },
      ],
    })
    const result = await checkRecordVersion(action, makeTool({ 'm-1': 'v-1', 'm-2': 'v-2' }), makeCtx())
    expect(result).toMatchObject({ ok: false, status: 412, code: 'stale_version' })
  })

  it('returns 412 when no input row matches a previewed row', async () => {
    const action = makeAction({
      records: [
        { recordId: 'M-1', title: 'a' },
        { recordId: 'm-9', title: 'b' },
      ],
    })
    const result = await checkRecordVersion(action, makeTool({ 'm-1': 'v-1', 'm-2': 'v-1' }), makeCtx())
    expect(result).toMatchObject({ ok: false, status: 412, code: 'stale_version' })
  })

  it('returns 412 for a bulk action whose preview loaded no rows', async () => {
    const action = { ...makeAction({ records: [{ recordId: 'm-1', title: 'a' }] }), records: null } as unknown as AiPendingAction
    const result = await checkRecordVersion(action, makeTool({ 'm-1': 'v-1' }), makeCtx())
    expect(result).toMatchObject({ ok: false, status: 412, code: 'stale_version', extra: { staleRecords: [] } })
  })

  it('returns 412 when the tool lost its preview resolver and no input row matches a previewed row', async () => {
    const tool = { ...makeTool({}), loadBeforeRecords: undefined } as AiToolDefinition
    const result = await checkRecordVersion(makeAction({ records: [{ recordId: 'm-9', title: 'a' }] }), tool, makeCtx())
    expect(result).toMatchObject({ ok: false, status: 412, code: 'stale_version' })
  })

  it('keeps answering ok without a preview resolver when the input matches the previewed rows', async () => {
    const tool = { ...makeTool({}), loadBeforeRecords: undefined } as AiToolDefinition
    const result = await checkRecordVersion(makeAction({ records: [{ recordId: 'm-1', title: 'a' }] }), tool, makeCtx())
    expect(result).toEqual({ ok: true })
  })
})
