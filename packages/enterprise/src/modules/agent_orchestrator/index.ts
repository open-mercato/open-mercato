import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'agent_orchestrator',
  title: 'Agent Orchestrator',
  version: '0.1.0',
  description: 'Callable Agent SDK core: defineAgent, agentRuntime, runs and proposals.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export { features } from './acl'

// Public re-exports (single source of the SDK + result contract).
export { defineAgent, getAgentEntry, listAgentEntries } from './lib/sdk/defineAgent'
export type { DefineAgentInput, AgentRegistryEntry, AgentResultKind } from './lib/sdk/defineAgent'
export { AgentRuntimeService, AgentNotFoundError, AgentOutputInvalidError } from './lib/runtime/agentRuntime'
export type { AgentRunCtx } from './lib/runtime/agentRuntime'
export { AgentWorkflowBridgeService } from './lib/runtime/invokeAgentForWorkflow'
export type {
  AgentWorkflowBridge,
  InvokeAgentForWorkflowArgs,
  InvokeAgentForWorkflowOutcome,
} from './lib/runtime/invokeAgentForWorkflow'
export { executeProposal } from './lib/runtime/executeProposal'
export type { ExecuteProposalActionResult } from './lib/runtime/executeProposal'
export {
  proposedActionSchema,
  agentProposalSchema,
  agentResultSchema,
  baseAgentResultSchema,
  dealHealthCheckResult,
  disposeProposalSchema,
  proposalListQuerySchema,
} from './data/validators'
export type {
  ProposedAction,
  AgentProposalPayload,
  AgentResult,
  DealHealthCheckResult,
  ProposalDisposition,
  DisposeProposalInput,
  ProposalListQuery,
} from './data/validators'

// Disposition seam (area 03) — consumed inline by area 02's INVOKE_AGENT executor.
export type {
  DispositionService,
  DispositionOutcome,
  DispositionOnResult,
  DispositionCtx,
} from './lib/disposition/dispositionService'
export { disposeProposalCommand } from './commands/dispose'
export type {
  DisposeProposalCommandInput,
  DisposeProposalCommandResult,
} from './commands/dispose'
