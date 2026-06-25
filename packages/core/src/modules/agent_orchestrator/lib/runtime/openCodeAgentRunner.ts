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
  createRun,
  completeRun,
  failRun,
  createProposal,
  shapeResult,
} from './persistence'
import type { AgentRunSessionStore } from './agentRunSessionStore'

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
    options?: { agent?: string; timeoutMs?: number },
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
/** How often to poll the shared store for the captured outcome (cross-process). */
const OUTCOME_POLL_MS = 750

/**
 * Wall-clock backstop for a single OpenCode run. Completion is normally signalled
 * by the captured outcome or an SSE busy→idle transition, but a wedged container
 * or a silently-dropped stream can leave both pending forever — which would pin
 * the run and defer the per-run session token's revocation to its 120m TTL. This
 * deadline guarantees the run always terminates and reaches the `finally` cleanup.
 * Override with `OM_OPENCODE_RUN_TIMEOUT_MS` (ms); defaults to 5 minutes.
 */
const DEFAULT_RUN_TIMEOUT_MS = 5 * 60_000
function resolveRunTimeoutMs(): number {
  const raw = Number.parseInt(process.env.OM_OPENCODE_RUN_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUN_TIMEOUT_MS
}

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
      parentRunId: ctx.parentRunId ?? null,
      runtime: entry.runtime,
      model: entry.defaultModel ?? null,
    })

    // Mint a fresh per-run session token scoped to the caller (their roles,
    // tenant, org) — never static, never superadmin. The MCP HTTP server
    // resolves this token's ACL on every tool call, so a tool the caller lacks
    // features for is unreachable regardless of the prompt (propose-only gate 2).
    // The token's effective ACL is its caller roles (resolved server-side by the
    // MCP server on every tool call) — we do NOT pre-resolve/attach features here,
    // and superadmin is excluded by passing only the caller's own roles below.
    const em = this.container.resolve<EntityManager>('em')
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
    // `ctx.sessionId` to the submit_outcome handler. The store is SHARED (DB) so
    // the separate mcp:serve-http process can resolve the active agent + write
    // the outcome this runner polls for.
    const store = this.container.resolve('agentRunSessionStore') as AgentRunSessionStore
    await store.open({
      sessionToken,
      agentId,
      runId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    })

    try {
      const session = await this.client.createSession()
      const message = this.buildMessage(sessionToken, input)

      const capturedOutcome = await this.driveSession({
        sessionId: session.id,
        message,
        openCodeAgentName,
        sessionToken,
        store,
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
        externalRunId: session.id,
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
      // Remove the shared correlation row, then best-effort revoke the per-run
      // token so it cannot be reused after the run.
      try {
        await store.dispose(sessionToken)
      } catch (err) {
        console.warn(`[internal] failed to dispose OpenCode run session row for "${agentId}":`, err)
      }
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
   * Send the message and wait for the captured outcome. Completion crosses a
   * PROCESS boundary (`submit_outcome` runs in the separate mcp:serve-http
   * process and writes the outcome to the shared store), so the runner cannot
   * await an in-memory promise — it POLLS `store.readOutcome` while also reacting
   * to SSE idle (the agent finished a turn) and a wall-clock deadline (H1 backstop
   * so a wedged/silent stream never hangs the run). On idle-without-outcome it
   * sends ONE corrective nudge; a second idle without an outcome gives up. The
   * `finally` (token revoke + row dispose) therefore always runs.
   */
  private async driveSession(args: {
    sessionId: string
    message: string
    openCodeAgentName: string
    sessionToken: string
    store: AgentRunSessionStore
  }): Promise<unknown | typeof NO_OUTCOME> {
    const idleSignal = this.subscribeIdle(args.sessionId)
    const deadline = createDeadline(resolveRunTimeoutMs())
    // The send is synchronous server-side (holds until the loop finishes), so use
    // the long run deadline as its timeout — aborting at the 30s chat default
    // would CANCEL the OpenCode run. Completion is driven by the store/SSE, never
    // the HTTP response, so fire-and-forget (errors only logged).
    const sendTimeoutMs = resolveRunTimeoutMs()
    const read = () => args.store.readOutcome(args.sessionToken)
    try {
      this.client
        .sendMessage(args.sessionId, args.message, { agent: args.openCodeAgentName, timeoutMs: sendTimeoutMs })
        .catch((err) => console.error('[OpenCode runner] send error (store/SSE will resolve):', err))

      let nudged = false
      // A single idle waiter, renewed only after it fires (avoids leaking a new
      // pending promise on every poll). H2 latch makes a renewed wait resolve
      // immediately if an idle already arrived.
      let idleWait = idleSignal.nextIdle()
      while (true) {
        const got = await read()
        if (got.done) return got.outcome
        const signal = await Promise.race([
          idleWait.then(() => 'idle' as const),
          deadline.promise.then(() => 'timeout' as const),
          delay(OUTCOME_POLL_MS).then(() => 'poll' as const),
        ])
        if (signal === 'timeout') {
          const fin = await read()
          if (fin.done) return fin.outcome
          console.error('[OpenCode runner] run exceeded the wall-clock deadline; failing the run.')
          return NO_OUTCOME
        }
        if (signal === 'idle') {
          // Give submit_outcome a beat to commit, then re-check.
          await delay(IDLE_GRACE_MS)
          const after = await read()
          if (after.done) return after.outcome
          idleWait = idleSignal.nextIdle()
          if (!nudged) {
            nudged = true
            this.client
              .sendMessage(
                args.sessionId,
                `You did not call the agent_orchestrator submit_outcome tool. Finish now by calling it with a value matching the outcome contract (the \`outcome\` argument).`,
                { agent: args.openCodeAgentName, timeoutMs: sendTimeoutMs },
              )
              .catch((err) => console.error('[OpenCode runner] nudge send error:', err))
          } else {
            // Idle a second time after the nudge with no outcome → give up.
            return NO_OUTCOME
          }
        }
        // signal === 'poll' → loop and re-read the store.
      }
    } finally {
      deadline.cancel()
      idleSignal.unsubscribe()
    }
  }

  /**
   * Subscribe to the OpenCode SSE stream for this session. `nextIdle()` returns a
   * promise that resolves on the NEXT busy→idle transition (matching the chat
   * path's idle-detection), so the runner can wait again after a corrective
   * nudge. An SSE error resolves the pending idle waiter (fail toward giving up
   * rather than hanging).
   *
   * H2 — lost-wakeup safe: between two `nextIdle()` calls (e.g. during the nudge
   * grace delay) there is no registered waiter. A busy→idle (or SSE error) that
   * arrives in that window is LATCHED instead of dropped, so the next `nextIdle()`
   * resolves immediately rather than blocking on a transition that already passed.
   */
  private subscribeIdle(sessionId: string): {
    nextIdle: () => Promise<void>
    unsubscribe: () => void
  } {
    let pendingResolve: (() => void) | null = null
    let wasBusy = false
    let idleLatched = false

    const settleIdle = () => {
      if (pendingResolve) {
        const resolve = pendingResolve
        pendingResolve = null
        resolve()
      } else {
        // No waiter registered right now — remember the wakeup for the next wait.
        idleLatched = true
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
          if (idleLatched) {
            idleLatched = false
            resolve()
            return
          }
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

/**
 * A cancellable wall-clock deadline. `promise` resolves once `ms` elapses (and
 * stays resolved thereafter, so racing it again returns immediately); `cancel()`
 * clears the timer in the runner's `finally` so a completed run leaks no timer.
 * The timer is `unref`'d so it never keeps the process alive on its own.
 */
function createDeadline(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }
  })
  return {
    promise,
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
