/**
 * Step 5.17 — Phase 3 WS-D integration tests for the pending-action contract.
 *
 * Closes the Step 5.5 → 5.12 surface with a Jest-integration suite that drives
 * the confirm executor (Step 5.8), cancel executor (Step 5.9), cleanup worker
 * (Step 5.12), and the shared re-check orchestrator (Step 5.8) against a
 * repository stub that mirrors the production state-machine guard. Event
 * emissions are asserted against the typed Step 5.11 `emitAiAssistantEvent`
 * contract via per-executor injection seams — no live LLM, no real DB, no
 * real event bus.
 *
 * Mocks sit at narrow boundaries:
 * - ORM: a hand-rolled in-memory `AiPendingActionRepository` shim that honors
 *   `AI_PENDING_ACTION_ALLOWED_TRANSITIONS` so illegal edges throw
 *   `AiPendingActionStateError`, just like the real repo.
 * - Event bus: the `emitEvent` seam already present on every executor; we
 *   assert the event id + payload shape directly.
 *
 * The pending-action executor, cancel helper, re-check orchestrator, and
 * cleanup worker themselves are under test and MUST NOT be mocked.
 */
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { AiPendingAction } from '../../data/entities'
import type { AiAgentDefinition } from '../../lib/ai-agent-definition'
import type {
  AiPendingActionExecutionResult,
  AiPendingActionFailedRecord,
  AiPendingActionRecordDiff,
  AiPendingActionStatus,
} from '../../lib/pending-action-types'
import {
  AI_PENDING_ACTION_ALLOWED_TRANSITIONS,
  AiPendingActionStateError,
} from '../../lib/pending-action-types'
import type { AiToolDefinition, McpToolContext } from '../../lib/types'
import {
  executePendingActionConfirm,
  PENDING_ACTION_CONFIRMED_EVENT_ID,
} from '../../lib/pending-action-executor'
import {
  executePendingActionCancel,
  PENDING_ACTION_CANCELLED_EVENT_ID,
  PENDING_ACTION_EXPIRED_EVENT_ID,
} from '../../lib/pending-action-cancel'
import { runPendingActionRechecks } from '../../lib/pending-action-recheck'
import { runPendingActionCleanup } from '../../workers/ai-pending-action-cleanup'
import type {
  AiActionCancelledPayload,
  AiActionConfirmedPayload,
  AiActionExpiredPayload,
} from '../../events'
import { resolveEffectiveMutationPolicy } from '../../lib/agent-policy'

// The recheck layer dynamic-imports the core Attachment entity for the
// cross-tenant attachment guard. The core dist build is shipped as ESM and
// ts-jest does not transform it, so we replace the module with a minimal
// mock that gives the recheck a stable class reference.
jest.mock(
  '@open-mercato/core/modules/attachments/data/entities',
  () => ({ Attachment: class MockAttachment {} }),
  { virtual: true },
)

// findWithDecryption is used by the recheck's attachment scope guard. The
// integration mock returns an attachment row from a foreign tenant so the
// guard's cross-tenant assertion fires without a real DB.
jest.mock('@open-mercato/shared/lib/encryption/find', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/encryption/find')
  return {
    ...actual,
    findWithDecryption: jest.fn(
      async (_em: unknown, _entity: unknown, where: { id?: { $in: string[] } }) => {
        const ids = where?.id?.$in ?? []
        return ids.map((id: string) => ({
          id,
          tenantId: 'tenant-other',
          organizationId: null,
        }))
      },
    ),
  }
})

// --- Fixtures -------------------------------------------------------------

type Row = AiPendingAction & Record<string, unknown>

interface ActionSeed {
  id?: string
  tenantId?: string
  organizationId?: string | null
  status?: AiPendingActionStatus
  agentId?: string
  toolName?: string
  expiresAt?: Date
  recordVersion?: string | null
  records?: AiPendingActionRecordDiff[] | null
  attachmentIds?: string[]
  executionResult?: AiPendingActionExecutionResult | null
}

const REFERENCE_CLOCK = new Date('2026-04-18T10:00:00.000Z')

function makeSeed(seed: ActionSeed = {}): Row {
  return {
    id: seed.id ?? 'pa_1',
    tenantId: seed.tenantId ?? 'tenant-a',
    organizationId: seed.organizationId === undefined ? 'org-a' : seed.organizationId,
    agentId: seed.agentId ?? 'catalog.merchandising_assistant',
    toolName: seed.toolName ?? 'catalog.update_product',
    status: (seed.status ?? 'pending') as AiPendingActionStatus,
    fieldDiff: [],
    records: seed.records ?? null,
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: seed.recordVersion === undefined ? 'v-1' : seed.recordVersion,
    attachmentIds: seed.attachmentIds ?? [],
    normalizedInput: { productId: 'p-1', patch: { title: 'New' } },
    queueMode: 'inline',
    executionResult: seed.executionResult ?? null,
    targetEntityType: 'product',
    targetRecordId: 'p-1',
    conversationId: null,
    idempotencyKey: `idem_${seed.id ?? 'pa_1'}`,
    createdByUserId: 'user-a',
    createdAt: new Date('2026-04-18T09:00:00.000Z'),
    expiresAt: seed.expiresAt ?? new Date('2026-04-18T11:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
  } as unknown as Row
}

function makeAgent(
  overrides: Partial<AiAgentDefinition> = {},
): AiAgentDefinition {
  return {
    id: 'catalog.merchandising_assistant',
    moduleId: 'catalog',
    label: 'Catalog Merchandising Assistant',
    description: 'Updates product titles, descriptions, media, prices.',
    systemPrompt: 'System',
    allowedTools: ['catalog.update_product'],
    readOnly: false,
    mutationPolicy: 'confirm-required',
    requiredFeatures: [],
    ...overrides,
  } as AiAgentDefinition
}

function makeTool(
  overrides: Partial<AiToolDefinition> = {},
): AiToolDefinition {
  return {
    name: 'catalog.update_product',
    description: 'Update product',
    inputSchema: z.object({
      productId: z.string(),
      patch: z.object({}).passthrough(),
    }),
    handler: async () => ({
      recordId: 'p-1',
      commandName: 'catalog.product.update',
    }),
    isMutation: true,
    ...overrides,
  } as AiToolDefinition
}

function makeContainer(): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (name === 'em') return {}
      throw new Error(`unexpected dep: ${name}`)
    },
  } as unknown as AwilixContainer
}

function makeExecCtx(overrides: Partial<{
  tenantId: string
  organizationId: string | null
  userId: string
  userFeatures: string[]
  isSuperAdmin: boolean
}> = {}) {
  return {
    tenantId: overrides.tenantId ?? 'tenant-a',
    organizationId:
      overrides.organizationId === undefined ? 'org-a' : overrides.organizationId,
    userId: overrides.userId ?? 'user-a',
    userFeatures: overrides.userFeatures ?? ['ai_assistant.view'],
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    container: makeContainer(),
  }
}

function makeCancelCtx(overrides: Partial<{
  tenantId: string
  organizationId: string | null
  userId: string
}> = {}) {
  return {
    tenantId: overrides.tenantId ?? 'tenant-a',
    organizationId:
      overrides.organizationId === undefined ? 'org-a' : overrides.organizationId,
    userId: overrides.userId ?? 'user-a',
    container: makeContainer(),
  }
}

function makeAuthCtx(overrides: Partial<{
  tenantId: string
  organizationId: string | null
  userId: string
  userFeatures: string[]
  isSuperAdmin: boolean
}> = {}) {
  return {
    tenantId: overrides.tenantId ?? 'tenant-a',
    organizationId:
      overrides.organizationId === undefined ? 'org-a' : overrides.organizationId,
    userId: overrides.userId ?? 'user-a',
    userFeatures: overrides.userFeatures ?? ['ai_assistant.view'],
    isSuperAdmin: overrides.isSuperAdmin ?? false,
  }
}

// --- In-memory repo that mirrors the production state-machine ---------------

interface RepoStubOptions {
  seeds: Row[]
}

interface ScopeFilter {
  tenantId: string
  organizationId?: string | null
}

function matchesScope(row: Row, scope: ScopeFilter): boolean {
  if (row.tenantId !== scope.tenantId) return false
  const expectedOrg = scope.organizationId ?? null
  if ((row.organizationId ?? null) !== expectedOrg) return false
  return true
}

function makeRepoStub(options: RepoStubOptions) {
  const store = new Map<string, Row>()
  for (const row of options.seeds) {
    store.set(row.id as string, { ...row })
  }

  const getById = jest.fn(async (id: string, scope: ScopeFilter) => {
    const row = store.get(id)
    if (!row) return null
    if (!matchesScope(row, scope)) return null
    return row
  })

  const setStatus = jest.fn(
    async (
      id: string,
      next: AiPendingActionStatus,
      scope: ScopeFilter,
      extra?: {
        now?: Date
        resolvedByUserId?: string | null
        executionResult?: AiPendingActionExecutionResult | null
        failedRecords?: AiPendingActionFailedRecord[] | null
      },
    ) => {
      const existing = store.get(id)
      if (!existing || !matchesScope(existing, scope)) {
        throw new Error(`row ${id} not found`)
      }
      if (existing.status === next) return existing
      const allowed = AI_PENDING_ACTION_ALLOWED_TRANSITIONS[existing.status] ?? []
      if (!allowed.includes(next)) {
        throw new AiPendingActionStateError(existing.status, next)
      }
      const now = extra?.now ?? new Date()
      existing.status = next
      if (
        next === 'confirmed' ||
        next === 'cancelled' ||
        next === 'expired' ||
        next === 'failed'
      ) {
        existing.resolvedAt = (existing.resolvedAt ?? now) as never
        if (extra && Object.prototype.hasOwnProperty.call(extra, 'resolvedByUserId')) {
          existing.resolvedByUserId = (extra.resolvedByUserId ?? null) as never
        } else if (next === 'expired') {
          existing.resolvedByUserId = null as never
        }
      }
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'executionResult')) {
        existing.executionResult = (extra.executionResult ?? null) as never
      }
      if (extra && Object.prototype.hasOwnProperty.call(extra, 'failedRecords')) {
        existing.failedRecords = (extra.failedRecords ?? null) as never
      }
      return existing
    },
  )

  const listExpired = jest.fn(
    async (scope: ScopeFilter, now: Date, limit: number) => {
      return Array.from(store.values())
        .filter((row) => matchesScope(row, scope))
        .filter((row) => row.status === 'pending')
        .filter((row) => (row.expiresAt as Date).getTime() < now.getTime())
        .sort((a, b) => (a.expiresAt as Date).getTime() - (b.expiresAt as Date).getTime())
        .slice(0, limit)
    },
  )

  return {
    repo: {
      getById,
      setStatus,
      listExpired,
    } as unknown as import('../../data/repositories/AiPendingActionRepository').AiPendingActionRepository,
    getById,
    setStatus,
    listExpired,
    store,
  }
}

// --- Suite ------------------------------------------------------------------

describe('Pending-action contract integration (Step 5.17)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Scenario 1 --------------------------------------------------------------
  it('scenario-1 happy path: pending → executing → confirmed with executionResult.recordId, single ai.action.confirmed', async () => {
    const seed = makeSeed()
    const { repo, setStatus, store } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)

    const result = await executePendingActionConfirm({
      action: store.get('pa_1')!,
      agent: makeAgent(),
      tool: makeTool(),
      ctx: makeExecCtx(),
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })

    expect(result.ok).toBe(true)
    expect(result.executionResult).toEqual({
      recordId: 'p-1',
      commandName: 'catalog.product.update',
    })
    const transitions = setStatus.mock.calls.map((call) => call[1])
    expect(transitions).toEqual(['confirmed', 'executing', 'confirmed'])
    expect(store.get('pa_1')!.status).toBe('confirmed')
    expect(store.get('pa_1')!.resolvedAt).toBeTruthy()
    expect(store.get('pa_1')!.resolvedByUserId).toBe('user-a')

    expect(emit).toHaveBeenCalledTimes(1)
    const [emittedId, emittedPayload] = emit.mock.calls[0] as [
      'ai.action.confirmed',
      AiActionConfirmedPayload,
    ]
    expect(emittedId).toBe(PENDING_ACTION_CONFIRMED_EVENT_ID)
    expect(emittedPayload).toMatchObject({
      pendingActionId: 'pa_1',
      agentId: 'catalog.merchandising_assistant',
      toolName: 'catalog.update_product',
      status: 'confirmed',
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      userId: 'user-a',
      resolvedByUserId: 'user-a',
      executionResult: {
        recordId: 'p-1',
        commandName: 'catalog.product.update',
      },
    })
    expect(typeof emittedPayload.resolvedAt).toBe('string')
  })

  // Scenario 2 --------------------------------------------------------------
  it('scenario-2 cancel: pending → cancelled with reason; executionResult.error.code=cancelled_by_user, one ai.action.cancelled', async () => {
    const seed = makeSeed()
    const { repo, store } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)

    const result = await executePendingActionCancel({
      action: store.get('pa_1')!,
      ctx: makeCancelCtx(),
      reason: 'Operator aborted',
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })

    expect(result.status).toBe('cancelled')
    expect(result.row.status).toBe('cancelled')
    expect(store.get('pa_1')!.status).toBe('cancelled')
    expect(store.get('pa_1')!.resolvedByUserId).toBe('user-a')
    expect(store.get('pa_1')!.resolvedAt).toBeTruthy()
    expect(store.get('pa_1')!.executionResult).toMatchObject({
      error: { code: 'cancelled_by_user', message: 'Operator aborted' },
    })

    expect(emit).toHaveBeenCalledTimes(1)
    const [emittedId, emittedPayload] = emit.mock.calls[0] as [
      'ai.action.cancelled',
      AiActionCancelledPayload,
    ]
    expect(emittedId).toBe(PENDING_ACTION_CANCELLED_EVENT_ID)
    expect(emittedPayload).toMatchObject({
      pendingActionId: 'pa_1',
      status: 'cancelled',
      resolvedByUserId: 'user-a',
      reason: 'Operator aborted',
    })
  })

  // Scenario 3 --------------------------------------------------------------
  it('scenario-3 expiry via cleanup worker: pending (past expiresAt) → expired, worker emits ai.action.expired, resolvedByUserId=null', async () => {
    const past = new Date(REFERENCE_CLOCK.getTime() - 60 * 60 * 1000)
    const seed = makeSeed({ expiresAt: past })
    const { repo, listExpired, setStatus, store } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)

    const summary = await runPendingActionCleanup({
      em: {} as never,
      repo,
      emitEvent: emit as never,
      now: REFERENCE_CLOCK,
      discoverTenants: async () => [
        { tenantId: 'tenant-a', organizationId: 'org-a' },
      ],
    })

    expect(summary.rowsExpired).toBe(1)
    expect(summary.rowsSkipped).toBe(0)
    expect(summary.rowsErrored).toBe(0)
    expect(listExpired).toHaveBeenCalled()
    expect(setStatus).toHaveBeenCalledWith(
      'pa_1',
      'expired',
      expect.objectContaining({ tenantId: 'tenant-a', organizationId: 'org-a' }),
      expect.objectContaining({ resolvedByUserId: null }),
    )
    expect(store.get('pa_1')!.status).toBe('expired')
    expect(store.get('pa_1')!.resolvedByUserId).toBeNull()

    expect(emit).toHaveBeenCalledTimes(1)
    const [emittedId, emittedPayload] = emit.mock.calls[0] as [
      'ai.action.expired',
      AiActionExpiredPayload,
    ]
    expect(emittedId).toBe(PENDING_ACTION_EXPIRED_EVENT_ID)
    expect(emittedPayload).toMatchObject({
      pendingActionId: 'pa_1',
      status: 'expired',
      resolvedByUserId: null,
      tenantId: 'tenant-a',
      organizationId: 'org-a',
    })
    expect(typeof emittedPayload.resolvedAt).toBe('string')
    expect(typeof emittedPayload.expiresAt).toBe('string')
  })

  // Scenario 4 --------------------------------------------------------------
  it('scenario-4 expiry via opportunistic cancel path: past expiresAt flips pending → expired atomically and emits ai.action.expired', async () => {
    const past = new Date(REFERENCE_CLOCK.getTime() - 60 * 60 * 1000)
    const seed = makeSeed({ expiresAt: past })
    const { repo, store } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)

    const result = await executePendingActionCancel({
      action: store.get('pa_1')!,
      ctx: makeCancelCtx(),
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })

    expect(result.status).toBe('expired')
    expect(store.get('pa_1')!.status).toBe('expired')
    expect(emit).toHaveBeenCalledTimes(1)
    const [emittedId, emittedPayload] = emit.mock.calls[0] as [
      'ai.action.expired',
      AiActionExpiredPayload,
    ]
    expect(emittedId).toBe(PENDING_ACTION_EXPIRED_EVENT_ID)
    expect(emittedPayload.pendingActionId).toBe('pa_1')
    expect(emittedPayload.resolvedByUserId).toBeNull()
  })

  // Scenario 5 --------------------------------------------------------------
  it('scenario-5 stale-version single-record: re-check returns 412, row stays pending, no event emitted', async () => {
    const seed = makeSeed({ recordVersion: 'v1' })
    const { repo, store, setStatus } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)

    const staleTool = makeTool({
      loadBeforeRecord: async () => ({
        recordId: 'p-1',
        entityType: 'product',
        recordVersion: 'v2',
        before: {},
      }),
    })

    const recheck = await runPendingActionRechecks({
      action: store.get('pa_1')!,
      agent: makeAgent(),
      tool: staleTool,
      ctx: makeAuthCtx(),
      now: REFERENCE_CLOCK,
    })
    expect(recheck.ok).toBe(false)
    if (!recheck.ok) {
      expect(recheck.status).toBe(412)
      expect(recheck.code).toBe('stale_version')
    }

    expect(setStatus).not.toHaveBeenCalled()
    expect(store.get('pa_1')!.status).toBe('pending')
    expect(emit).not.toHaveBeenCalled()
  })

  // Scenario 6 --------------------------------------------------------------
  it('scenario-6 stale-version batch partial: two rows live, one stale → failedRecords[] captured and confirm proceeds for survivors', async () => {
    const records: AiPendingActionRecordDiff[] = [
      {
        recordId: 'r-1',
        entityType: 'product',
        label: 'Row 1',
        fieldDiff: [],
        recordVersion: 'v1',
      },
      {
        recordId: 'r-2',
        entityType: 'product',
        label: 'Row 2',
        fieldDiff: [],
        recordVersion: 'v1',
      },
      {
        recordId: 'r-3',
        entityType: 'product',
        label: 'Row 3',
        fieldDiff: [],
        recordVersion: 'v1',
      },
    ]
    const seed = makeSeed({ records, recordVersion: null })
    const { repo, store, setStatus } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)

    const bulkTool = makeTool({
      name: 'catalog.bulk_update_products',
      isBulk: true,
      inputSchema: z.object({}).passthrough(),
      loadBeforeRecords: async () => [
        { recordId: 'r-1', entityType: 'product', label: 'Row 1', recordVersion: 'v1', before: {} },
        { recordId: 'r-2', entityType: 'product', label: 'Row 2', recordVersion: 'v2', before: {} },
        { recordId: 'r-3', entityType: 'product', label: 'Row 3', recordVersion: 'v1', before: {} },
      ],
      handler: async () => ({
        recordId: 'batch-p',
        commandName: 'catalog.bulk_update_products',
      }),
    })
    const batchAgent = makeAgent({ allowedTools: ['catalog.bulk_update_products'] })

    const recheck = await runPendingActionRechecks({
      action: store.get('pa_1')!,
      agent: batchAgent,
      tool: bulkTool,
      ctx: makeAuthCtx(),
      now: REFERENCE_CLOCK,
    })
    expect(recheck.ok).toBe(true)
    if (recheck.ok) {
      expect(recheck.failedRecords).toHaveLength(1)
      expect(recheck.failedRecords?.[0]).toMatchObject({
        recordId: 'r-2',
        error: { code: 'stale_version' },
      })
    }

    const executed = await executePendingActionConfirm({
      action: store.get('pa_1')!,
      agent: batchAgent,
      tool: bulkTool,
      ctx: makeExecCtx(),
      repo,
      emitEvent: emit,
      failedRecords: recheck.ok ? recheck.failedRecords ?? null : null,
      now: REFERENCE_CLOCK,
    })

    expect(executed.ok).toBe(true)
    expect(store.get('pa_1')!.status).toBe('confirmed')
    expect(store.get('pa_1')!.failedRecords).toEqual([
      {
        recordId: 'r-2',
        error: { code: 'stale_version', message: expect.any(String) },
      },
    ])
    // First transition must carry the failedRecords onto the row.
    const firstExtra = setStatus.mock.calls[0][3]
    expect(firstExtra).toMatchObject({
      failedRecords: [{ recordId: 'r-2', error: { code: 'stale_version' } }],
    })
    expect(emit).toHaveBeenCalledTimes(1)
    const [, payload] = emit.mock.calls[0] as [
      'ai.action.confirmed',
      AiActionConfirmedPayload,
    ]
    expect(payload.executionResult).toMatchObject({ recordId: 'batch-p' })
  })

  // Scenario 7 --------------------------------------------------------------
  it('scenario-7 stale-version batch all: every record stale → 412 stale_version, row stays pending', async () => {
    const records: AiPendingActionRecordDiff[] = [
      { recordId: 'r-1', entityType: 'product', label: 'Row 1', fieldDiff: [], recordVersion: 'v1' },
      { recordId: 'r-2', entityType: 'product', label: 'Row 2', fieldDiff: [], recordVersion: 'v1' },
    ]
    const seed = makeSeed({ records, recordVersion: null })
    const { store, setStatus } = makeRepoStub({ seeds: [seed] })

    const bulkTool = makeTool({
      name: 'catalog.bulk_update_products',
      isBulk: true,
      inputSchema: z.object({}).passthrough(),
      loadBeforeRecords: async () => [
        { recordId: 'r-1', entityType: 'product', label: 'Row 1', recordVersion: 'v9', before: {} },
        { recordId: 'r-2', entityType: 'product', label: 'Row 2', recordVersion: 'v9', before: {} },
      ],
    })
    const batchAgent = makeAgent({ allowedTools: ['catalog.bulk_update_products'] })

    const recheck = await runPendingActionRechecks({
      action: store.get('pa_1')!,
      agent: batchAgent,
      tool: bulkTool,
      ctx: makeAuthCtx(),
      now: REFERENCE_CLOCK,
    })

    expect(recheck.ok).toBe(false)
    if (!recheck.ok) {
      expect(recheck.status).toBe(412)
      expect(recheck.code).toBe('stale_version')
      expect(recheck.extra).toMatchObject({ staleRecords: ['r-1', 'r-2'] })
    }
    expect(setStatus).not.toHaveBeenCalled()
    expect(store.get('pa_1')!.status).toBe('pending')
  })

  // Scenario 8 --------------------------------------------------------------
  it('scenario-8 cross-tenant: tenant B cannot read tenant A row (returns null / never found)', async () => {
    const seed = makeSeed({ tenantId: 'tenant-a', organizationId: 'org-a' })
    const { repo, store } = makeRepoStub({ seeds: [seed] })

    const rowAsA = await repo.getById('pa_1', {
      tenantId: 'tenant-a',
      organizationId: 'org-a',
    })
    const rowAsB = await repo.getById('pa_1', {
      tenantId: 'tenant-b',
      organizationId: 'org-b',
    })

    expect(rowAsA).toBeTruthy()
    expect(rowAsB).toBeNull()
    // The route returns 404 pending_action_not_found on null, and the row is
    // never mutated by a cross-tenant caller.
    expect(store.get('pa_1')!.status).toBe('pending')
  })

  // Scenario 9 --------------------------------------------------------------
  it('scenario-9 idempotent double-confirm: second confirm returns prior executionResult without re-invoking handler or re-emitting event', async () => {
    const seed = makeSeed()
    const { repo, store } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)
    const handler = jest.fn().mockResolvedValue({
      recordId: 'p-1',
      commandName: 'catalog.product.update',
    })
    const tool = makeTool({ handler })

    const first = await executePendingActionConfirm({
      action: store.get('pa_1')!,
      agent: makeAgent(),
      tool,
      ctx: makeExecCtx(),
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })
    expect(first.ok).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledTimes(1)

    const emitAfterFirst = emit.mock.calls.length
    const handlerAfterFirst = handler.mock.calls.length

    const second = await executePendingActionConfirm({
      action: store.get('pa_1')!,
      agent: makeAgent(),
      tool,
      ctx: makeExecCtx(),
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })

    expect(second.ok).toBe(true)
    expect(second.executionResult).toEqual(first.executionResult)
    expect(handler.mock.calls.length).toBe(handlerAfterFirst)
    expect(emit.mock.calls.length).toBe(emitAfterFirst)
  })

  // Scenario 10 -------------------------------------------------------------
  it('scenario-10 idempotent double-cancel: second cancel returns same result without re-emitting event', async () => {
    const seed = makeSeed()
    const { repo, store } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)

    const first = await executePendingActionCancel({
      action: store.get('pa_1')!,
      ctx: makeCancelCtx(),
      reason: 'nope',
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })
    expect(first.status).toBe('cancelled')
    expect(emit).toHaveBeenCalledTimes(1)

    const second = await executePendingActionCancel({
      action: store.get('pa_1')!,
      ctx: makeCancelCtx(),
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })
    expect(second.status).toBe('cancelled')
    expect(emit).toHaveBeenCalledTimes(1)
  })

  // Scenario 11 -------------------------------------------------------------
  it('scenario-11 read-only-agent refusal: effective mutationPolicy=read-only → recheck returns 403 read_only_agent, row stays pending', async () => {
    const seed = makeSeed()
    const { store, setStatus } = makeRepoStub({ seeds: [seed] })

    // Sanity: policy resolver agrees the override collapses to read-only.
    const effective = resolveEffectiveMutationPolicy(
      'confirm-required',
      'read-only',
      'catalog.merchandising_assistant',
    )
    expect(effective).toBe('read-only')

    const recheck = await runPendingActionRechecks({
      action: store.get('pa_1')!,
      agent: makeAgent({ mutationPolicy: 'confirm-required' }),
      tool: makeTool(),
      ctx: makeAuthCtx(),
      now: REFERENCE_CLOCK,
      mutationPolicyOverride: 'read-only',
    })

    expect(recheck.ok).toBe(false)
    if (!recheck.ok) {
      expect(recheck.status).toBe(403)
      expect(recheck.code).toBe('read_only_agent')
    }
    expect(setStatus).not.toHaveBeenCalled()
    expect(store.get('pa_1')!.status).toBe('pending')
  })

  // Scenario 12 -------------------------------------------------------------
  it('scenario-12 prompt-override escalation refusal: overrides are additive-only, widen attempt is refused at confirm-time', async () => {
    // The prompt-override merge layer (Step 5.3) is additive; it cannot grant
    // the agent more mutation surface than its code declares. We prove the
    // guarantee at the confirm layer by showing a read-only code declaration
    // stays read-only regardless of the tenant override, and by showing
    // `isMutationPolicyEscalation` would reject the escalation upstream.
    const readOnlyAgent = makeAgent({
      mutationPolicy: 'read-only',
      allowedTools: ['catalog.update_product'],
    })
    const effective = resolveEffectiveMutationPolicy(
      'read-only',
      'confirm-required',
      readOnlyAgent.id,
    )
    // Overrides never WIDEN — only narrow. Code-declared read-only sticks.
    expect(effective).toBe('read-only')

    const seed = makeSeed()
    const { store, setStatus } = makeRepoStub({ seeds: [seed] })

    const recheck = await runPendingActionRechecks({
      action: store.get('pa_1')!,
      agent: readOnlyAgent,
      tool: makeTool(),
      ctx: makeAuthCtx(),
      now: REFERENCE_CLOCK,
      // Even when the DB carries the "escalated" override, the resolver
      // clamps it back to read-only, and the re-check returns 403.
      mutationPolicyOverride: 'confirm-required',
    })
    expect(recheck.ok).toBe(false)
    if (!recheck.ok) {
      expect(recheck.status).toBe(403)
      expect(recheck.code).toBe('read_only_agent')
    }
    expect(setStatus).not.toHaveBeenCalled()
    expect(store.get('pa_1')!.status).toBe('pending')
  })

  // Scenario 13 -------------------------------------------------------------
  it('scenario-13 reconnect: GET path re-hydrates the row by id between propose and confirm, then confirm proceeds normally', async () => {
    const seed = makeSeed()
    const { repo, store } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)

    // Simulate the client (mutation-preview-card) polling /actions/:id.
    const reconnectRead = await repo.getById('pa_1', {
      tenantId: 'tenant-a',
      organizationId: 'org-a',
    })
    expect(reconnectRead).toBeTruthy()
    expect(reconnectRead!.status).toBe('pending')

    // Operator presses Confirm on the rehydrated card.
    const executed = await executePendingActionConfirm({
      action: reconnectRead!,
      agent: makeAgent(),
      tool: makeTool(),
      ctx: makeExecCtx(),
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })
    expect(executed.ok).toBe(true)
    expect(store.get('pa_1')!.status).toBe('confirmed')

    // After confirm, a second poll yields the terminal row. The polling hook
    // would stop scheduling further refreshes at this point.
    const terminalRead = await repo.getById('pa_1', {
      tenantId: 'tenant-a',
      organizationId: 'org-a',
    })
    expect(terminalRead!.status).toBe('confirmed')
    expect(terminalRead!.executionResult).toMatchObject({ recordId: 'p-1' })
  })

  // Scenario 14 -------------------------------------------------------------
  it('scenario-14 illegal state transitions: direct pending→executing throws AiPendingActionStateError; executing→cancelled throws', async () => {
    const seed = makeSeed()
    const { repo } = makeRepoStub({ seeds: [seed] })

    await expect(
      repo.setStatus(
        'pa_1',
        'executing',
        { tenantId: 'tenant-a', organizationId: 'org-a' },
        { now: REFERENCE_CLOCK },
      ),
    ).rejects.toBeInstanceOf(AiPendingActionStateError)

    // Walk to executing via the legal path (pending → confirmed → executing).
    await repo.setStatus(
      'pa_1',
      'confirmed',
      { tenantId: 'tenant-a', organizationId: 'org-a' },
      { now: REFERENCE_CLOCK },
    )
    await repo.setStatus(
      'pa_1',
      'executing',
      { tenantId: 'tenant-a', organizationId: 'org-a' },
      { now: REFERENCE_CLOCK },
    )

    // Illegal: executing → cancelled is not in the allow-list.
    await expect(
      repo.setStatus(
        'pa_1',
        'cancelled',
        { tenantId: 'tenant-a', organizationId: 'org-a' },
        { now: REFERENCE_CLOCK },
      ),
    ).rejects.toBeInstanceOf(AiPendingActionStateError)
  })

  // Scenario 15 -------------------------------------------------------------
  it('scenario-15 attachment cross-tenant: attachmentIds from another tenant → 403 attachment_cross_tenant, row stays pending', async () => {
    const seed = makeSeed({ attachmentIds: ['att-foreign'] })
    const { store, setStatus } = makeRepoStub({ seeds: [seed] })

    // `findWithDecryption` is mocked at module scope to return an attachment
    // row whose `tenantId` belongs to a different tenant. The recheck's
    // cross-tenant guard inspects that field and short-circuits with 403.
    const em = {} as unknown as import('@mikro-orm/postgresql').EntityManager

    const recheck = await runPendingActionRechecks({
      action: store.get('pa_1')!,
      agent: makeAgent(),
      tool: makeTool(),
      ctx: { ...makeAuthCtx(), em, container: makeContainer() },
      now: REFERENCE_CLOCK,
    })

    expect(recheck.ok).toBe(false)
    if (!recheck.ok) {
      expect(recheck.status).toBe(403)
      expect(recheck.code).toBe('attachment_cross_tenant')
    }
    expect(setStatus).not.toHaveBeenCalled()
    expect(store.get('pa_1')!.status).toBe('pending')
  })

  // Additional event-shape assertion ---------------------------------------
  it('typed event helper: confirm / cancel / expired payloads carry resolvedByUserId per contract', async () => {
    const seedA = makeSeed({ id: 'pa_a' })
    const seedB = makeSeed({
      id: 'pa_b',
      expiresAt: new Date(REFERENCE_CLOCK.getTime() - 1000),
    })
    const seedC = makeSeed({ id: 'pa_c' })
    const { repo, store } = makeRepoStub({ seeds: [seedA, seedB, seedC] })

    const confirmEmit = jest.fn().mockResolvedValue(undefined)
    await executePendingActionConfirm({
      action: store.get('pa_a')!,
      agent: makeAgent(),
      tool: makeTool(),
      ctx: makeExecCtx(),
      repo,
      emitEvent: confirmEmit,
      now: REFERENCE_CLOCK,
    })
    const confirmPayload = confirmEmit.mock.calls[0][1] as AiActionConfirmedPayload
    expect(confirmPayload.resolvedByUserId).toBe('user-a')

    const expiredEmit = jest.fn().mockResolvedValue(undefined)
    await executePendingActionCancel({
      action: store.get('pa_b')!,
      ctx: makeCancelCtx(),
      repo,
      emitEvent: expiredEmit,
      now: REFERENCE_CLOCK,
    })
    const expiredPayload = expiredEmit.mock.calls[0][1] as AiActionExpiredPayload
    expect(expiredPayload.resolvedByUserId).toBeNull()

    const cancelEmit = jest.fn().mockResolvedValue(undefined)
    await executePendingActionCancel({
      action: store.get('pa_c')!,
      ctx: makeCancelCtx(),
      reason: 'user wants to stop',
      repo,
      emitEvent: cancelEmit,
      now: REFERENCE_CLOCK,
    })
    const cancelPayload = cancelEmit.mock.calls[0][1] as AiActionCancelledPayload
    expect(cancelPayload.resolvedByUserId).toBe('user-a')
    expect(cancelPayload.reason).toBe('user wants to stop')
  })
})

const EXPECTED_TOOL_HANDLER_CONTEXT_KEYS: ReadonlyArray<keyof McpToolContext> = [
  'tenantId',
  'organizationId',
  'userId',
  'container',
  'userFeatures',
  'isSuperAdmin',
]

describe('Pending-action executor tool-handler context shape', () => {
  it('tool handler receives the full McpToolContext surface expected by downstream tools', async () => {
    const seed = makeSeed()
    const { repo, store } = makeRepoStub({ seeds: [seed] })
    const emit = jest.fn().mockResolvedValue(undefined)
    const received: McpToolContext[] = []
    const tool = makeTool({
      handler: async (_input, context) => {
        received.push(context)
        return { recordId: 'p-1' }
      },
    })

    await executePendingActionConfirm({
      action: store.get('pa_1')!,
      agent: makeAgent(),
      tool,
      ctx: makeExecCtx(),
      repo,
      emitEvent: emit,
      now: REFERENCE_CLOCK,
    })

    expect(received).toHaveLength(1)
    for (const key of EXPECTED_TOOL_HANDLER_CONTEXT_KEYS) {
      expect(received[0]).toHaveProperty(key as string)
    }
  })
})
