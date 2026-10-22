import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import {
  PENDING_ACTION_RECHECK_CODES,
  isRawToolPendingAction,
  runPendingActionRechecks,
  type PendingActionAuthContext,
} from '../pending-action-recheck'
import { DEFAULT_MCP_EXPOSURE_CONFIG, type McpExposureConfig } from '../mcp-exposure'
import { AI_RAW_TOOL_AGENT_ID } from '../pending-action-types'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import type { AiPendingAction } from '../../data/entities'

const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadAclMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

jest.mock('@open-mercato/core/modules/api_keys/data/entities', () => ({
  ApiKey: class ApiKey {},
}))

const NOW = new Date('2026-10-22T10:30:00.000Z')
const API_KEY_ID = 'key-1'

function makeAction(overrides: Partial<AiPendingAction> = {}): AiPendingAction {
  return {
    id: 'pa_1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: AI_RAW_TOOL_AGENT_ID,
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [],
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
    createdByUserId: 'requester-1',
    channel: 'mcp',
    apiKeyId: API_KEY_ID,
    correlationId: 'corr-1',
    createdAt: new Date('2026-10-22T10:00:00.000Z'),
    expiresAt: new Date('2026-10-23T10:00:00.000Z'),
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
    requiredFeatures: ['catalog.agent'],
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
    requiredFeatures: ['catalog.manage'],
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
    userId: 'approver-1',
    userFeatures: ['ai_assistant.view', 'ai_assistant.pending_actions.approve', 'catalog.manage'],
    isSuperAdmin: false,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'rbacService') return { loadAcl: loadAclMock }
        throw new Error(`unknown dep ${name}`)
      },
    } as unknown as AwilixContainer,
    em: {} as never,
    ...overrides,
  }
}

function exposure(overrides: Partial<McpExposureConfig> = {}): McpExposureConfig {
  return { ...DEFAULT_MCP_EXPOSURE_CONFIG, deny: [], ...overrides }
}

function liveApiKey(overrides: Record<string, unknown> = {}) {
  return {
    id: API_KEY_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    deletedAt: null,
    expiresAt: null,
    ...overrides,
  }
}

describe('pending-action-recheck channel branching', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
    loadAclMock.mockReset()
    findOneWithDecryptionMock.mockResolvedValue(liveApiKey())
    loadAclMock.mockResolvedValue({ features: ['catalog.manage'], isSuperAdmin: false, organizations: null })
  })

  it('registers the new codes in the exhaustive code list', () => {
    expect(PENDING_ACTION_RECHECK_CODES).toEqual(
      expect.arrayContaining([
        'tool_not_exposed',
        'approver_features_denied',
        'requester_revoked',
        'requester_features_denied',
      ]),
    )
  })

  it('classifies only non-agent rows carrying the raw-tool agent id as raw', () => {
    expect(isRawToolPendingAction(makeAction())).toBe(true)
    expect(isRawToolPendingAction(makeAction({ channel: 'tools-api' }))).toBe(true)
    expect(isRawToolPendingAction(makeAction({ channel: 'agent' }))).toBe(false)
    expect(
      isRawToolPendingAction(makeAction({ agentId: 'catalog.merchandising_assistant' })),
    ).toBe(false)
  })

  it('raw rows skip the agent guards and pass with a valid key and requester', async () => {
    const result = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(result).toEqual({ ok: true })
    expect(loadAclMock).toHaveBeenCalledWith(`api_key:${API_KEY_ID}`, {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })

  it('raw rows denied by the exposure denylist fail with tool_not_exposed', async () => {
    const result = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure({ deny: ['catalog.*'] }),
    })
    expect(result).toMatchObject({ ok: false, status: 403, code: 'tool_not_exposed' })
  })

  it('raw rows fail with tool_not_exposed when the tool is gone or no longer a mutation', async () => {
    const missing = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: undefined,
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(missing).toMatchObject({ ok: false, code: 'tool_not_exposed' })

    const readOnly = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: makeTool({ isMutation: false }),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(readOnly).toMatchObject({ ok: false, code: 'tool_not_exposed' })
  })

  it('raw rows fail with approver_features_denied when the approver lacks the tool feature', async () => {
    const result = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx({ userFeatures: ['ai_assistant.view', 'ai_assistant.pending_actions.approve'] }),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(result).toMatchObject({ ok: false, status: 403, code: 'approver_features_denied' })
  })

  it('raw rows fail with requester_revoked when the API key is deleted', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(null)
    const result = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(result).toMatchObject({ ok: false, status: 403, code: 'requester_revoked' })
  })

  it('raw rows fail with requester_revoked when the API key expired', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(
      liveApiKey({ expiresAt: new Date('2026-10-22T10:00:00.000Z') }),
    )
    const result = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(result).toMatchObject({ ok: false, status: 403, code: 'requester_revoked' })
  })

  it('raw rows fail with requester_revoked when the API key belongs to another tenant', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(liveApiKey({ tenantId: 'tenant-2' }))
    const result = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(result).toMatchObject({ ok: false, code: 'requester_revoked' })
  })

  it('raw rows fail with requester_features_denied when the API key lost the tool feature', async () => {
    loadAclMock.mockResolvedValueOnce({ features: ['catalog.view'], isSuperAdmin: false, organizations: null })
    const result = await runPendingActionRechecks({
      action: makeAction(),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(result).toMatchObject({ ok: false, status: 403, code: 'requester_features_denied' })
  })

  it('raw rows without an API key check the creator user ACL', async () => {
    loadAclMock.mockResolvedValueOnce({ features: [], isSuperAdmin: false, organizations: null })
    const result = await runPendingActionRechecks({
      action: makeAction({ apiKeyId: null, channel: 'tools-api' }),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(loadAclMock).toHaveBeenCalledWith('requester-1', {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toMatchObject({ ok: false, code: 'requester_features_denied' })
  })

  it('raw rows still enforce status and schema drift', async () => {
    const expired = await runPendingActionRechecks({
      action: makeAction({ expiresAt: new Date('2026-10-22T10:00:00.000Z') }),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(expired).toMatchObject({ ok: false, code: 'expired' })

    const drift = await runPendingActionRechecks({
      action: makeAction({ normalizedInput: { wrong: true } as never }),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(drift).toMatchObject({ ok: false, code: 'schema_drift' })
  })

  it('agent rows keep the agent guards and ignore the raw-tool checks', async () => {
    const action = makeAction({
      agentId: 'catalog.merchandising_assistant',
      channel: 'agent',
      apiKeyId: null,
    })
    const unknownAgent = await runPendingActionRechecks({
      action,
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure({ deny: ['catalog.*'] }),
    })
    expect(unknownAgent).toMatchObject({ ok: false, code: 'agent_unknown' })

    const featuresDenied = await runPendingActionRechecks({
      action,
      agent: makeAgent(),
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure({ deny: ['catalog.*'] }),
    })
    expect(featuresDenied).toMatchObject({ ok: false, code: 'agent_features_denied' })

    const passes = await runPendingActionRechecks({
      action,
      agent: makeAgent({ requiredFeatures: [] }),
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure({ deny: ['catalog.*'] }),
    })
    expect(passes).toEqual({ ok: true })
    expect(loadAclMock).not.toHaveBeenCalled()
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('agent-channel rows that happen to use the raw-tool id keep the agent guards', async () => {
    const result = await runPendingActionRechecks({
      action: makeAction({ channel: 'agent' }),
      agent: null,
      tool: makeTool(),
      ctx: makeCtx(),
      now: NOW,
      exposureConfig: exposure(),
    })
    expect(result).toMatchObject({ ok: false, code: 'agent_unknown' })
  })
})
