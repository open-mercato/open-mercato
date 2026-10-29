import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Direct-Postgres fixtures for AI Assistant integration specs.
 *
 * Mirrors the sanctioned pattern in
 * `@open-mercato/core/helpers/integration/dbFixtures` (raw SQL against
 * `DATABASE_URL`) for the surfaces that have NO public create route:
 *  - `ai_pending_actions`: a pending mutation approval is only ever born from
 *    the internal `prepareMutation` path during a real LLM agent turn. Seeding
 *    the row directly keeps confirm/cancel/GET coverage deterministic and
 *    provider-free.
 *  - prompt overrides: the `prompt-override` route exposes no DELETE, so
 *    versioned rows must be swept via SQL after a test.
 *
 * The app server and this helper MUST share one `DATABASE_URL`, so specs using
 * these helpers only run under the coherent app+DB harness
 * (`yarn test:integration` / `:ephemeral`), never against an arbitrary dev
 * server whose `DATABASE_URL` differs from `apps/mercato/.env`.
 */

function resolveAppRoot(): string {
  const fromEnv = process.env.OM_TEST_APP_ROOT?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.resolve(process.cwd(), 'apps/mercato');
}

function readEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const candidatePaths = [
    path.resolve(resolveAppRoot(), '.env'),
    path.resolve(process.cwd(), 'apps/mercato/.env'),
    path.resolve(process.cwd(), '.env'),
  ];
  for (const envPath of candidatePaths) {
    try {
      const content = readFileSync(envPath, 'utf-8');
      const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
      if (match?.[1]) return match[1].trim();
    } catch {
      continue;
    }
  }
  return undefined;
}

function resolveDatabaseUrl(): string {
  const url = readEnvValue('DATABASE_URL');
  if (!url) throw new Error('[internal] DATABASE_URL is not configured for AI Assistant integration DB fixtures');
  return url;
}

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export type SeededPendingActionStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'executing'
  | 'failed';

export interface SeedPendingActionInput {
  tenantId: string;
  organizationId?: string | null;
  createdByUserId: string;
  status?: SeededPendingActionStatus;
  agentId?: string;
  toolName?: string;
  /** Minutes from now until expiry. Negative => the row is already expired. */
  expiresInMinutes?: number;
  normalizedInput?: Record<string, unknown>;
  executionResult?: Record<string, unknown> | null;
  idempotencyKey?: string;
}

export interface SeededPendingAction {
  id: string;
  idempotencyKey: string;
}

/**
 * Inserts an `ai_pending_actions` row directly. Returns the new id so the test
 * can act on it and clean it up. Defaults produce an actionable `pending` row
 * with a future TTL; override `status`/`expiresInMinutes`/`executionResult` to
 * cover the idempotency short-circuit and 409 error branches.
 */
export async function seedPendingActionInDb(input: SeedPendingActionInput): Promise<SeededPendingAction> {
  const idempotencyKey = input.idempotencyKey ?? `it-pending-${randomUUID()}`;
  const status = input.status ?? 'pending';
  const expiresInMinutes = input.expiresInMinutes ?? 60;
  const normalizedInput = JSON.stringify(input.normalizedInput ?? {});
  const executionResult =
    input.executionResult === undefined || input.executionResult === null
      ? null
      : JSON.stringify(input.executionResult);
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into ai_pending_actions
         (id, tenant_id, organization_id, agent_id, tool_name, normalized_input,
          field_diff, attachment_ids, idempotency_key, created_by_user_id, status,
          queue_mode, execution_result, created_at, expires_at)
       values
         (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb,
          '[]'::jsonb, '[]'::jsonb, $6, $7, $8,
          'inline', $9::jsonb, now(), now() + make_interval(mins => $10::int))
       returning id`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.agentId ?? 'it_agent.pending_fixture',
        input.toolName ?? 'it_tool.noop',
        normalizedInput,
        idempotencyKey,
        input.createdByUserId,
        status,
        executionResult,
        expiresInMinutes,
      ],
    );
    return { id: result.rows[0].id, idempotencyKey };
  });
}

/** Hard-deletes a seeded pending action row (best-effort test cleanup). */
export async function deletePendingActionInDb(id: string | null): Promise<void> {
  if (!id) return;
  await withClient(async (client) => {
    await client.query('delete from ai_pending_actions where id = $1', [id]);
  });
}

/**
 * Sweeps every per-agent override row for a tenant across the three override
 * tables. Required for `prompt-override` cleanup (no DELETE route) and used as a
 * belt-and-braces teardown for mutation-policy / loop overrides.
 */
export async function deleteAgentOverridesInDb(input: { tenantId: string; agentId: string }): Promise<void> {
  if (!input.tenantId || !input.agentId) return;
  await withClient(async (client) => {
    await client.query('delete from ai_agent_prompt_overrides where tenant_id = $1 and agent_id = $2', [
      input.tenantId,
      input.agentId,
    ]);
    await client.query('delete from ai_agent_mutation_policy_overrides where tenant_id = $1 and agent_id = $2', [
      input.tenantId,
      input.agentId,
    ]);
    await client.query('delete from ai_agent_runtime_overrides where tenant_id = $1 and agent_id = $2', [
      input.tenantId,
      input.agentId,
    ]);
  });
}

/** Hard-deletes any tenant model-allowlist rows (best-effort cleanup). */
export async function deleteTenantAllowlistInDb(tenantId: string | null): Promise<void> {
  if (!tenantId) return;
  await withClient(async (client) => {
    await client.query('delete from ai_tenant_model_allowlists where tenant_id = $1', [tenantId]);
  });
}

export interface SeedModerationFlagInput {
  tenantId: string;
  organizationId?: string | null;
  agentId?: string;
  userId?: string;
  providerId?: string;
  modelId?: string;
  /** Defaults to a single flagged `hate` category. */
  categories?: Record<string, { flagged: boolean; score: number }>;
}

/**
 * Inserts an `ai_moderation_flags` audit row directly. A real flag is only ever
 * born from the gate during a flagged LLM turn (needs a live moderation call),
 * so seeding the row keeps audit-listing + tenant-isolation coverage
 * deterministic and provider-free. Returns the new id for assertions/cleanup.
 */
export async function seedModerationFlagInDb(input: SeedModerationFlagInput): Promise<string> {
  const categories = JSON.stringify(input.categories ?? { hate: { flagged: true, score: 0.97 } });
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into ai_moderation_flags
         (id, tenant_id, organization_id, agent_id, user_id, provider_id, model_id, categories, created_at)
       values
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, now())
       returning id`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.agentId ?? 'it_agent.moderation_fixture',
        input.userId ?? `it-user-${randomUUID()}`,
        input.providerId ?? 'openai',
        input.modelId ?? 'gpt-5-mini',
        categories,
      ],
    );
    return result.rows[0].id;
  });
}

/** Hard-deletes every moderation-flag row for a tenant (best-effort cleanup). */
export async function deleteModerationFlagsInDb(tenantId: string | null): Promise<void> {
  if (!tenantId) return;
  await withClient(async (client) => {
    await client.query('delete from ai_moderation_flags where tenant_id = $1', [tenantId]);
  });
}

/**
 * Hard-deletes a conversation and its participant + message rows by the
 * client-facing `conversation_id`. The DELETE route only soft-deletes, so this
 * gives specs a true teardown for the rows they created.
 */
export async function deleteConversationCascadeInDb(input: {
  tenantId: string;
  conversationId: string;
}): Promise<void> {
  if (!input.tenantId || !input.conversationId) return;
  await withClient(async (client) => {
    await client.query('delete from ai_chat_messages where tenant_id = $1 and conversation_id = $2', [
      input.tenantId,
      input.conversationId,
    ]);
    await client.query(
      'delete from ai_chat_conversation_participants where tenant_id = $1 and conversation_id = $2',
      [input.tenantId, input.conversationId],
    );
    await client.query('delete from ai_chat_conversations where tenant_id = $1 and conversation_id = $2', [
      input.tenantId,
      input.conversationId,
    ]);
  });
}

export type IntegrationMcpMutationMode = 'direct' | 'deny' | 'approval';

/**
 * Mirrors how the app server resolves `OM_MCP_MUTATION_MODE` (process env first,
 * then `apps/mercato/.env`). The ephemeral runner forwards the Playwright
 * process env to the app server it spawns, so a spec can gate on this value.
 */
export function resolveIntegrationMcpMutationMode(): IntegrationMcpMutationMode {
  const raw = (readEnvValue('OM_MCP_MUTATION_MODE') ?? '').trim().toLowerCase();
  return raw === 'deny' || raw === 'approval' ? raw : 'direct';
}

export type SeededAgentRunChannel = 'chat' | 'playground' | 'run-object' | 'mcp' | 'tools-api' | 'internal';

export interface SeedAgentRunToolCallInput {
  toolName: string;
  argKeys: string[];
  args?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  isMutation?: boolean;
}

export interface SeedAgentRunInput {
  tenantId: string;
  organizationId?: string | null;
  userId: string | null;
  agentId: string;
  conversationId?: string | null;
  channel?: SeededAgentRunChannel;
  status?: 'completed' | 'failed' | 'aborted';
  captureLevel?: 'full' | 'metadata';
  modelId?: string;
  promptOverrideVersion?: number | null;
  inputText?: string | null;
  outputText?: string | null;
  stepText?: string | null;
  toolCalls?: SeedAgentRunToolCallInput[];
}

export const SEEDED_AGENT_RUN_DEFINITION_HASH = 'sha256:it-agent-run-fixture';

/**
 * Inserts an `ai_agent_runs` row (plus one step and the given tool calls)
 * directly. A real run is only ever recorded by the agent runtime after a live
 * LLM turn, so seeding keeps the runs read API, access rules and pages
 * deterministic and provider-free. Encrypted columns are written as plaintext,
 * which the decryption helpers pass through unchanged.
 */
export async function seedAgentRunInDb(input: SeedAgentRunInput): Promise<string> {
  const captureLevel = input.captureLevel ?? 'full';
  const contentCaptured = captureLevel === 'full';
  const toolCalls = input.toolCalls ?? [];
  const modelId = input.modelId ?? 'it-fixture-model';
  const moduleId = input.agentId.split('.')[0] ?? input.agentId;
  return withClient(async (client) => {
    const runResult = await client.query<{ id: string }>(
      `insert into ai_agent_runs
         (id, tenant_id, organization_id, user_id, agent_id, module_id, agent_definition_hash,
          prompt_override_version, execution_mode, channel, conversation_id, turn_id,
          provider_id, model_id, model_params, effective_mutation_policy, tool_names, status,
          finish_reason, input_tokens, output_tokens, step_count, tool_call_count, duration_ms,
          started_at, completed_at, input_text, output_text, content_truncated, system_prompt_hash,
          capture_level, created_at, updated_at)
       values
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6,
          $7, 'chat', $8, $9, gen_random_uuid(),
          'it-fixture-provider', $10, '{}'::jsonb, 'read-only', $11::text[], $12,
          'stop', 42, 17, 1, $13, 1200,
          now() - interval '2 seconds', now(), $14, $15, false, 'sha256:it-system-prompt',
          $16, now(), now())
       returning id`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.userId,
        input.agentId,
        moduleId,
        SEEDED_AGENT_RUN_DEFINITION_HASH,
        input.promptOverrideVersion ?? null,
        input.channel ?? 'chat',
        input.conversationId ?? null,
        modelId,
        toolCalls.map((toolCall) => toolCall.toolName),
        input.status ?? 'completed',
        toolCalls.length,
        contentCaptured ? (input.inputText ?? 'Integration fixture question') : null,
        contentCaptured ? (input.outputText ?? 'Integration fixture answer') : null,
        captureLevel,
      ],
    );
    const runId = runResult.rows[0].id;
    await client.query(
      `insert into ai_agent_run_steps
         (tenant_id, organization_id, run_id, step_index, model_id, finish_reason, input_tokens,
          output_tokens, text, text_truncated, ended_at, duration_ms, created_at, updated_at)
       values ($1, $2, $3, 0, $4, 'stop', 42, 17, $5, false, now(), 1100, now(), now())`,
      [
        input.tenantId,
        input.organizationId ?? null,
        runId,
        modelId,
        contentCaptured ? (input.stepText ?? 'Integration fixture step') : null,
      ],
    );
    for (const [callIndex, toolCall] of toolCalls.entries()) {
      const args = contentCaptured && toolCall.args ? JSON.stringify(toolCall.args) : null;
      const result = contentCaptured && toolCall.result ? JSON.stringify(toolCall.result) : null;
      await client.query(
        `insert into ai_agent_run_tool_calls
           (tenant_id, organization_id, run_id, step_index, call_index, tool_call_id, tool_name,
            is_mutation, arg_keys, args, result, args_truncated, result_truncated, result_bytes,
            duration_ms, created_at, updated_at)
         values ($1, $2, $3, 0, $4, $5, $6, $7, $8::text[], $9::jsonb, $10::jsonb, false, false, $11,
                 85, now(), now())`,
        [
          input.tenantId,
          input.organizationId ?? null,
          runId,
          callIndex,
          `it-call-${callIndex}`,
          toolCall.toolName,
          toolCall.isMutation ?? false,
          toolCall.argKeys,
          args,
          result,
          result ? Buffer.byteLength(result, 'utf8') : 0,
        ],
      );
    }
    return runId;
  });
}

/** Hard-deletes seeded agent runs with their steps and tool calls (best-effort cleanup). */
export async function deleteAgentRunsInDb(runIds: Array<string | null>): Promise<void> {
  const ids = runIds.filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (ids.length === 0) return;
  await withClient(async (client) => {
    await client.query('delete from ai_agent_run_tool_calls where run_id = any($1::uuid[])', [ids]);
    await client.query('delete from ai_agent_run_steps where run_id = any($1::uuid[])', [ids]);
    await client.query('delete from ai_agent_runs where id = any($1::uuid[])', [ids]);
  });
}

/** Hard-deletes every agent run recorded for a conversation (cleanup after a real chat turn). */
export async function deleteConversationAgentRunsInDb(input: {
  tenantId: string;
  conversationId: string;
}): Promise<void> {
  if (!input.tenantId || !input.conversationId) return;
  const runIds = await withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      'select id from ai_agent_runs where tenant_id = $1 and conversation_id = $2',
      [input.tenantId, input.conversationId],
    );
    return result.rows.map((row) => row.id);
  });
  await deleteAgentRunsInDb(runIds);
}

/** Hard-deletes one prompt-override version (the route exposes no DELETE). */
export async function deletePromptOverrideVersionInDb(input: {
  tenantId: string;
  agentId: string;
  version: number | null;
}): Promise<void> {
  if (!input.tenantId || !input.agentId || input.version === null) return;
  await withClient(async (client) => {
    await client.query(
      'delete from ai_agent_prompt_overrides where tenant_id = $1 and agent_id = $2 and version = $3',
      [input.tenantId, input.agentId, input.version],
    );
  });
}

/**
 * Mirrors how the app server resolves `OM_AI_RUN_TRACE_CAPTURE` (process env
 * first, then `apps/mercato/.env`); unknown values fall back to `full`.
 */
export function resolveIntegrationRunTraceCapture(): 'full' | 'metadata' | 'off' {
  const raw = (readEnvValue('OM_AI_RUN_TRACE_CAPTURE') ?? '').trim().toLowerCase();
  return raw === 'metadata' || raw === 'off' ? raw : 'full';
}
