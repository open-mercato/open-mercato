import type { AgentRegistryEntry } from './defineAgent'

/**
 * Where an agent is authored. Entries registered before `definitionSource`
 * existed (tests, out-of-tree `registerFileAgent` callers) fall back to the old
 * signal: an OpenCode entry carrying baked source files is a file agent.
 */
export function resolveAgentDefinitionSource(
  entry: Pick<AgentRegistryEntry, 'definitionSource' | 'runtime' | 'sourceFiles'>,
): 'code' | 'file' {
  if (entry.definitionSource) return entry.definitionSource
  return entry.runtime === 'opencode' && entry.sourceFiles ? 'file' : 'code'
}
