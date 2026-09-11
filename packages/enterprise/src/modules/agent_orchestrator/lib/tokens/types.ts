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

/**
 * A single counted file, path relative to the agent directory.
 *
 * `path` is ALWAYS `/`-separated, on every platform. It is a wire value the
 * Files tab splits into a folder tree, so it must not carry the host's native
 * separator — `path.join` on Windows yields `skills\\x\\SKILL.md`, which the
 * tree reads as one segment and renders flat. Producers normalize; see
 * `toPosixRelativePath` in `computeAgentTokenUsage.ts` and its CLI mirror.
 */
export type TokenizedFile = {
  path: string
  tokens: number
}

/**
 * A single raw definition file of a file-defined (OpenCode) agent, baked into
 * `file-agents.generated.ts` at `yarn generate` time so the Files tab can read
 * the agent's source without any runtime filesystem access. `path` is relative
 * to the agent directory and ALWAYS `/`-separated on every platform (sub-agent
 * files are prefixed `sub-agents/<id>/`);
 * `tokens` is the `o200k_base` count of the file; `inContext` is `true` for
 * files that form the agent's constructed prompt (AGENT.md, OUTCOME.md, skills,
 * tools) and `false` for auxiliary files (SAMPLE.json, FACTS.json) that do not.
 */
export type FileAgentFile = {
  path: string
  content: string
  tokens: number
  inContext: boolean
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
