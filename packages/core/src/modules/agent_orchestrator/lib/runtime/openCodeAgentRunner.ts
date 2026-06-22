import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  generateSessionToken,
  createSessionApiKey,
  deleteSessionApiKey,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import { type AgentResult } from '../../data/validators'
import {
  type AgentRunCtx,
  buildCommandContext,
  resolveCallerAcl,
  createRun,
  completeRun,
  failRun,
  createProposal,
  shapeResult,
} from './persistence'
import * as openCodeRunRegistry from './openCodeRunRegistry'

/**
 * Minimal surface the runner needs from the OpenCode client. Declared locally so
 * tests can pass a fake (scripting `createSession` / `sendMessage` / the SSE
 * stream) without a live OpenCode container, and so `@open-mercato/core` does not
 * depend on the full `OpenCodeClient` class shape beyond what it uses.
 */
export type OpenCodeRunnerClient = {
  createSession(): Promise<{ id: string }>
  sendMessage(
    sessionId: string,
    message: string,
    options?: { agent?: string },
  ): Promise<unknown>
  subscribeToEvents(
    onEvent: (event: { type: string; properties: Record<string, unknown> }) => void,
    onError?: (error: Error) => void,
  ): () => void
}

export type OpenCodeAgentRunnerDeps = {
  container: AwilixContainer
  commandBus: CommandBus
  openCodeClient: OpenCodeRunnerClient
}

export class OpenCodeRunFailedError extends Error {
  readonly code = 'opencode_run_failed'
  constructor(agentId: string, detail: string) {
    super(`[internal] OpenCode agent "${agentId}" run failed: ${detail}`)
    this.name = 'OpenCodeRunFailedError'
  }
}

const SESSION_TTL_MINUTES = 120
/** Time to wait after the session goes idle without a captured outcome before nudging. */
const IDLE_GRACE_MS = 500

/**
 * Runs a file-defined (OpenCode) agent end-to-end and returns the SAME typed
 * `AgentResult` the in-process path returns, persisting the identical
 * AgentRun/AgentProposal tail via the shared `persistence` helpers.
 *
 * Flow (contract C7):
 *  1. Create the AgentRun (`agent_orchestrator.runs.create`).
 *  2. Resolve caller ACL and mint a per-run session token scoped to the caller
 *     (NEVER static/superadmin), TTL 120m.
 *  3. Register the run-correlation entry keyed by that token, open an OpenCode
 *     session, and send the input with `agent: openCodeAgentName`, prepending
 *     the `[Session Authorization …]` instruction so MCP tool calls authenticate.
 *  4. Consume the SSE stream; complete on EITHER the correlation deferred
 *     (`submit_outcome` captured the outcome) OR `session.status: idle`. Never
 *     `Promise.race` against the HTTP send.
 *  5. Idle without a captured outcome → ONE corrective nudge, wait again; still
 *     nothing → fail the run and throw.
 *  6. Re-validate the captured outcome (defense in depth), shape the result,
 *     complete the run (+ create the proposal for actionable), dispose the
 *     correlation entry, and best-effort revoke the session token.
 */
export class OpenCodeAgentRunner {
  private readonly container: AwilixContainer
  private readonly commandBus: CommandBus
  private readonly client: OpenCodeRunnerClient

  constructor(deps: OpenCodeAgentRunnerDeps) {
    this.container = deps.container
    this.commandBus = deps.commandBus
    this.client = deps.openCodeClient
  }

  async run(entry: AgentRegistryEntry, input: unknown, ctx: AgentRunCtx): Promise<AgentResult> {
    const agentId = entry.id
    const openCodeAgentName = agentId.replace(/[^a-z0-9_-]/gi, '_')
    const commandCtx = buildCommandContext(this.container, ctx)

    const runId = await createRun(this.commandBus, commandCtx, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentId,
      input,
    })

    // Mint a fresh per-run session token scoped to the caller (their roles,
    // tenant, org) — never static, never superadmin. The MCP HTTP server
    // resolves this token's ACL on every tool call, so a tool the caller lacks
    // features for is unreachable regardless of the prompt (propose-only gate 2).
    const em = this.container.resolve<EntityManager>('em')
    const acl = await resolveCallerAcl(this.container, ctx)
    const userRoleIds = await this.getUserRoleIds(em, ctx.userId, ctx.tenantId)
    const sessionToken = generateSessionToken()
    await createSessionApiKey(em, {
      sessionToken,
      userId: ctx.userId,
      userRoles: userRoleIds,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      ttlMinutes: SESSION_TTL_MINUTES,
    })

    // Correlation key = the per-run session token. The MCP server exposes it as
    // `ctx.sessionId` to the submit_outcome handler, which validates + completes.
    const handle = openCodeRunRegistry.register(sessionToken, {
      agentId,
      resultSchema: entry.schema,
    })

    try {
      const session = await this.client.createSession()
      const message = this.buildMessage(sessionToken, input)

      const capturedOutcome = await this.driveSession({
        sessionId: session.id,
        message,
        openCodeAgentName,
        sessionToken,
        outcomePromise: handle.outcomePromise,
      })

      if (capturedOutcome === NO_OUTCOME) {
        await failRun(this.commandBus, commandCtx, {
          runId,
          errorMessage: 'agent finished without calling submit_outcome',
        })
        throw new OpenCodeRunFailedError(agentId, 'no outcome submitted')
      }

      // Defense in depth: re-validate the captured outcome against the schema
      // even though submit_outcome already validated it server-side.
      const parsed = entry.schema.safeParse(capturedOutcome)
      if (!parsed.success) {
        const detail = parsed.error.message
        await failRun(this.commandBus, commandCtx, { runId, errorMessage: detail })
        throw new OpenCodeRunFailedError(agentId, `outcome failed re-validation: ${detail}`)
      }

      const result = shapeResult(entry.resultKind, parsed.data)

      await completeRun(this.commandBus, commandCtx, {
        runId,
        output: result,
        resultKind: entry.resultKind,
      })

      if (result.kind === 'actionable') {
        await createProposal(this.commandBus, commandCtx, {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          agentId,
          runId,
          payload: result.proposal,
          confidence: result.proposal.confidence ?? null,
          processId: ctx.processId ?? null,
          stepId: ctx.stepId ?? null,
        })
      }

      return result
    } finally {
      openCodeRunRegistry.dispose(sessionToken)
      // Best-effort revoke the per-run token so it cannot be reused after the run.
      try {
        await deleteSessionApiKey(em, sessionToken)
      } catch (err) {
        console.warn(`[internal] failed to revoke OpenCode run session token for "${agentId}":`, err)
      }
    }
  }

  private buildMessage(sessionToken: string, input: unknown): string {
    const authInstruction = `[Session Authorization: ${sessionToken}. Include "_sessionToken": "${sessionToken}" in EVERY tool call.]`
    const inputText = typeof input === 'string' ? input : JSON.stringify(input)
    return `${authInstruction}\n\n${inputText}`
  }

  /**
   * Send the message and consume the SSE stream until the agent either captures
   * an outcome (via submit_outcome → the correlation deferred) or the session
   * goes idle. On idle-without-outcome, sends ONE corrective nudge and waits a
   * second round before giving up.
   */
  private async driveSession(args: {
    sessionId: string
    message: string
    openCodeAgentName: string
    sessionToken: string
    outcomePromise: Promise<unknown>
  }): Promise<unknown | typeof NO_OUTCOME> {
    const idleSignal = this.subscribeIdle(args.sessionId)
    try {
      // Fire-and-forget the send: completion is signalled by SSE idle or by the
      // outcome deferred, NEVER by the HTTP response (no Promise.race on send).
      this.client
        .sendMessage(args.sessionId, args.message, { agent: args.openCodeAgentName })
        .catch((err) => {
          console.error('[OpenCode runner] send error (SSE/outcome will resolve):', err)
        })

      const first = await this.waitForOutcomeOrIdle(args.outcomePromise, idleSignal.nextIdle())
      if (first.kind === 'outcome') return first.outcome

      // Idle without an outcome — give the registry a beat in case the
      // submit_outcome handler is mid-flight, then nudge once.
      await delay(IDLE_GRACE_MS)
      const settled = openCodeRunRegistry.get(args.sessionToken)?.outcome
      if (settled !== undefined) return settled

      const nextIdle = idleSignal.nextIdle()
      this.client
        .sendMessage(
          args.sessionId,
          'You did not call agent_orchestrator.submit_outcome. Finish now by calling it with a value matching the outcome contract.',
          { agent: args.openCodeAgentName },
        )
        .catch((err) => {
          console.error('[OpenCode runner] nudge send error:', err)
        })

      const second = await this.waitForOutcomeOrIdle(args.outcomePromise, nextIdle)
      if (second.kind === 'outcome') return second.outcome
      const afterNudge = openCodeRunRegistry.get(args.sessionToken)?.outcome
      return afterNudge !== undefined ? afterNudge : NO_OUTCOME
    } finally {
      idleSignal.unsubscribe()
    }
  }

  private async waitForOutcomeOrIdle(
    outcomePromise: Promise<unknown>,
    idlePromise: Promise<void>,
  ): Promise<{ kind: 'outcome'; outcome: unknown } | { kind: 'idle' }> {
    return Promise.race([
      outcomePromise.then((outcome) => ({ kind: 'outcome' as const, outcome })),
      idlePromise.then(() => ({ kind: 'idle' as const })),
    ])
  }

  /**
   * Subscribe to the OpenCode SSE stream for this session. `nextIdle()` returns a
   * promise that resolves on the NEXT busy→idle transition (matching the chat
   * path's idle-detection), so the runner can wait again after a corrective
   * nudge. An SSE error resolves the pending idle waiter (fail toward giving up
   * rather than hanging).
   */
  private subscribeIdle(sessionId: string): {
    nextIdle: () => Promise<void>
    unsubscribe: () => void
  } {
    let pendingResolve: (() => void) | null = null
    let wasBusy = false

    const settleIdle = () => {
      if (pendingResolve) {
        const resolve = pendingResolve
        pendingResolve = null
        resolve()
      }
    }

    const unsubscribe = this.client.subscribeToEvents(
      (event) => {
        const { type, properties } = event
        const eventSessionId =
          (properties.sessionID as string | undefined) ||
          (properties.session as { id?: string } | undefined)?.id
        if (eventSessionId && eventSessionId !== sessionId) return
        if (type !== 'session.status') return
        const status = properties.status as { type?: string } | undefined
        if (status?.type === 'busy') {
          wasBusy = true
        } else if (status?.type === 'idle' && wasBusy) {
          wasBusy = false
          settleIdle()
        }
      },
      (error) => {
        console.error('[OpenCode runner] SSE error:', error)
        settleIdle()
      },
    )

    return {
      nextIdle() {
        return new Promise<void>((resolve) => {
          pendingResolve = resolve
        })
      },
      unsubscribe,
    }
  }

  private async getUserRoleIds(
    em: EntityManager,
    userId: string,
    tenantId: string,
  ): Promise<string[]> {
    if (!tenantId) return []
    try {
      const links = await findWithDecryption(
        em,
        UserRole,
        { user: userId as unknown as string, role: { tenantId } } as Record<string, unknown>,
        { populate: ['role'] },
        { tenantId, organizationId: null },
      )
      const linkList = Array.isArray(links) ? links : []
      return linkList
        .map((link) => (link.role as { id?: string } | undefined)?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    } catch (err) {
      console.warn('[internal] failed to resolve user roles for OpenCode run session token:', err)
      return []
    }
  }
}

const NO_OUTCOME = Symbol('no-outcome')

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
