import type { EntityManager } from '@mikro-orm/postgresql'
import { AiTokenUsageEvent, AiTokenUsageDaily } from '../entities'

export interface CreateTokenUsageEventInput {
  tenantId: string
  organizationId?: string | null
  userId: string
  agentId: string
  moduleId: string
  sessionId: string
  turnId: string
  stepIndex: number
  providerId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number | null
  reasoningTokens?: number | null
  finishReason?: string | null
  loopAbortReason?: string | null
}

export interface UpsertTokenUsageDailyInput {
  tenantId: string
  organizationId?: string | null
  day: string
  agentId: string
  modelId: string
  providerId: string
  sessionId: string
  turnId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
}

/**
 * Repository for the Phase 6 token-usage event log and daily rollup tables.
 *
 * `upsertDaily` uses raw SQL to perform the CONFLICT-based incremental update
 * because MikroORM does not expose `INSERT ... ON CONFLICT DO UPDATE` for
 * arbitrary expressions. The LATERAL session-count check guards against
 * double-counting a session within the same `(tenant, day, agent, model)` tuple.
 *
 * All writes are fail-open — callers MUST wrap invocations in try/catch and
 * log at `warn` rather than rethrowing (R12: recorder must never break a turn).
 *
 * Phase 6.1 + 6.3 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export class AiTokenUsageRepository {
  constructor(private readonly em: EntityManager) {}

  async createEvent(input: CreateTokenUsageEventInput): Promise<AiTokenUsageEvent> {
    const event = this.em.create(AiTokenUsageEvent, {
      tenantId: input.tenantId,
      organizationId: input.organizationId ?? null,
      userId: input.userId,
      agentId: input.agentId,
      moduleId: input.moduleId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      stepIndex: input.stepIndex,
      providerId: input.providerId,
      modelId: input.modelId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cachedInputTokens: input.cachedInputTokens ?? null,
      reasoningTokens: input.reasoningTokens ?? null,
      finishReason: input.finishReason ?? null,
      loopAbortReason: input.loopAbortReason ?? null,
    })
    await this.em.persistAndFlush(event)
    return event
  }

  /**
   * Upserts the daily rollup row, incrementing counters atomically via
   * `INSERT ... ON CONFLICT DO UPDATE`. The `session_count` column is
   * incremented only when this is the first event observed for the
   * `(tenant_id, session_id, day, agent_id, model_id)` tuple — a LATERAL
   * NOT EXISTS check prevents double-counting.
   *
   * The query handles the two partial unique indexes (org IS NOT NULL vs
   * IS NULL) by encoding `organization_id` in the EXCLUDED row and relying
   * on the appropriate partial index the planner selects.
   */
  async upsertDaily(input: UpsertTokenUsageDailyInput): Promise<void> {
    const connection = this.em.getConnection()
    const now = new Date()
    const orgValue = input.organizationId ?? null

    // Determine if this is the first event for this session in the window
    // (used to guard the session_count increment).
    const sessionCheckSql = `
      select exists (
        select 1 from ai_token_usage_events
        where tenant_id = ?
          and session_id = ?::uuid
          and agent_id = ?
          and model_id = ?
          and date_trunc('day', created_at) = ?::date
          ${orgValue !== null ? 'and organization_id = ?' : 'and organization_id is null'}
      ) as already_seen
    `
    const sessionCheckParams: unknown[] = [
      input.tenantId,
      input.sessionId,
      input.agentId,
      input.modelId,
      input.day,
    ]
    if (orgValue !== null) sessionCheckParams.push(orgValue)

    const sessionRows = await connection.execute(sessionCheckSql, sessionCheckParams, 'all')
    const alreadySeen =
      Array.isArray(sessionRows) &&
      sessionRows.length > 0 &&
      (sessionRows[0] as Record<string, unknown>).already_seen === true

    const sessionDelta = alreadySeen ? 0 : 1

    // Determine if this is the first event for this turn in the same window.
    // Without this gate the daily rollup's `turn_count` would increment per
    // step instead of per distinct turn — see `TC-AI-AGENT-USAGE-002` and the
    // `turn_count` column comment ("distinct turns observed").
    const turnCheckSql = `
      select exists (
        select 1 from ai_token_usage_events
        where tenant_id = ?
          and turn_id = ?::uuid
          and agent_id = ?
          and model_id = ?
          and date_trunc('day', created_at) = ?::date
          ${orgValue !== null ? 'and organization_id = ?' : 'and organization_id is null'}
      ) as already_seen
    `
    const turnCheckParams: unknown[] = [
      input.tenantId,
      input.turnId,
      input.agentId,
      input.modelId,
      input.day,
    ]
    if (orgValue !== null) turnCheckParams.push(orgValue)

    const turnRows = await connection.execute(turnCheckSql, turnCheckParams, 'all')
    const turnAlreadySeen =
      Array.isArray(turnRows) &&
      turnRows.length > 0 &&
      (turnRows[0] as Record<string, unknown>).already_seen === true

    const turnDelta = turnAlreadySeen ? 0 : 1

    if (orgValue !== null) {
      await connection.execute(
        `
        insert into ai_token_usage_daily (
          id, tenant_id, organization_id, day, agent_id, model_id, provider_id,
          input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
          step_count, turn_count, session_count, created_at, updated_at
        ) values (
          gen_random_uuid(), ?, ?, ?::date, ?, ?, ?,
          ?, ?, ?, ?,
          1, ?, ?, ?, ?
        )
        on conflict on constraint ai_token_usage_daily_tenant_day_agent_model_org_uq
        do update set
          input_tokens         = ai_token_usage_daily.input_tokens + excluded.input_tokens,
          output_tokens        = ai_token_usage_daily.output_tokens + excluded.output_tokens,
          cached_input_tokens  = ai_token_usage_daily.cached_input_tokens + excluded.cached_input_tokens,
          reasoning_tokens     = ai_token_usage_daily.reasoning_tokens + excluded.reasoning_tokens,
          step_count           = ai_token_usage_daily.step_count + 1,
          turn_count           = ai_token_usage_daily.turn_count + excluded.turn_count,
          session_count        = ai_token_usage_daily.session_count + excluded.session_count,
          updated_at           = excluded.updated_at
        `,
        [
          input.tenantId, orgValue, input.day, input.agentId, input.modelId, input.providerId,
          input.inputTokens, input.outputTokens, input.cachedInputTokens, input.reasoningTokens,
          turnDelta, sessionDelta, now, now,
        ],
        'run',
      )
    } else {
      await connection.execute(
        `
        insert into ai_token_usage_daily (
          id, tenant_id, organization_id, day, agent_id, model_id, provider_id,
          input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
          step_count, turn_count, session_count, created_at, updated_at
        ) values (
          gen_random_uuid(), ?, null, ?::date, ?, ?, ?,
          ?, ?, ?, ?,
          1, ?, ?, ?, ?
        )
        on conflict on constraint ai_token_usage_daily_tenant_day_agent_model_null_org_uq
        do update set
          input_tokens         = ai_token_usage_daily.input_tokens + excluded.input_tokens,
          output_tokens        = ai_token_usage_daily.output_tokens + excluded.output_tokens,
          cached_input_tokens  = ai_token_usage_daily.cached_input_tokens + excluded.cached_input_tokens,
          reasoning_tokens     = ai_token_usage_daily.reasoning_tokens + excluded.reasoning_tokens,
          step_count           = ai_token_usage_daily.step_count + 1,
          turn_count           = ai_token_usage_daily.turn_count + excluded.turn_count,
          session_count        = ai_token_usage_daily.session_count + excluded.session_count,
          updated_at           = excluded.updated_at
        `,
        [
          input.tenantId, input.day, input.agentId, input.modelId, input.providerId,
          input.inputTokens, input.outputTokens, input.cachedInputTokens, input.reasoningTokens,
          turnDelta, sessionDelta, now, now,
        ],
        'run',
      )
    }
  }

  async listEventsForSession(
    tenantId: string,
    sessionId: string,
    limit = 200,
  ): Promise<AiTokenUsageEvent[]> {
    return this.em.find(
      AiTokenUsageEvent,
      { tenantId, sessionId },
      { orderBy: { createdAt: 'ASC', stepIndex: 'ASC' }, limit },
    )
  }

  async listDailyRollup(
    tenantId: string,
    from: string,
    to: string,
    filters: { agentId?: string; modelId?: string } = {},
  ): Promise<AiTokenUsageDaily[]> {
    const where: Record<string, unknown> = { tenantId, day: { $gte: from, $lte: to } }
    if (filters.agentId) where.agentId = filters.agentId
    if (filters.modelId) where.modelId = filters.modelId
    return this.em.find(AiTokenUsageDaily, where, {
      orderBy: { day: 'ASC', agentId: 'ASC', modelId: 'ASC' },
    })
  }
}
