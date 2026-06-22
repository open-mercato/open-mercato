import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { DELEGATE_TOOL_ID, getAgentEntry, ensureAgentsLoaded } from './lib/sdk/defineAgent'
import type { AgentRuntimeService } from './lib/runtime/agentRuntime'
import * as openCodeRunRegistry from './lib/runtime/openCodeRunRegistry'
import { getAgentSkill, getAgentSkillScript } from './lib/runtime/fileAgentSkills'
import { runSandboxedScript } from './lib/runtime/sandboxedScript'
import { getCurrentRunId } from './lib/runtime/runContext'

/** Tool id of the OUTCOME-submission tool an OpenCode file-agent finishes with. */
export const SUBMIT_OUTCOME_TOOL_ID = 'agent_orchestrator.submit_outcome'

/** Tool id of the skill progressive-disclosure fallback (native skills preferred). */
export const LOAD_SKILL_TOOL_ID = 'agent_orchestrator.load_skill'

/** Tool id of the sandboxed skill-script / local-tool runner (Phase 5). */
export const RUN_SKILL_SCRIPT_TOOL_ID = 'agent_orchestrator.run_skill_script'

const delegateInput = z.object({
  agentId: z.string().min(1).describe('Id of the sub-agent to run (must be an informative agent).'),
  input: z.unknown().describe('Input payload passed to the sub-agent (shape is sub-agent specific).'),
})

/**
 * Sub-agent-as-tool: lets a parent agent run another agent as a read-only
 * sub-agent and fan several out in parallel (the model emits multiple calls in
 * one step; the SDK runs them concurrently). Propose-only is preserved:
 *
 *  - the tool is `isMutation: false` — never gated, never a write;
 *  - the target MUST be an `informative` agent (sub-agents inform; only the
 *    parent proposes), so no nested proposals are created;
 *  - the target may NOT itself delegate (no `subAgents`), which caps tree depth
 *    at one and prevents cycles;
 *  - the sub-agent runs under the SAME caller scope/ACL — never escalated.
 *
 * Errors are returned as data (`{ ok: false }`) so one failed sub-task never
 * crashes the parent loop.
 */
const delegateAgentTool: AiToolDefinition = {
  name: DELEGATE_TOOL_ID,
  displayName: 'Delegate to sub-agent',
  description:
    'Run another agent as a read-only sub-agent and return its result. Only informative, non-delegating agents may be targeted. Call multiple times in one step to fan out in parallel.',
  inputSchema: delegateInput,
  requiredFeatures: ['agent_orchestrator.agents.run'],
  isMutation: false,
  tags: ['read', 'agent_orchestrator'],
  async handler(rawInput, ctx) {
    const { agentId, input } = delegateInput.parse(rawInput)
    if (!ctx.tenantId || !ctx.organizationId || !ctx.userId) {
      return { ok: false as const, agentId, error: 'missing tenant/org/user scope' }
    }

    await ensureAgentsLoaded()
    const entry = getAgentEntry(agentId)
    if (!entry) {
      return { ok: false as const, agentId, error: `unknown sub-agent "${agentId}"` }
    }
    if (entry.resultKind !== 'informative') {
      return { ok: false as const, agentId, error: 'only informative sub-agents may be delegated to' }
    }
    if (entry.subAgents.length > 0) {
      return { ok: false as const, agentId, error: 'sub-agents may not delegate further (depth capped at 1)' }
    }

    try {
      const agentRuntime = ctx.container.resolve('agentRuntime') as AgentRuntimeService
      // The parent run is the in-process run currently executing (bound via the
      // run-context AsyncLocalStorage); pass its id so the nested sub-agent run
      // records `parent_run_id` for traceability (Phase 4). Undefined outside a
      // run context (the nested run is then a top-level run).
      const parentRunId = getCurrentRunId()
      const result = await agentRuntime.run(agentId, input, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        ...(parentRunId ? { parentRunId } : {}),
      })
      const data = result.kind === 'informative' ? result.data : result.proposal
      return { ok: true as const, agentId, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false as const, agentId, error: message }
    }
  },
}

const submitOutcomeInput = z.object({
  outcome: z
    .unknown()
    .describe(
      'The structured result, matching the active agent OUTCOME contract. The active agent and its schema are resolved server-side from the run session — never trusted from this call.',
    ),
})

/**
 * Terminal tool an OpenCode file-agent calls to deliver its structured result.
 *
 * The active agent id + compiled OUTCOME result schema are resolved from the
 * per-run correlation store keyed by THIS run's session token (`ctx.sessionId`,
 * which the MCP HTTP server sets to the session token the runner minted) — NOT
 * trusted from the model. The submitted `outcome` is validated against that
 * agent's schema:
 *
 *  - valid   → stored + completion signalled (the waiting runner resolves);
 *              returns `{ ok: true }`.
 *  - invalid → returns `{ ok: false, code: 'outcome_invalid', errors }` so
 *              OpenCode/the agent can correct and retry (NOT thrown).
 *  - missing/stale correlation (no run for this session, or already completed)
 *            → `{ ok: false, code: 'no_active_run' }`.
 *
 * Propose-only: `isMutation: false` — the only state this ever produces is the
 * AgentRun/AgentProposal the runner persists from the captured outcome.
 */
const submitOutcomeTool: AiToolDefinition = {
  name: SUBMIT_OUTCOME_TOOL_ID,
  displayName: 'Submit agent outcome',
  description:
    'Finish the current agent run by submitting its structured outcome. The server validates it against the agent OUTCOME contract; on failure it returns the validation errors so you can correct and resubmit.',
  inputSchema: submitOutcomeInput,
  requiredFeatures: ['agent_orchestrator.agents.run'],
  isMutation: false,
  tags: ['read', 'agent_orchestrator'],
  async handler(rawInput, ctx) {
    const { outcome } = submitOutcomeInput.parse(rawInput)
    // The runner registers the correlation entry keyed by the per-run session
    // token; the MCP HTTP server exposes that token as `ctx.sessionId`.
    const correlationKey = ctx.sessionId
    if (!correlationKey) {
      return { ok: false as const, code: 'no_active_run' as const, error: 'no run session in context' }
    }
    const entry = openCodeRunRegistry.get(correlationKey)
    if (!entry) {
      return { ok: false as const, code: 'no_active_run' as const, error: 'no active run for this session' }
    }
    const parsed = entry.resultSchema.safeParse(outcome)
    if (!parsed.success) {
      return {
        ok: false as const,
        code: 'outcome_invalid' as const,
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }
    }
    const completed = openCodeRunRegistry.complete(correlationKey, parsed.data)
    if (!completed) {
      return { ok: false as const, code: 'no_active_run' as const, error: 'run already completed' }
    }
    return { ok: true as const }
  },
}

const loadSkillInput = z.object({
  skillId: z
    .string()
    .min(1)
    .describe('Id of the skill to load. Must be one of the active agent allowed skills.'),
})

/**
 * Progressive-disclosure FALLBACK for agent-local skills. Native OpenCode skills
 * (generated `SKILL.md` files) are the primary path; this MCP tool returns a
 * skill's full content on demand AND carries TEMPLATE.md/examples that native
 * skills may not bundle.
 *
 * The allowed skill set is the ACTIVE agent's skills — resolved from the per-run
 * correlation store keyed by THIS run's session token (`ctx.sessionId`) — NEVER
 * trusted from the model. Outcomes:
 *
 *  - missing/stale correlation (no run for this session) → `{ ok:false, code:'no_active_run' }`.
 *  - skillId not registered for the active agent → `{ ok:false, code:'skill_not_allowed' }`.
 *  - otherwise → `{ ok:true, instructions, template?, examples }`.
 *
 * Propose-only: `isMutation:false` — it only reads skill content.
 */
const loadSkillTool: AiToolDefinition = {
  name: LOAD_SKILL_TOOL_ID,
  displayName: 'Load agent skill',
  description:
    'Load the full instructions (and optional template + examples) of one of the current agent skills, by skill id.',
  inputSchema: loadSkillInput,
  requiredFeatures: ['agent_orchestrator.agents.run'],
  isMutation: false,
  tags: ['read', 'agent_orchestrator'],
  async handler(rawInput, ctx) {
    const { skillId } = loadSkillInput.parse(rawInput)
    const correlationKey = ctx.sessionId
    if (!correlationKey) {
      return { ok: false as const, code: 'no_active_run' as const, error: 'no run session in context' }
    }
    const run = openCodeRunRegistry.get(correlationKey)
    if (!run) {
      return { ok: false as const, code: 'no_active_run' as const, error: 'no active run for this session' }
    }
    const skill = getAgentSkill(run.agentId, skillId)
    if (!skill) {
      return {
        ok: false as const,
        code: 'skill_not_allowed' as const,
        error: `skill "${skillId}" is not available to the active agent`,
      }
    }
    return {
      ok: true as const,
      instructions: skill.instructions,
      ...(skill.template != null ? { template: skill.template } : {}),
      examples: skill.examples,
    }
  },
}

const runSkillScriptInput = z.object({
  skillId: z
    .string()
    .min(1)
    .describe('Id of the skill the script belongs to (one of the current agent skills).'),
  scriptName: z
    .string()
    .min(1)
    .describe('Script basename without extension (e.g. `scripts/score.ts` → "score").'),
  args: z.unknown().optional().describe('Arguments passed to the script `run(args)` function.'),
})

/**
 * Run one of the active agent's sandboxed helper scripts (Phase 5) — a skill
 * `scripts/<name>.ts` or a local tool file (carried under the synthetic
 * `__agent_tools__` skill id) — and return its value.
 *
 * The active agent + its allowed skill/script set are resolved server-side from
 * the per-run correlation store (`ctx.sessionId`) — NEVER trusted from the model.
 * The script source runs in the Code Mode `isolated-vm` sandbox: no fs/net/
 * imports, a hard 30s cap, and per-call ACL via `requiredFeatures` + the session
 * token. A script is a pure function of its `args`, so this stays propose-only —
 * it can compute, not mutate. Errors are returned as data, never thrown.
 */
const runSkillScriptTool: AiToolDefinition = {
  name: RUN_SKILL_SCRIPT_TOOL_ID,
  displayName: 'Run agent skill script',
  description:
    'Run one of the current agent sandboxed helper scripts by skill id + script name and return its result. Scripts are pure functions of their args (no fs/net/side effects) executed in a sandbox.',
  inputSchema: runSkillScriptInput,
  requiredFeatures: ['agent_orchestrator.agents.run'],
  isMutation: false,
  tags: ['read', 'agent_orchestrator'],
  async handler(rawInput, ctx) {
    const { skillId, scriptName, args } = runSkillScriptInput.parse(rawInput)
    const correlationKey = ctx.sessionId
    if (!correlationKey) {
      return { ok: false as const, code: 'no_active_run' as const, error: 'no run session in context' }
    }
    const run = openCodeRunRegistry.get(correlationKey)
    if (!run) {
      return { ok: false as const, code: 'no_active_run' as const, error: 'no active run for this session' }
    }
    if (!getAgentSkill(run.agentId, skillId)) {
      return {
        ok: false as const,
        code: 'skill_not_allowed' as const,
        error: `skill "${skillId}" is not available to the active agent`,
      }
    }
    const script = getAgentSkillScript(run.agentId, skillId, scriptName)
    if (!script) {
      return {
        ok: false as const,
        code: 'script_not_found' as const,
        error: `script "${scriptName}" not found in skill "${skillId}"`,
      }
    }
    const outcome = await runSandboxedScript({ source: script.source, args })
    if (!outcome.ok) {
      return { ok: false as const, code: outcome.code, error: outcome.error }
    }
    return { ok: true as const, result: outcome.result }
  },
}

export const aiTools: AiToolDefinition[] = [
  delegateAgentTool,
  submitOutcomeTool,
  loadSkillTool,
  runSkillScriptTool,
]

export default aiTools
