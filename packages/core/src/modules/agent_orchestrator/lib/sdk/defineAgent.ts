import {
  defineAiAgent,
  type AiAgentDefinition,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import type { ZodTypeAny } from 'zod'
import { getSkillEntry } from './defineSkill'

export type AgentResultKind = 'actionable' | 'informative'

/**
 * Where an agent runs. `'in-process'` agents are authored with `defineAgent` and
 * execute via the Vercel AI SDK object mode in this process. `'opencode'` agents
 * are authored as `agents/<id>/` file conventions (CLAUDE.md + OUTCOME.md),
 * registered via `registerFileAgent`, and run on the OpenCode runtime. The field
 * is additive (BC-safe): every existing agent stays `'in-process'`.
 */
export type AgentRuntime = 'in-process' | 'opencode'

/**
 * Tool id of the built-in delegation tool (declared in agent_orchestrator's
 * `ai-tools.ts`). An agent that lists `subAgents` automatically gains this tool,
 * letting it run other (read-only, informative) agents as sub-agents — and fan
 * them out in parallel. Sub-agents stay propose-only: they only inform.
 */
export const DELEGATE_TOOL_ID = 'agent_orchestrator.delegate_agent'

export interface DefineAgentInput {
  /** 'module.agent' — STABLE contract id (see BACKWARD_COMPATIBILITY.md). */
  id: string
  moduleId: string
  label: string
  description: string
  /** System prompt → AiAgentDefinition.systemPrompt. */
  instructions: string
  /**
   * defineAiTool ids the agent may call. Propose-only stays structural: the agent
   * is declared read-only, so any `isMutation: true` tool is stripped by the
   * runtime — only READ tools survive. When non-empty the runtime runs a read-only
   * tool loop (`runAiAgentObject({ enableTools })`) so the agent can gather data
   * before proposing; all writes still flow through proposal → disposition →
   * effector, never the agent directly.
   */
  tools?: string[]
  /**
   * Skill ids (see `defineSkill`). Each resolved skill injects its instructions
   * into the system prompt and unions its read-only tools into the agent's
   * allowlist. Unknown ids are warned and skipped (the agent still loads).
   */
  skills?: string[]
  /**
   * Agent ids this agent may delegate to as sub-agents. When non-empty the agent
   * gains the `DELEGATE_TOOL_ID` tool and a prompt section listing the ids; the
   * model calls them (in parallel when independent). Sub-agents MUST be
   * informative (they inform; only the parent proposes) and may not themselves
   * delegate — enforced by the delegate tool, capping the tree depth.
   */
  subAgents?: string[]
  defaultProvider?: string
  defaultModel?: string
  /** Object-safe loop subset only. */
  loop?: { maxSteps?: number }
  /**
   * Runtime the agent executes on. Defaults to `'in-process'`; `defineAgent`
   * only ever produces in-process agents, so this is reserved for future use
   * and kept additive.
   */
  runtime?: AgentRuntime
  /** Zod from data/validators.ts; IS the output.schema (single source). */
  result: { kind: AgentResultKind; schema: ZodTypeAny }
}

export interface AgentRegistryEntry {
  id: string
  moduleId: string
  resultKind: AgentResultKind
  schema: ZodTypeAny
  tools: string[]
  skills: string[]
  subAgents: string[]
  label: string
  description: string
  /** System prompt the agent runs with. */
  instructions: string
  defaultProvider?: string
  defaultModel?: string
  /** Object-safe loop subset (see DefineAgentInput). */
  loop?: { maxSteps?: number }
  /** Runtime the agent executes on. Always set (default `'in-process'`). */
  runtime: AgentRuntime
}

const registry = new Map<string, AgentRegistryEntry>()

export function defineAgent(input: DefineAgentInput): AiAgentDefinition {
  if (registry.has(input.id)) {
    throw new Error(`[internal] duplicate agent id "${input.id}"`)
  }
  // Resolve declared skills from the registry (ai-skills.ts must be imported
  // before the agents that reference them — ai-agents.ts does this at the top).
  // Each skill injects real instructions AND contributes its read-only tools.
  const ownTools = input.tools ?? []
  const skillIds = input.skills ?? []
  const resolvedSkills = skillIds
    .map((skillId) => {
      const skill = getSkillEntry(skillId)
      if (!skill) {
        console.warn(`[internal] agent "${input.id}" references unknown skill "${skillId}"; skipping.`)
      }
      return skill
    })
    .filter((skill): skill is NonNullable<typeof skill> => !!skill)
  const skillTools = resolvedSkills.flatMap((skill) => skill.tools)
  // Sub-agents: when declared, the agent gains the delegation tool so it can run
  // other agents as read-only sub-agents (and fan them out in parallel).
  const subAgents = input.subAgents ?? []
  const delegationTools = subAgents.length > 0 ? [DELEGATE_TOOL_ID] : []
  const effectiveTools = Array.from(new Set([...ownTools, ...skillTools, ...delegationTools]))

  registry.set(input.id, {
    id: input.id,
    moduleId: input.moduleId,
    resultKind: input.result.kind,
    schema: input.result.schema,
    tools: ownTools,
    skills: skillIds,
    subAgents,
    label: input.label,
    description: input.description,
    instructions: input.instructions,
    defaultProvider: input.defaultProvider,
    defaultModel: input.defaultModel,
    loop: input.loop,
    runtime: 'in-process',
  })
  const skillSections = resolvedSkills.map(
    (skill) => `## Skill: ${skill.label}\n${skill.instructions}`,
  )
  const subAgentSection = subAgents.length
    ? `## Sub-agents\nYou may delegate independent sub-tasks to these agents by calling the \`${DELEGATE_TOOL_ID}\` tool with { agentId, input }. When several sub-tasks are independent, issue multiple delegate calls in the SAME step so they run in parallel, then combine their results. Available sub-agents: ${subAgents.join(', ')}.`
    : null
  const systemPrompt = [input.instructions, ...skillSections, ...(subAgentSection ? [subAgentSection] : [])]
    .join('\n\n')
  return defineAiAgent({
    id: input.id,
    moduleId: input.moduleId,
    label: input.label,
    description: input.description,
    systemPrompt,
    // Effective read-only allowlist = the agent's own tools + every read tool its
    // skills contribute. Read-only policy still strips any mutation tool.
    allowedTools: effectiveTools,
    executionMode: 'object',
    // Read-only is the propose-only guarantee: the runtime strips every
    // `isMutation: true` tool, so even a mis-declared write tool can never fire.
    // Reads are allowed; writes only ever happen via the proposal/effector path.
    readOnly: true,
    mutationPolicy: 'read-only',
    defaultProvider: input.defaultProvider,
    defaultModel: input.defaultModel,
    loop: input.loop,
    output: { schemaName: input.id.replace(/\W+/g, '_'), schema: input.result.schema },
  })
}

/**
 * Register a file-defined (OpenCode) agent directly into the SAME registry that
 * `defineAgent` writes to, so file agents are discoverable via `getAgentEntry`,
 * `listAgentEntries`, and the Agents list/detail without going through
 * `defineAiAgent` (file agents don't run in-process, so they need no
 * `AiAgentDefinition`). Same dup-id guard as `defineAgent`.
 */
export function registerFileAgent(entry: AgentRegistryEntry): void {
  if (registry.has(entry.id)) {
    throw new Error(`[internal] duplicate agent id "${entry.id}"`)
  }
  registry.set(entry.id, entry)
}

export function getAgentEntry(id: string): AgentRegistryEntry | undefined {
  return registry.get(id)
}

export function listAgentEntries(): AgentRegistryEntry[] {
  return [...registry.values()]
}

let agentsLoadPromise: Promise<void> | null = null

/**
 * Load every module's agents into the registry. `defineAgent` registers by import
 * side effect, so an agent declared in ANY module is only discoverable once that
 * module's `ai-agents.ts` has executed. The generated `ai-agents.generated.ts`
 * aggregator statically imports every module's `ai-agents.ts`; ai_assistant's
 * `loadAgentRegistry()` imports that aggregator, so calling it runs every
 * `defineAgent()` across all modules and fills this registry. Packages must not
 * import the app-generated file directly, so we go through ai_assistant.
 *
 * Fallback: if the aggregator is unavailable (tests, fresh checkout before
 * `yarn generate`), import agent_orchestrator's own `ai-agents.ts` so at least
 * its built-in agents resolve.
 */
async function loadAllAgentModules(): Promise<void> {
  try {
    const { loadAgentRegistry } = await import(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry'
    )
    await loadAgentRegistry()
  } catch {
    // ignore — fall through to the local import below
  }
  if (registry.size === 0) {
    await import('../../ai-agents')
  }
  await loadFileAgents()
}

/**
 * Load file-defined (OpenCode) agents from the committed, generator-owned
 * manifest (`generated/file-agents.generated.ts`). The manifest stores PLAIN
 * data (raw JSON-Schema, not a Zod instance); for each descriptor we recompile
 * the result schema via `compileOutcome` and register it with `runtime:'opencode'`.
 * The import is guarded: the manifest may be absent or empty before the first
 * `yarn generate`, and a descriptor whose schema fails to compile is skipped
 * (warned) so one bad agent never blocks the rest.
 */
/**
 * Resolve a predicate `(toolId) => boolean` reporting whether a tool is
 * registered with `isMutation: true`, so the propose-only gate can reject file
 * agents that declare write tools. Loads the module tool registry first; if the
 * registry is unavailable (e.g. a unit-test harness that never imported the AI
 * tooling), the predicate fails CLOSED on a known prefix-free basis: it returns
 * `false` for every id (no false rejections), and the agent-file allowlist plus
 * session-token ACL remain the runtime gates.
 */
async function loadMutationToolPredicate(): Promise<(toolId: string) => boolean> {
  try {
    const { loadAllModuleTools } = await import(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader'
    )
    const { getToolRegistry } = await import(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry'
    )
    try {
      await loadAllModuleTools()
    } catch {
      // Tools may already be loaded, or loading is a no-op in this harness.
    }
    const registry = getToolRegistry()
    return (toolId: string): boolean => {
      const tool = registry.getTool(toolId) as { isMutation?: boolean } | undefined
      return !!tool?.isMutation
    }
  } catch {
    return () => false
  }
}

async function loadFileAgents(): Promise<void> {
  let descriptors: import('../../generated/file-agents.generated').FileAgentDescriptor[]
  try {
    const manifest = await import('../../generated/file-agents.generated')
    descriptors = manifest.fileAgentDescriptors ?? []
  } catch {
    return
  }
  const { compileOutcome } = await import('./outcomeSchema')
  const { registerAgentSkills } = await import('../runtime/fileAgentSkills')
  const isMutationTool = await loadMutationToolPredicate()
  // Flatten each descriptor's nested sub-agents (Phase 4) so they register as
  // individual file agents too: they are informative, individually runnable, and
  // discoverable in the Agents list/detail. A sub-agent flows through the SAME
  // propose-only mutation-tool gate below; the registry dup-id guard prevents a
  // duplicate id (a sub-agent that collides with another agent's id is skipped).
  const allDescriptors = descriptors.flatMap((descriptor) => [
    descriptor,
    ...(descriptor.subAgentDescriptors ?? []),
  ])
  for (const descriptor of allDescriptors) {
    if (registry.has(descriptor.id)) continue
    // Propose-only generation gate (contract C8): a file agent may NEVER declare
    // a tool registered with `isMutation: true`. The OpenCode MCP server does NOT
    // strip mutation tools (it filters per-call ACL only), so the agent-file
    // read-only allowlist is the hard gate — and a mis-declared write tool must
    // not even reach registration. We enforce at LOAD time (not in the CLI
    // generator) because the CLI cannot import core's tool registry to know which
    // ids are mutations; the tool registry is only resolvable at runtime. A
    // violating agent is rejected (skipped + warned) so the rest still load.
    const mutationTool = descriptor.tools.find((toolId) => isMutationTool(toolId))
    if (mutationTool) {
      console.warn(
        `[internal] file agent "${descriptor.id}" declares mutation tool "${mutationTool}"; ` +
          'file agents are propose-only and may only list read-only tools — skipping registration.',
      )
      continue
    }
    try {
      const { resultSchema } = compileOutcome({
        kind: descriptor.resultKind,
        schema: descriptor.outcomeSchema,
      })
      registerFileAgent({
        id: descriptor.id,
        moduleId: descriptor.moduleId,
        resultKind: descriptor.resultKind,
        schema: resultSchema,
        tools: descriptor.tools,
        skills: descriptor.skills,
        subAgents: descriptor.subAgents,
        label: descriptor.label,
        description: descriptor.description,
        instructions: descriptor.instructions,
        defaultProvider: descriptor.provider,
        defaultModel: descriptor.model,
        loop: descriptor.maxSteps != null ? { maxSteps: descriptor.maxSteps } : undefined,
        runtime: 'opencode',
      })
      // Phase 3: register the agent's resolved skill content into the runtime
      // lookup so `load_skill` can return it without fs access. Optional + BC: a
      // descriptor without `skillsContent` registers no skills (cleared).
      registerAgentSkills(descriptor.id, descriptor.skillsContent ?? [])
    } catch (err) {
      console.warn(`[internal] failed to load file agent "${descriptor.id}":`, err)
    }
  }
}

/**
 * Ensure agents from every module have registered before the registry is read.
 * Idempotent: skips when already populated, and the underlying imports are no-ops
 * once their modules have executed. Code paths that don't transitively import any
 * `ai-agents.ts` — notably the workflow background executor and the agents API —
 * call this first so they never read an empty registry.
 */
export async function ensureAgentsLoaded(): Promise<void> {
  if (registry.size > 0) return
  if (!agentsLoadPromise) {
    agentsLoadPromise = loadAllAgentModules()
      .then(() => undefined)
      .catch((err) => {
        agentsLoadPromise = null
        throw err
      })
  }
  await agentsLoadPromise
}
