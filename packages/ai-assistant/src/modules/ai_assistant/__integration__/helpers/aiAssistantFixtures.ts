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
