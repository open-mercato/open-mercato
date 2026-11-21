import type { AgentResult } from '../../data/validators'

/**
 * The payload an agent run hands back to a caller that asked for "the result":
 * a research finding as its `data`, a proposal as its envelope, and produced
 * files as `{ artifacts, summary }`. Each kind keeps its own shape — flattening
 * them would make a finding, an intent and a file list indistinguishable.
 * Shared by the `delegate_agent` tool and the ai-assistant run dispatcher.
 */
export function agentResultPayload(result: AgentResult): unknown {
  if (result.kind === 'research') return result.data
  if (result.kind === 'proposal') return result.proposal
  return { artifacts: result.artifacts, summary: result.summary }
}
