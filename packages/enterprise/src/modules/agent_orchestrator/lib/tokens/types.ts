/**
 * Token-usage breakdown for a file-defined (OpenCode) agent's construction
 * elements. Estimated with the shared `o200k_base` tokenizer (see
 * `@open-mercato/shared/lib/ai/token-count`) — treat every number as an
 * estimate, not an exact model token count.
 *
 * This is the single source of truth for the shape. The CLI generator
 * (`packages/cli/.../extensions/agent-files.ts`) mirrors the walker that
 * produces it and bakes the result into `file-agents.generated.ts`; the
 * `computeAgentTokenUsageFromDir` walker in this module recomputes it live for
 * the `agent_orchestrator token-usage` CLI command. Both MUST stay in sync.
 */

/** A single counted file, path relative to the agent directory. */
export type TokenizedFile = {
  path: string
  tokens: number
}

/** Per-skill subtotal with a breakdown of its subfiles (SKILL.md, TEMPLATE.md, examples/*, scripts/*). */
export type SkillTokenUsage = {
  id: string
  tokens: number
  files: TokenizedFile[]
}

/** Per-tool count (`tools/<name>.ts`). */
export type ToolTokenUsage = {
  name: string
  path: string
  tokens: number
}

/** Per-sub-agent grand total (`sub-agents/<id>/`). */
export type SubAgentTokenUsage = {
  id: string
  tokens: number
}

export type AgentTokenUsage = {
  /** Grand total across every element, INCLUDING sub-agents. */
  total: number
  /** Total EXCLUDING sub-agents (AGENT.md + OUTCOME.md + skills + tools). */
  self: number
  /** AGENT.md */
  agent: number
  /** OUTCOME.md */
  outcome: number
  skills: SkillTokenUsage[]
  tools: ToolTokenUsage[]
  subAgents: SubAgentTokenUsage[]
}
