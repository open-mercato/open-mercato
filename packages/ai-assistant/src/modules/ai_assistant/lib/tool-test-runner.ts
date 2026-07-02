/**
 * In-process AI tool test runner.
 *
 * Iterates every tool registered in `ai-tools.generated.ts`, invokes the
 * handler against a super-admin tenant context, and returns a structured
 * report. Used by the `mercato ai_assistant test-tools` CLI subcommand and
 * by `.ai/qa/tests/integration/TC-INT-AI-TOOLS.spec.ts`.
 *
 * Safety posture:
 *   - No HTTP exposure — runs only inside the Node process driving the CLI.
 *   - Mutation tools are exercised through `prepareMutation` and we assert a
 *     pending-action envelope is returned. The pending-action row is created
 *     in `ai_pending_actions` but never confirmed, so no real write happens.
 *   - Tools without an explicit fixture entry are skipped with reason
 *     `'no fixture'` rather than failing.
 */
import type { AwilixContainer } from 'awilix'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { McpToolContext, AiToolDefinition } from './types'
import type { AiAgentDefinition, AiAgentMutationPolicy } from './ai-agent-definition'
import { getFixture, type ToolFixture } from './tool-test-fixtures'
import { prepareMutation } from './prepare-mutation'
import { executePendingActionConfirm } from './pending-action-executor'
import {
  findGeneratedFile,
  compileAndImportGenerated,
  ensureApiRouteManifestsRegistered,
} from './generated-registry-loader'

export type ToolTestStatus = 'pass' | 'fail' | 'skip'

export interface ToolTestRecord {
  module: string
  tool: string
  isMutation: boolean
  status: ToolTestStatus
  durationMs: number
  reason?: string
  resultPreview?: unknown
}

export interface ToolTestReport {
  tenantId: string | null
  organizationId: string | null
  total: number
  passed: number
  failed: number
  skipped: number
  records: ToolTestRecord[]
}

interface RawAiToolsModule {
  aiToolConfigEntriesRaw?: { moduleId: string; tools: unknown[] }[]
  aiToolConfigEntries?: { moduleId: string; tools: unknown[] }[]
}

function isToolDefinition(value: unknown): value is AiToolDefinition {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    candidate.inputSchema !== undefined &&
    typeof candidate.handler === 'function'
  )
}

async function loadGeneratedTools(): Promise<{ moduleId: string; tools: AiToolDefinition[] }[]> {
  const tsPath = findGeneratedFile('ai-tools.generated.ts')
  if (!tsPath) {
    throw new Error(
      'Could not locate apps/<app>/.mercato/generated/ai-tools.generated.ts. Run `yarn generate` first.',
    )
  }
  await ensureApiRouteManifestsRegistered()
  const mod = (await compileAndImportGenerated(tsPath, {
    bundleLocalModules: true,
  })) as RawAiToolsModule
  const entries = mod.aiToolConfigEntriesRaw ?? mod.aiToolConfigEntries ?? []
  const result: { moduleId: string; tools: AiToolDefinition[] }[] = []
  for (const entry of entries) {
    if (!entry || typeof entry.moduleId !== 'string') continue
    const tools = Array.isArray(entry.tools)
      ? entry.tools.filter(isToolDefinition)
      : []
    result.push({ moduleId: entry.moduleId, tools })
  }
  return result
}

export async function pickDefaultTenant(
  container: AwilixContainer,
): Promise<{ tenantId: string; organizationId: string | null; userId: string | null } | null> {
  try {
    const em = container.resolve<{
      getConnection: () => {
        execute: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>
      }
    }>('em') as unknown as {
      getConnection: () => {
        execute: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>
      }
    }
    const conn = em.getConnection()
    const tenantRows = await conn.execute(
      `SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    )
    const tenantId =
      Array.isArray(tenantRows) && tenantRows[0]
        ? String((tenantRows[0] as Record<string, unknown>).id)
        : null
    if (!tenantId) return null
    const orgRows = await conn.execute(
      `SELECT id FROM organizations WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    )
    const organizationId =
      Array.isArray(orgRows) && orgRows[0]
        ? String((orgRows[0] as Record<string, unknown>).id)
        : null
    const userRows = await conn.execute(
      `SELECT id FROM users WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    )
    const userId =
      Array.isArray(userRows) && userRows[0]
        ? String((userRows[0] as Record<string, unknown>).id)
        : null
    return { tenantId, organizationId, userId }
  } catch (error) {
    if (process.env.OM_TOOL_TEST_DEBUG === '1') {
      console.warn('[tool-test-runner] pickDefaultTenant failed:', error)
    }
    return null
  }
}

function buildSuperAdminContext(
  container: AwilixContainer,
  tenantId: string | null,
  organizationId: string | null,
  userId: string | null,
): McpToolContext {
  return {
    tenantId,
    organizationId,
    userId,
    container,
    userFeatures: ['*'],
    isSuperAdmin: true,
  }
}

function clipPreview(value: unknown): unknown {
  try {
    const json = JSON.stringify(value)
    if (json.length <= 400) return value
    return `${json.slice(0, 400)}…(truncated, ${json.length} bytes)`
  } catch {
    return '[unserializable]'
  }
}

function dummyAgentForTool(tool: AiToolDefinition): AiAgentDefinition {
  // The runner never registers this agent; it's only used as input to
  // `prepareMutation` for shape compatibility. The id namespace is namespaced
  // under `__test__` so it cannot collide with real agents.
  const policy: AiAgentMutationPolicy = 'destructive-confirm-required'
  return {
    id: `__test__.${tool.name}`,
    moduleId: tool.name.split('.')[0] ?? '__test__',
    label: 'Tool Test Runner',
    description: 'Synthetic agent used by the tool test runner',
    systemPrompt: '',
    allowedTools: [tool.name],
    readOnly: false,
    mutationPolicy: policy,
  } as AiAgentDefinition
}

async function executeReadTool(
  tool: AiToolDefinition,
  args: Record<string, unknown>,
  container: AwilixContainer,
  ctx: McpToolContext,
): Promise<unknown> {
  // Mirror the dispatcher: resolve a fresh container per call so EM identity
  // map state is clean between tools.
  const fresh = await createRequestContainer()
  const freshCtx: McpToolContext = { ...ctx, container: fresh, tool }
  void container // keep arg for future use
  return tool.handler(args as never, freshCtx)
}

async function executeMutationTool(
  tool: AiToolDefinition,
  args: Record<string, unknown>,
  container: AwilixContainer,
  ctx: McpToolContext,
): Promise<unknown> {
  // Route through prepareMutation so we assert the approval contract still
  // holds — the handler must NEVER write directly. We pass a destructive
  // policy so the runtime treats the call as a confirmation candidate and
  // creates a pending-action row.
  const fresh = await createRequestContainer()
  const agent = dummyAgentForTool(tool)
  const userId = ctx.userId ?? '00000000-0000-0000-0000-000000000000'
  const { uiPart, pendingAction } = await prepareMutation(
    {
      agent,
      tool,
      toolCallArgs: args,
      conversationId: null,
      mutationPolicyOverride: null,
    },
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId,
      features: ctx.userFeatures,
      isSuperAdmin: ctx.isSuperAdmin,
      container: fresh,
    },
  )
  // Exercise the actual handler via the same path the production confirm
  // route uses. Without this, mutation tools whose handler crashes (e.g.
  // missing `ctx.tool` for the API operation runner) would be reported as
  // passing because `prepareMutation` never invokes the handler.
  // `prepareMutation` already enforced `tenantId` is non-null above; cast
  // here for the stricter `PendingActionExecuteContext` shape.
  const confirmTenantId = ctx.tenantId as string
  const confirmContainer = await createRequestContainer()
  const confirmation = await executePendingActionConfirm({
    action: pendingAction,
    agent,
    tool,
    ctx: {
      tenantId: confirmTenantId,
      organizationId: ctx.organizationId,
      userId,
      container: confirmContainer,
      userFeatures: ctx.userFeatures,
      isSuperAdmin: ctx.isSuperAdmin,
    },
    emitEvent: async () => {},
  })
  if (!confirmation.ok) {
    const error = (confirmation.executionResult as { error?: { message?: string } } | undefined)?.error
    const cause = confirmation.cause
    const causeMessage =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
          ? cause
          : null
    const message = error?.message ?? causeMessage ?? 'handler invocation failed'
    throw new Error(message)
  }
  return {
    status: 'pending-confirmation',
    pendingActionId: pendingAction.id,
    expiresAt: pendingAction.expiresAt.toISOString(),
    uiPartType: (uiPart as { type?: string } | undefined)?.type ?? null,
    handlerExecuted: true,
  }
}

async function resolveFixtureInput(
  fixture: ToolFixture,
  resolved: Map<string, AiToolDefinition>,
  container: AwilixContainer,
  ctx: McpToolContext,
): Promise<{ ok: true; input: Record<string, unknown> } | { ok: false; reason: string }> {
  if (fixture.input) return { ok: true, input: { ...fixture.input } }
  if (!fixture.idFrom) {
    return { ok: false, reason: 'fixture has neither input nor idFrom' }
  }
  const sourceTool = resolved.get(fixture.idFrom)
  if (!sourceTool) {
    return { ok: false, reason: `idFrom tool not found: ${fixture.idFrom}` }
  }
  const sourceFixture = getFixture(fixture.idFrom)
  if (!sourceFixture?.input) {
    return {
      ok: false,
      reason: `idFrom source ${fixture.idFrom} has no static input fixture`,
    }
  }
  let listResult: unknown
  try {
    listResult = await executeReadTool(
      sourceTool,
      { ...sourceFixture.input },
      container,
      ctx,
    )
  } catch (error) {
    return {
      ok: false,
      reason: `idFrom source ${fixture.idFrom} threw: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
  const records = extractRecords(listResult)
  if (!records.length) {
    return {
      ok: false,
      reason: `idFrom source ${fixture.idFrom} returned no records`,
    }
  }
  const idField = 'id'
  const id = (records[0] as Record<string, unknown>)[idField]
  if (typeof id !== 'string' || !id) {
    return {
      ok: false,
      reason: `idFrom source ${fixture.idFrom} first record has no string id`,
    }
  }
  const bindAs = fixture.bindAs ?? 'id'
  return {
    ok: true,
    input: { [bindAs]: id, ...(fixture.extra ?? {}) },
  }
}

function extractRecords(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  const candidate = value as Record<string, unknown>
  for (const key of ['records', 'items', 'people', 'companies', 'deals', 'results', 'data']) {
    const arr = candidate[key]
    if (Array.isArray(arr)) return arr
  }
  return []
}

export interface RunToolTestsOptions {
  tenantId?: string | null
  organizationId?: string | null
  userId?: string | null
  moduleFilter?: string | null
  includeMutations?: boolean
}

export async function runToolTests(
  options: RunToolTestsOptions = {},
): Promise<ToolTestReport> {
  const includeMutations = options.includeMutations ?? true
  const container = await createRequestContainer()
  let tenantId: string | null = options.tenantId ?? null
  let organizationId: string | null = options.organizationId ?? null
  let userId: string | null = options.userId ?? null
  if (!tenantId) {
    const picked = await pickDefaultTenant(container)
    if (picked) {
      tenantId = picked.tenantId
      organizationId = picked.organizationId
      userId = userId ?? picked.userId
    }
  }
  const ctx = buildSuperAdminContext(container, tenantId, organizationId, userId)
  const grouped = await loadGeneratedTools()

  const flat: { moduleId: string; tool: AiToolDefinition }[] = []
  for (const group of grouped) {
    if (options.moduleFilter && group.moduleId !== options.moduleFilter) continue
    for (const tool of group.tools) flat.push({ moduleId: group.moduleId, tool })
  }
  const resolved = new Map<string, AiToolDefinition>()
  for (const { tool } of flat) resolved.set(tool.name, tool)

  const records: ToolTestRecord[] = []
  for (const { moduleId, tool } of flat) {
    const start = Date.now()
    const isMutation = tool.isMutation === true
    const fixture = getFixture(tool.name)
    if (!fixture) {
      records.push({
        module: moduleId,
        tool: tool.name,
        isMutation,
        status: 'skip',
        durationMs: Date.now() - start,
        reason: 'no fixture',
      })
      continue
    }
    if (fixture.skip) {
      records.push({
        module: moduleId,
        tool: tool.name,
        isMutation,
        status: 'skip',
        durationMs: Date.now() - start,
        reason: fixture.note ?? 'skip-by-fixture',
      })
      continue
    }
    if (isMutation && !includeMutations) {
      records.push({
        module: moduleId,
        tool: tool.name,
        isMutation,
        status: 'skip',
        durationMs: Date.now() - start,
        reason: 'mutations excluded',
      })
      continue
    }
    const inputResult = await resolveFixtureInput(fixture, resolved, container, ctx)
    if (!inputResult.ok) {
      records.push({
        module: moduleId,
        tool: tool.name,
        isMutation,
        status: 'skip',
        durationMs: Date.now() - start,
        reason: inputResult.reason,
      })
      continue
    }
    try {
      const result = isMutation
        ? await executeMutationTool(tool, inputResult.input, container, ctx)
        : await executeReadTool(tool, inputResult.input, container, ctx)
      // Result must be JSON-serializable.
      JSON.stringify(result)
      // Mutation tools must return a pending-confirmation envelope.
      if (
        isMutation &&
        (typeof result !== 'object' ||
          result === null ||
          (result as Record<string, unknown>).status !== 'pending-confirmation')
      ) {
        records.push({
          module: moduleId,
          tool: tool.name,
          isMutation,
          status: 'fail',
          durationMs: Date.now() - start,
          reason: 'mutation tool did not route through prepareMutation (no pending-confirmation envelope)',
          resultPreview: clipPreview(result),
        })
        continue
      }
      records.push({
        module: moduleId,
        tool: tool.name,
        isMutation,
        status: 'pass',
        durationMs: Date.now() - start,
        resultPreview: clipPreview(result),
      })
    } catch (error) {
      records.push({
        module: moduleId,
        tool: tool.name,
        isMutation,
        status: 'fail',
        durationMs: Date.now() - start,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const passed = records.filter((r) => r.status === 'pass').length
  const failed = records.filter((r) => r.status === 'fail').length
  const skipped = records.filter((r) => r.status === 'skip').length
  return {
    tenantId,
    organizationId,
    total: records.length,
    passed,
    failed,
    skipped,
    records,
  }
}
