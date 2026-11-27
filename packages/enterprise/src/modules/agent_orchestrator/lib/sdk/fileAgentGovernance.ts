import { normalizeAgentPrincipalDeclaration } from '../../data/validators'
import { parseAgentIntegrityRules, parseAgentUntrustedInputs } from '../guardrails/integrity/declaration'
import {
  DELEGATE_TOOL_ID,
  FILE_AGENT_LOAD_SKILL_TOOL_ID,
  FILE_AGENT_RUN_SKILL_SCRIPT_TOOL_ID,
  parseAgentModelSettings,
  type AgentRegistryEntry,
} from './defineAgent'

/**
 * Governance declarations of a file-defined agent, read by the generator from
 * `agents/<id>/GOVERNANCE.json` as plain JSON. The keys are the ones
 * `defineAgent` accepts and are validated with the same parsers.
 */
export type FileAgentGovernanceInput = {
  principal?: unknown
  integrity?: unknown
  untrustedInputs?: unknown
  modelSettings?: unknown
}

type GovernedEntry = Pick<
  AgentRegistryEntry,
  'id' | 'schema' | 'tools' | 'subAgents' | 'principal' | 'integrity' | 'untrustedInputs' | 'modelSettings'
>

/**
 * Parse a file agent's governance declarations onto its registry entry, exactly
 * as `defineAgent` does for a code agent. Integrity paths are checked against the
 * authored result schema and `prepare_step` rules against the tools the agent can
 * reach. Throws an `[internal]` error naming the agent when any declaration is
 * invalid; the loader then refuses to register the agent.
 */
export function applyFileAgentGovernance(
  entry: GovernedEntry,
  governance: FileAgentGovernanceInput | undefined,
  options: { hasSkills: boolean },
): void {
  if (!governance) return
  const effectiveTools = Array.from(
    new Set([
      ...entry.tools,
      ...(options.hasSkills ? [FILE_AGENT_LOAD_SKILL_TOOL_ID, FILE_AGENT_RUN_SKILL_SCRIPT_TOOL_ID] : []),
      ...(entry.subAgents.length > 0 ? [DELEGATE_TOOL_ID] : []),
    ]),
  )
  const principal = normalizeAgentPrincipalDeclaration(entry.id, governance.principal)
  const integrity = parseAgentIntegrityRules(entry.id, entry.schema, governance.integrity, { effectiveTools })
  const untrustedInputs = parseAgentUntrustedInputs(entry.id, governance.untrustedInputs)
  const modelSettings = parseAgentModelSettings(entry.id, governance.modelSettings)
  if (principal) entry.principal = principal
  if (integrity) entry.integrity = integrity
  if (untrustedInputs) entry.untrustedInputs = untrustedInputs
  if (modelSettings) entry.modelSettings = modelSettings
}

/**
 * The governance declarations the OpenCode runtime cannot honour: it screens no
 * untrusted inputs, applies no model settings, runs tools under the caller's
 * session ACL only (so a principal in `intersect` mode — declared, or inherited
 * from `OM_AGENT_TOOL_ACL_MODE` via `resolveToolAclMode` — would silently widen), and has no
 * step hook to force a `prepare_step` tool consultation. A file agent that
 * declares any of them must run natively or not at all.
 */
export function listOpenCodeUnsupportedGovernance(
  entry: Pick<AgentRegistryEntry, 'principal' | 'integrity' | 'untrustedInputs' | 'modelSettings'>,
  resolveToolAclMode: (entry: Pick<AgentRegistryEntry, 'principal'>) => string | undefined = (target) =>
    target.principal?.toolAcl,
): string[] {
  const unsupported: string[] = []
  if (entry.untrustedInputs?.length) unsupported.push('untrustedInputs')
  if (entry.modelSettings) unsupported.push('modelSettings')
  if (entry.principal && resolveToolAclMode(entry) === 'intersect') unsupported.push('principal.toolAcl=intersect')
  if (entry.integrity?.some((rule) => rule.kind === 'tool_consulted' && rule.enforce === 'prepare_step')) {
    unsupported.push('integrity.enforce=prepare_step')
  }
  return unsupported
}
