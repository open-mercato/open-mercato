import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentRunSession } from '../../data/entities'

/**
 * Cross-process correlation store for OpenCode file-agent runs. The runner and
 * the MCP tools (`submit_outcome` / `load_skill` / `run_skill_script`) run in
 * SEPARATE processes (the app/worker vs. `mcp:serve-http`), so the active-agent +
 * captured-outcome handoff must be a SHARED store, not an in-process Map. Keyed
 * by the per-run session token (the runner mints it; the MCP server exposes it as
 * `ctx.sessionId` — never trusted from the model).
 */
export interface AgentRunSessionStore {
  /** Register an active run before the message is sent. */
  open(input: {
    sessionToken: string
    agentId: string
    runId?: string | null
    tenantId: string
    organizationId: string
  }): Promise<void>
  /** The active agent id for a session token, or null when unknown/stale. */
  resolveActiveAgentId(sessionToken: string): Promise<string | null>
  /**
   * Store the validated outcome. Single-shot: `not_found` when no run exists for
   * the token, `already_completed` when an outcome was already captured (never
   * overwritten), `completed` when this call performed the completion.
   */
  completeOutcome(
    sessionToken: string,
    outcome: unknown,
  ): Promise<'completed' | 'not_found' | 'already_completed'>
  /** Read the captured outcome — `{ done: true, outcome }` only once completed. */
  readOutcome(sessionToken: string): Promise<{ done: boolean; outcome?: unknown }>
  /** Remove the run row (the runner calls this in a finally). */
  dispose(sessionToken: string): Promise<void>
}

/**
 * DB-backed store (production). Every method forks a fresh `EntityManager` so the
 * long-lived poll loop never reads a stale identity map and so the two processes
 * observe each other's committed writes.
 */
export class DbAgentRunSessionStore implements AgentRunSessionStore {
  private readonly container: AwilixContainer

  constructor(container: AwilixContainer) {
    this.container = container
  }

  private em(): EntityManager {
    return (this.container.resolve('em') as EntityManager).fork()
  }

  async open(input: {
    sessionToken: string
    agentId: string
    runId?: string | null
    tenantId: string
    organizationId: string
  }): Promise<void> {
    const em = this.em()
    const row = em.create(AgentRunSession, {
      sessionToken: input.sessionToken,
      agentId: input.agentId,
      runId: input.runId ?? null,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      status: 'pending',
      outcome: null,
    })
    em.persist(row)
    await em.flush()
  }

  async resolveActiveAgentId(sessionToken: string): Promise<string | null> {
    const em = this.em()
    const row = await em.findOne(AgentRunSession, { sessionToken })
    return row?.agentId ?? null
  }

  async completeOutcome(
    sessionToken: string,
    outcome: unknown,
  ): Promise<'completed' | 'not_found' | 'already_completed'> {
    const em = this.em()
    const row = await em.findOne(AgentRunSession, { sessionToken })
    if (!row) return 'not_found'
    if (row.status === 'completed') return 'already_completed'
    row.status = 'completed'
    row.outcome = outcome
    await em.flush()
    return 'completed'
  }

  async readOutcome(sessionToken: string): Promise<{ done: boolean; outcome?: unknown }> {
    const em = this.em()
    const row = await em.findOne(AgentRunSession, { sessionToken })
    if (!row || row.status !== 'completed') return { done: false }
    return { done: true, outcome: row.outcome }
  }

  async dispose(sessionToken: string): Promise<void> {
    const em = this.em()
    await em.nativeDelete(AgentRunSession, { sessionToken })
  }
}

/** In-memory store for unit tests (single process). Mirrors the DB semantics. */
export class InMemoryAgentRunSessionStore implements AgentRunSessionStore {
  private readonly rows = new Map<string, { agentId: string; outcome?: unknown; status: 'pending' | 'completed' }>()

  async open(input: { sessionToken: string; agentId: string }): Promise<void> {
    this.rows.set(input.sessionToken, { agentId: input.agentId, status: 'pending' })
  }

  async resolveActiveAgentId(sessionToken: string): Promise<string | null> {
    return this.rows.get(sessionToken)?.agentId ?? null
  }

  async completeOutcome(
    sessionToken: string,
    outcome: unknown,
  ): Promise<'completed' | 'not_found' | 'already_completed'> {
    const row = this.rows.get(sessionToken)
    if (!row) return 'not_found'
    if (row.status === 'completed') return 'already_completed'
    row.status = 'completed'
    row.outcome = outcome
    return 'completed'
  }

  async readOutcome(sessionToken: string): Promise<{ done: boolean; outcome?: unknown }> {
    const row = this.rows.get(sessionToken)
    if (!row || row.status !== 'completed') return { done: false }
    return { done: true, outcome: row.outcome }
  }

  async dispose(sessionToken: string): Promise<void> {
    this.rows.delete(sessionToken)
  }
}
