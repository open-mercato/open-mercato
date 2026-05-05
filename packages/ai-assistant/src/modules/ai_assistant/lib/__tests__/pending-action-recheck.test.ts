import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import {
  checkAgentAndFeatures,
  checkAttachmentScope,
  checkRecordVersion,
  checkStatusAndExpiry,
  checkToolWhitelist,
  runPendingActionRechecks,
  type PendingActionAuthContext,
} from '../pending-action-recheck'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import type { AiPendingAction } from '../../data/entities'

const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

function makeAction(overrides: Partial<AiPendingAction> = {}): AiPendingAction {
  return {
    id: 'pa_1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [{ field: 'title', before: 'Old', after: 'New' }],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: 'v-1',
    attachmentIds: [],
    normalizedInput: { productId: 'p-1', patch: { title: 'New' } },
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'product',
    targetRecordId: 'p-1',
    conversationId: null,
    idempotencyKey: 'idem_1',
    createdByUserId: 'user-1',
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    expiresAt: new Date('2026-04-18T11:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  } as unknown as AiPendingAction
}

function makeAgent(overrides: Partial<AiAgentDefinition> = {}): AiAgentDefinition {
  return {
    id: 'catalog.merchandising_assistant',
    moduleId: 'catalog',
    label: 'Catalog Agent',
    description: '...',
    systemPrompt: '...',
    allowedTools: ['catalog.update_product'],
    readOnly: false,
    mutationPolicy: 'confirm-required',
    ...overrides,
  }
}

function makeTool(overrides: Partial<AiToolDefinition> = {}): AiToolDefinition {
  return {
    name: 'catalog.update_product',
    description: 'Update a product',
    inputSchema: z.object({
      productId: z.string(),
      patch: z.object({ title: z.string() }).partial(),
    }),
    handler: async () => ({ ok: true, recordId: 'p-1' }),
    isMutation: true,
    loadBeforeRecord: async () => ({
      recordId: 'p-1',
      entityType: 'catalog.product',
      recordVersion: 'v-1',
      before: { title: 'Old' },
    }),
    ...overrides,
  } as AiToolDefinition
}

function makeCtx(overrides: Partial<PendingActionAuthContext> = {}): PendingActionAuthContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    userFeatures: ['ai_assistant.view', 'catalog.view', 'catalog.manage'],
    isSuperAdmin: false,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return {}
        throw new Error(`unknown dep ${name}`)
      },
    } as unknown as AwilixContainer,
    em: {} as never,
    ...overrides,
  }
}

describe('pending-action-recheck guards', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  describe('checkStatusAndExpiry', () => {
    it('passes for pending + unexpired', () => {
      const result = checkStatusAndExpiry(makeAction(), {
        now: new Date('2026-04-18T10:30:00.000Z'),
      })
      expect(result.ok).toBe(true)
    })

    it('rejects cancelled with 409 invalid_status', () => {
      const result = checkStatusAndExpiry(makeAction({ status: 'cancelled' as never }))
      expect(result).toMatchObject({ ok: false, status: 409, code: 'invalid_status' })
    })

    it('rejects expired with 409 expired', () => {
      const result = checkStatusAndExpiry(makeAction(), {
        now: new Date('2026-04-18T12:00:00.000Z'),
      })
      expect(result).toMatchObject({ ok: false, status: 409, code: 'expired' })
    })
  })

  describe('checkAgentAndFeatures', () => {
    it('passes when caller carries the agent features', () => {
      const result = checkAgentAndFeatures(makeAgent({ requiredFeatures: ['catalog.view'] }), makeCtx())
      expect(result.ok).toBe(true)
    })

    it('rejects unknown agent with 404', () => {
      const result = checkAgentAndFeatures(null, makeCtx())
      expect(result).toMatchObject({ ok: false, status: 404, code: 'agent_unknown' })
    })

    it('rejects missing feature with 403 agent_features_denied', () => {
      const result = checkAgentAndFeatures(
        makeAgent({ requiredFeatures: ['catalog.manage.full'] }),
        makeCtx({ userFeatures: ['catalog.view'] }),
      )
      expect(result).toMatchObject({ ok: false, status: 403, code: 'agent_features_denied' })
    })
  })

  describe('checkToolWhitelist', () => {
    it('passes for whitelisted mutation tool', () => {
      const result = checkToolWhitelist(makeAgent(), makeTool(), makeAction())
      expect(result.ok).toBe(true)
    })

    it('rejects missing tool with 403 tool_not_whitelisted', () => {
      const result = checkToolWhitelist(makeAgent(), null, makeAction())
      expect(result).toMatchObject({ ok: false, status: 403, code: 'tool_not_whitelisted' })
    })

    it('rejects tool dropped from allowedTools with 403', () => {
      const result = checkToolWhitelist(
        makeAgent({ allowedTools: [] }),
        makeTool(),
        makeAction(),
      )
      expect(result).toMatchObject({ ok: false, status: 403, code: 'tool_not_whitelisted' })
    })

    it('rejects non-mutation tool with 403 tool_not_whitelisted', () => {
      const result = checkToolWhitelist(
        makeAgent(),
        makeTool({ isMutation: false }),
        makeAction(),
      )
      expect(result).toMatchObject({ ok: false, status: 403, code: 'tool_not_whitelisted' })
    })

    it('rejects read-only override with 403 read_only_agent', () => {
      const result = checkToolWhitelist(makeAgent(), makeTool(), makeAction(), {
        mutationPolicyOverride: 'read-only',
      })
      expect(result).toMatchObject({ ok: false, status: 403, code: 'read_only_agent' })
    })
  })

  describe('checkAttachmentScope', () => {
    it('passes when attachmentIds is empty', async () => {
      const result = await checkAttachmentScope(makeAction({ attachmentIds: [] }), makeCtx())
      expect(result.ok).toBe(true)
      expect(findWithDecryptionMock).not.toHaveBeenCalled()
    })

    it('passes when every attachment belongs to the caller tenant', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([
        { id: 'a-1', tenantId: 'tenant-1', organizationId: 'org-1' },
        { id: 'a-2', tenantId: 'tenant-1', organizationId: 'org-1' },
      ])
      const result = await checkAttachmentScope(
        makeAction({ attachmentIds: ['a-1', 'a-2'] }),
        makeCtx(),
      )
      expect(result.ok).toBe(true)
    })

    it('rejects cross-tenant attachment id with 403', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([
        { id: 'a-1', tenantId: 'tenant-1', organizationId: 'org-1' },
        { id: 'a-2', tenantId: 'tenant-2', organizationId: 'org-x' },
      ])
      const result = await checkAttachmentScope(
        makeAction({ attachmentIds: ['a-1', 'a-2'] }),
        makeCtx(),
      )
      expect(result).toMatchObject({ ok: false, status: 403, code: 'attachment_cross_tenant' })
    })

    it('rejects when lookup returns fewer rows than requested ids', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([
        { id: 'a-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ])
      const result = await checkAttachmentScope(
        makeAction({ attachmentIds: ['a-1', 'a-2'] }),
        makeCtx(),
      )
      expect(result).toMatchObject({ ok: false, status: 403, code: 'attachment_cross_tenant' })
    })
  })

  describe('checkRecordVersion (single-record)', () => {
    it('passes when stored version matches current', async () => {
      const result = await checkRecordVersion(makeAction(), makeTool(), makeCtx())
      expect(result.ok).toBe(true)
    })

    it('rejects mismatch with 412 stale_version', async () => {
      const result = await checkRecordVersion(
        makeAction({ recordVersion: 'v-1' } as never),
        makeTool({
          loadBeforeRecord: async () => ({
            recordId: 'p-1',
            entityType: 'catalog.product',
            recordVersion: 'v-2',
            before: { title: 'Old' },
          }),
        }),
        makeCtx(),
      )
      expect(result).toMatchObject({ ok: false, status: 412, code: 'stale_version' })
    })

    it('rejects schema drift with 412 schema_drift', async () => {
      const tool = makeTool({
        inputSchema: z.object({ productId: z.string(), newTitle: z.string() }),
      })
      const result = await checkRecordVersion(
        makeAction({ normalizedInput: { productId: 'p-1', patch: { title: 'x' } } } as never),
        tool,
        makeCtx(),
      )
      expect(result).toMatchObject({ ok: false, status: 412, code: 'schema_drift' })
    })
  })

  describe('checkRecordVersion (batch)', () => {
    function makeBatchAction() {
      return makeAction({
        records: [
          {
            recordId: 'r-1',
            entityType: 'catalog.product',
            label: 'P1',
            fieldDiff: [],
            recordVersion: 'v-1',
          },
          {
            recordId: 'r-2',
            entityType: 'catalog.product',
            label: 'P2',
            fieldDiff: [],
            recordVersion: 'v-1',
          },
          {
            recordId: 'r-3',
            entityType: 'catalog.product',
            label: 'P3',
            fieldDiff: [],
            recordVersion: 'v-1',
          },
        ],
        normalizedInput: {
          records: [
            { recordId: 'r-1', patch: { title: 'a' } },
            { recordId: 'r-2', patch: { title: 'b' } },
            { recordId: 'r-3', patch: { title: 'c' } },
          ],
        },
      } as never)
    }

    function makeBatchTool(currentVersions: Record<string, string>) {
      return makeTool({
        inputSchema: z.object({
          records: z.array(
            z.object({ recordId: z.string(), patch: z.object({ title: z.string() }).partial() }),
          ),
        }),
        isBulk: true,
        loadBeforeRecord: undefined,
        loadBeforeRecords: async () =>
          Object.entries(currentVersions).map(([recordId, recordVersion]) => ({
            recordId,
            entityType: 'catalog.product',
            label: recordId,
            recordVersion,
            before: { title: 'X' },
          })),
      })
    }

    it('partial-stale: returns ok:true + failedRecords[] with only the stale ids', async () => {
      const result = await checkRecordVersion(
        makeBatchAction(),
        makeBatchTool({ 'r-1': 'v-1', 'r-2': 'v-2', 'r-3': 'v-1' }),
        makeCtx(),
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.failedRecords).toEqual([
          {
            recordId: 'r-2',
            error: { code: 'stale_version', message: 'Record version changed since preview.' },
          },
        ])
      }
    })

    it('all stale: returns 412 stale_version', async () => {
      const result = await checkRecordVersion(
        makeBatchAction(),
        makeBatchTool({ 'r-1': 'v-9', 'r-2': 'v-9', 'r-3': 'v-9' }),
        makeCtx(),
      )
      expect(result).toMatchObject({ ok: false, status: 412, code: 'stale_version' })
    })
  })

  describe('runPendingActionRechecks', () => {
    it('runs every guard in order and returns ok when all pass', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([])
      const result = await runPendingActionRechecks({
        action: makeAction(),
        agent: makeAgent(),
        tool: makeTool(),
        ctx: makeCtx(),
        now: new Date('2026-04-18T10:30:00.000Z'),
      })
      expect(result.ok).toBe(true)
    })

    it('bubbles up first failure (expired before agent check)', async () => {
      const result = await runPendingActionRechecks({
        action: makeAction(),
        agent: null,
        tool: null,
        ctx: makeCtx(),
        now: new Date('2026-04-18T12:00:00.000Z'),
      })
      expect(result).toMatchObject({ ok: false, code: 'expired' })
    })
  })
})
