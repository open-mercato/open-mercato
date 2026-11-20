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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string) => `translated:${key}`,
  })),
}))

function makeAction(overrides: Partial<AiPendingAction> = {}): AiPendingAction {
  return {
    id: 'pa_i18n',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.bulk_update_products',
    status: 'pending',
    fieldDiff: [],
    records: [
      { recordId: 'p-1', entityType: 'catalog.product', label: 'p-1', fieldDiff: [], recordVersion: 'v-1' },
      { recordId: 'p-2', entityType: 'catalog.product', label: 'p-2', fieldDiff: [], recordVersion: 'v-1' },
      { recordId: 'p-3', entityType: 'catalog.product', label: 'p-3', fieldDiff: [], recordVersion: 'v-1' },
    ],
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: null,
    attachmentIds: [],
    normalizedInput: { records: [{ recordId: 'p-1' }, { recordId: 'p-2' }, { recordId: 'p-3' }] },
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'catalog.product',
    targetRecordId: null,
    conversationId: null,
    idempotencyKey: 'idem_i18n',
    createdByUserId: 'user-1',
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    expiresAt: new Date('2026-04-18T11:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  } as unknown as AiPendingAction
}

function makeBulkTool(currentVersions: Record<string, string>): AiToolDefinition {
  return {
    name: 'catalog.bulk_update_products',
    description: 'bulk',
    inputSchema: z.object({}).passthrough(),
    handler: async () => ({ ok: true }),
    isMutation: true,
    isBulk: true,
    loadBeforeRecords: async () =>
      Object.entries(currentVersions).map(([recordId, recordVersion]) => ({
        recordId,
        entityType: 'catalog.product',
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

describe('checkRecordVersion — localized stale messages', () => {
  it('translates the per-row stale and missing messages of a partially stale batch', async () => {
    const result = await checkRecordVersion(
      makeAction(),
      makeBulkTool({ 'p-1': 'v-1', 'p-2': 'v-2' }),
      makeCtx(),
    )
    expect(result).toEqual({
      ok: true,
      failedRecords: [
        { recordId: 'p-2', error: { code: 'stale_version', message: 'translated:ai_assistant.errors.pendingRecordStale' } },
        { recordId: 'p-3', error: { code: 'stale_version', message: 'translated:ai_assistant.errors.pendingRecordMissing' } },
      ],
    })
  })

  it('translates the all-stale refusal', async () => {
    const result = await checkRecordVersion(
      makeAction(),
      makeBulkTool({ 'p-1': 'v-2', 'p-2': 'v-2', 'p-3': 'v-2' }),
      makeCtx(),
    )
    expect(result).toMatchObject({
      ok: false,
      status: 412,
      code: 'stale_version',
      message: 'translated:ai_assistant.errors.pendingAllRecordsStale',
      extra: { staleRecords: ['p-1', 'p-2', 'p-3'] },
    })
  })

  it('translates the single-record stale refusal', async () => {
    const tool = {
      name: 'catalog.update_product',
      description: 'single',
      inputSchema: z.object({}).passthrough(),
      handler: async () => ({ ok: true }),
      isMutation: true,
      loadBeforeRecord: async () => ({
        recordId: 'p-1',
        entityType: 'catalog.product',
        label: 'p-1',
        recordVersion: 'v-2',
        before: {},
      }),
    } as AiToolDefinition
    const result = await checkRecordVersion(
      makeAction({ records: null, normalizedInput: { productId: 'p-1' }, recordVersion: 'v-1', targetRecordId: 'p-1' }),
      tool,
      makeCtx(),
    )
    expect(result).toMatchObject({
      ok: false,
      status: 412,
      code: 'stale_version',
      message: 'translated:ai_assistant.errors.pendingSingleRecordStale',
    })
  })
})
