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
import { normalizeOpenCodeToolPart } from '@open-mercato/shared/lib/ai/opencode-tool-parts'
import { emitAgentOrchestratorEvent } from '../../events'
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
import type { AgentWorkspaceLease, AgentWorkspaceManager } from './agentWorkspaceManager'
import { collectArtifacts } from './artifactCollector'
import { extractFileInput } from './fileInput'
import { stageAttachments, type StagedInput } from './attachmentStager'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { withAuditedCommand } from '../identity/agentWriteScope'
import type { IngestTraceCommandInput } from '../../commands/trace'
import type { IngestTraceResult } from '../trace/traceIngestionService'
import type { TraceSpanIngest } from '../../data/validators'

/**
 * One MCP tool invocation observed on the OpenCode SSE stream during a run.
 * Correlated by the part id so a `tool_result` part can be matched back to its
 * originating `tool_use`.
 */
type CapturedToolCall = {
  id: string
  toolName: string
  args?: unknown
  result?: unknown
  status: 'ok' | 'error'
  startedAt: string
  endedAt?: string
}

/**
 * A meaningful state change for a single tool call, surfaced live so the run can
 * emit a progress event. Only the first open (`started`) and the terminal
 * `finished` are reported — intermediate arg-refinement ticks are swallowed so
 * the progress feed stays one-line-per-call and never floods the event bus.
 */
type CapturedTransition = {
  callId: string
  toolName: string
  phase: 'started' | 'finished'
  status: 'ok' | 'error'
  input?: unknown
}

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

    // File plane (#12): strip the reserved `__files` envelope BEFORE persisting the
    // run input, so the stored/prompted input stays clean business data and the
    // attachment refs are staged separately.
    const { input: businessInput, files: fileEnvelope } = extractFileInput(input)

    // Open the OpenCode session BEFORE creating the run so its id can be stamped
    // as `externalRunId`. Trace ingestion correlates on `(runtime, externalRunId)`,
    // so stamping the session id at creation lets a later trace POST upsert THIS
    // row instead of creating a duplicate.
    const session = await this.client.createSession()

    const runId = await createRun(this.commandBus, commandCtx, {
      source: ctx.source,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentId,
      input: businessInput,
      parentRunId: ctx.parentRunId ?? null,
      runtime: 'opencode',
      externalRunId: session.id,
      model: entry.defaultModel ?? null,
      processId: ctx.processId ?? null,
      stepId: ctx.stepId ?? null,
    })

    if (ctx.onRunPersisted) {
      try {
        ctx.onRunPersisted(runId)
      } catch (err) {
        console.warn(`[internal] onRunPersisted hook failed for "${agentId}":`, err)
      }
    }

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

    // Tool/skill calls observed on the SSE stream during this run. Collected here
    // so the OpenCode path records spans/tool-calls (#3628) — without this the
    // trace tables stay empty for OpenCode runs since the runner only captured
    // the final outcome.
    const capturedToolCalls: CapturedToolCall[] = []

    // Live progress: broadcast a clientBroadcast event on each tool call's open
    // and finish so a UI trigger can show step-by-step progress while this
    // synchronous run is in flight. Best-effort — a progress emit failure must
    // never affect the run. Correlated on the org (DOM Event Bridge scope) and
    // the run/agent id so a widget can attribute steps without knowing the runId
    // in advance (the first event delivers it).
    let progressSeq = 0
    const emitProgress = (transition: CapturedTransition): void => {
      const sequence = progressSeq++
      void emitAgentOrchestratorEvent('agent_orchestrator.run.progress', {
        id: runId,
        runId,
        agentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        sequence,
        callId: transition.callId,
        tool: friendlyToolName(transition.toolName),
        phase: transition.phase,
        status: transition.status,
        label: deriveProgressLabel(transition.input),
      }).catch((err) => {
        console.warn(`[internal] run.progress emit failed for "${agentId}":`, err)
      })
    }

    // File plane (#12): gate on the agent opt-in AND the global kill-switch, same
    // as the frontmatter render — otherwise the agent has no write permission and
    // there is nothing to capture. Acquiring a workspace leases the shared OpenCode
    // container (serialized by OM_OPENCODE_POOL_SIZE); a failure degrades to a
    // normal (no-file) run rather than failing it.
    const filesEnabled =
      !!entry.files?.enabled &&
      (entry.files.outputs ?? true) &&
      parseBooleanWithDefault(process.env.OM_OPENCODE_FILES_ENABLED, false)
    let workspace: AgentWorkspaceLease | null = null

    try {
      if (filesEnabled) {
        try {
          const workspaceManager = this.container.resolve<AgentWorkspaceManager>('agentWorkspaceManager')
          workspace = await workspaceManager.acquire(sessionToken)
        } catch (err) {
          console.warn(`[internal] failed to acquire agent workspace for "${agentId}"; continuing without file plane:`, err)
        }
      }

      // Phase 2: stage attachment inputs into the sandbox `in/` dir. A staging
      // failure (e.g. a wrong-tenant / missing attachment) FAILS the run — the
      // agent must not run un-grounded on a file it could not read.
      let stagedInputs: StagedInput[] = []
      if (workspace && fileEnvelope && (entry.files?.inputs ?? true)) {
        try {
          const stagerEm = this.container.resolve<EntityManager>('em').fork()
          stagedInputs = await stageAttachments({
            container: this.container,
            em: stagerEm,
            files: fileEnvelope,
            inDir: workspace.inDir,
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
          })
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          await failRun(this.commandBus, commandCtx, { runId, errorMessage: `attachment staging failed: ${detail}` })
          throw new OpenCodeRunFailedError(agentId, `attachment staging failed: ${detail}`)
        }
      }

      const message = this.buildMessage(sessionToken, businessInput, workspace, stagedInputs)

      const startedAtMs = Date.now()
      const capturedOutcome = await this.driveSession({
        sessionId: session.id,
        message,
        openCodeAgentName,
        sessionToken,
        store,
        toolCallSink: capturedToolCalls,
        onProgress: emitProgress,
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
      const latencyMs = Math.max(0, Math.round(Date.now() - startedAtMs))

      await completeRun(this.commandBus, commandCtx, {
        runId,
        output: result,
        resultKind: entry.resultKind,
        // Actionable runs surface the proposal's confidence on the run row;
        // informative runs have no confidence semantics → null (renders `—`).
        confidence: result.kind === 'actionable' ? (result.proposal.confidence ?? null) : null,
      })

      if (result.kind === 'actionable') {
        await createProposal(this.commandBus, commandCtx, {
          source: ctx.source,
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

      await this.ingestSessionTrace(commandCtx, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        agentId,
        externalRunId: session.id,
        toolCalls: capturedToolCalls,
        latencyMs,
      })

      // File plane (#12): scan the sandbox `out/` and capture agent-authored files
      // as encrypted AgentRunArtifacts — BEFORE the `finally` wipes the sandbox.
      // Filesystem-authoritative + fail-closed; best-effort so a capture failure
      // never fails an otherwise-successful run (the JSON outcome still stands).
      if (workspace) {
        try {
          const summary = await collectArtifacts({
            commandBus: this.commandBus,
            commandCtx,
            outDir: workspace.outDir,
            runId,
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
          })
          if (summary.failed.length > 0) {
            console.warn(
              `[internal] agent "${agentId}" artifact capture could not store ${summary.failed.length} file(s) (storage-s3 unavailable?)`,
            )
          }
        } catch (err) {
          console.warn(`[internal] artifact capture threw for "${agentId}":`, err)
        }
      }

      return result
    } finally {
      // Wipe + release the sandbox lease first (frees the pooled container slot),
      // then remove the shared correlation row and best-effort revoke the per-run
      // token so it cannot be reused after the run.
      if (workspace) {
        try {
          await workspace.release()
        } catch (err) {
          console.warn(`[internal] failed to release agent workspace for "${agentId}":`, err)
        }
      }
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

  /**
   * Persist the tool/skill calls observed during the run as trace spans + tool
   * calls, correlating on `(runtime='opencode', externalRunId=session.id)` so the
   * upsert lands on the run row this runner already created (it appends spans
   * without clobbering the run's status/output). Goes through the audited
   * `trace.ingest` command — the same path the HMAC webhook uses — so inline
   * deterministic eval assertions (and LLM-judge sampling) run for OpenCode runs
   * exactly like for externally-ingested ones. Best-effort: a trace-ingest
   * failure must never fail an otherwise-successful run.
   */
  private async ingestSessionTrace(
    commandCtx: ReturnType<typeof buildCommandContext>,
    args: {
      tenantId: string
      organizationId: string
      agentId: string
      externalRunId: string
      toolCalls: CapturedToolCall[]
      latencyMs?: number | null
    },
  ): Promise<void> {
    if (args.toolCalls.length === 0 && args.latencyMs == null) return
    try {
      const spans: TraceSpanIngest[] = args.toolCalls.map((toolCall, index) => ({
        externalSpanId: `${toolCall.id}-${index}`,
        sequence: index,
        name: toolCall.toolName,
        kind: 'tool',
        startedAt: toolCall.startedAt,
        endedAt: toolCall.endedAt ?? null,
        status: toolCall.status,
        toolCalls: [
          {
            toolName: toolCall.toolName,
            requestSummary: toolCall.args,
            responseSummary: toolCall.result,
            status: toolCall.status,
          },
        ],
      }))
      await withAuditedCommand(() =>
        this.commandBus.execute<IngestTraceCommandInput, IngestTraceResult>(
          'agent_orchestrator.trace.ingest',
          {
            input: {
              tenantId: args.tenantId,
              organizationId: args.organizationId,
              payload: {
                runtime: 'opencode',
                externalRunId: args.externalRunId,
                agentId: args.agentId,
                spans,
                ...(args.latencyMs != null ? { latencyMs: args.latencyMs } : {}),
              },
            },
            ctx: commandCtx,
          },
        ),
      )
    } catch (err) {
      console.warn(`[internal] failed to ingest OpenCode trace for "${args.agentId}":`, err)
    }
  }

  private buildMessage(
    sessionToken: string,
    input: unknown,
    workspace: AgentWorkspaceLease | null,
    stagedInputs: StagedInput[] = [],
  ): string {
    const authInstruction = `[Session Authorization: ${sessionToken}. Include "_sessionToken": "${sessionToken}" in EVERY tool call.]`
    const inputText = typeof input === 'string' ? input : JSON.stringify(input)
    // File plane (#12): tell the agent the ABSOLUTE container-side sandbox paths
    // (per-session cwd is unverified — Phase-0 F3). Files written into `out/` are
    // captured as downloadable artifacts; staged attachment inputs live in `in/`.
    let sandboxInstruction = ''
    if (workspace) {
      const stagedList =
        stagedInputs.length > 0
          ? ` Staged input files: ${stagedInputs
              .map((staged) => {
                const filePath = `"${workspace.containerInDir}/${staged.fileName}"`
                return staged.hasSidecar
                  ? `${filePath} (extracted text: "${workspace.containerInDir}/${staged.fileName}.txt")`
                  : filePath
              })
              .join(', ')}.`
          : ` Staged input files, if any, are in "${workspace.containerInDir}/".`
      sandboxInstruction = `\n\n[File sandbox: write any file OUTPUTS you produce into "${workspace.containerOutDir}/" (they will be captured as downloadable artifacts).${stagedList} Write ONLY inside these directories.]`
    }
    return `${authInstruction}\n\n${inputText}${sandboxInstruction}`
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
    toolCallSink: CapturedToolCall[]
    onProgress?: (transition: CapturedTransition) => void
  }): Promise<unknown | typeof NO_OUTCOME> {
    const idleSignal = this.subscribeSession(args.sessionId, args.toolCallSink, args.onProgress)
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
  private subscribeSession(
    sessionId: string,
    toolCallSink: CapturedToolCall[],
    onTransition?: (transition: CapturedTransition) => void,
  ): {
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
        // Match the chat path's session-id derivation: on `message.part.updated`
        // OpenCode carries the session id on `properties.part.sessionID`, not at
        // the top level, so a narrower lookup would mis-scope multi-session
        // streams.
        const eventSessionId =
          (properties.sessionID as string | undefined) ||
          (properties.info as { sessionID?: string } | undefined)?.sessionID ||
          (properties.part as { sessionID?: string } | undefined)?.sessionID ||
          (properties.session as { id?: string } | undefined)?.id ||
          (properties.status as { sessionID?: string } | undefined)?.sessionID
        if (eventSessionId && eventSessionId !== sessionId) return
        // Capture MCP tool/skill calls for the trace (#3628). The same SSE stream
        // that signals idle also carries the tool_use/tool_result parts; the chat
        // path parses them identically (opencode-handlers `message.part.updated`).
        if (type === 'message.part.updated') {
          const transition = captureToolPart(toolCallSink, properties.part)
          if (transition && onTransition) onTransition(transition)
          return
        }
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
    // Guard BOTH ids: an empty `userId` is not just "no roles" — querying
    // UserRole with `user: ""` throws `invalid input syntax for type uuid` and
    // poisons the surrounding workflow transaction (every later statement then
    // fails with 25P02). Callers must pass a real principal; bail out cleanly
    // otherwise.
    if (!tenantId || !userId) return []
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

/**
 * Extract a tool invocation from an OpenCode `message.part.updated` part and fold
 * it into the run's tool-call sink. Delegates schema detection to the shared
 * `normalizeOpenCodeToolPart` helper (`@open-mercato/shared/lib/ai`): OpenCode
 * re-emits the same part on each state transition, so the call is opened on the
 * first `progress` update (keyed by `callId`) and closed on the terminal
 * `finish`. The legacy `tool_use` / `tool_result` shape is handled by the same
 * helper for older OpenCode builds.
 */
function captureToolPart(sink: CapturedToolCall[], rawPart: unknown): CapturedTransition | null {
  const update = normalizeOpenCodeToolPart(rawPart)
  if (!update) return null
  const existing = sink.find((call) => call.id === update.callId)
  if (update.phase === 'progress') {
    if (existing) {
      // Mid-flight arg refinement for an already-open call — no new transition.
      if (update.input !== undefined) existing.args = update.input
      return null
    }
    sink.push({
      id: update.callId,
      toolName: update.toolName,
      args: update.input,
      status: 'ok',
      startedAt: new Date().toISOString(),
    })
    return { callId: update.callId, toolName: update.toolName, phase: 'started', status: 'ok', input: update.input }
  }
  if (existing) {
    if (existing.args === undefined && update.input !== undefined) existing.args = update.input
    existing.result = update.output
    existing.status = update.status
    existing.endedAt = new Date().toISOString()
  } else {
    const now = new Date().toISOString()
    sink.push({
      id: update.callId,
      toolName: update.toolName ?? update.callId,
      args: update.input,
      result: update.output,
      status: update.status,
      startedAt: now,
      endedAt: now,
    })
  }
  return {
    callId: update.callId,
    toolName: update.toolName ?? update.callId,
    phase: 'finished',
    status: update.status,
    input: update.input,
  }
}

/**
 * Shorten an OpenCode MCP tool id to the bare action for the progress feed:
 * `open-mercato_agent_orchestrator_web_search` → `web_search`. The sub-agent
 * delegation tool (`task`) and any unprefixed id pass through unchanged.
 */
function friendlyToolName(rawToolName: string): string {
  return rawToolName.replace(/^open-mercato_agent_orchestrator_/, '')
}

/**
 * Best-effort short human label for a tool call's arguments — the search query
 * or fetched URL — so the progress feed can show "Searching the web — Acme
 * funding". Returns null for tools whose args carry no obvious label. Never
 * exposes the full arg object; only the `query` / `url` / `q` string field.
 */
function deriveProgressLabel(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const candidate = obj.query ?? obj.url ?? obj.q
  if (typeof candidate !== 'string' || candidate.length === 0) return null
  return candidate.length > 120 ? `${candidate.slice(0, 117)}…` : candidate
}

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
