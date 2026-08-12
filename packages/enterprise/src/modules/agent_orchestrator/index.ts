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
// External agent seam — a provider package authors its agent with
// `defineExternalAgent` (in its `ai-agents.ts`) and registers its connector with
// `registerExternalAgentConnector` (in its `di.ts`).
export { defineExternalAgent } from './lib/sdk/defineExternalAgent'
export type { DefineExternalAgentInput } from './lib/sdk/defineExternalAgent'
export {
  registerExternalAgentConnector,
  getExternalAgentConnector,
  listExternalAgentConnectors,
} from './lib/runtime/externalConnectorRegistry'
export type {
  ExternalAgentConnector,
  ExternalAgentConnectorScope,
  ExternalAgentConnectorStartArgs,
  ExternalAgentConnectorStartResult,
} from './lib/runtime/externalConnectorRegistry'
export { AgentRuntimeService, AgentNotFoundError, AgentOutputInvalidError, AgentGuardrailBlockedError } from './lib/runtime/agentRuntime'
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
  proposalOptionSchema,
  agentProposalSchema,
  autoDispositionBlockSchema,
  agentResultSchema,
  baseAgentResultSchema,
  dealHealthCheckResult,
  disposeProposalSchema,
  proposalListQuerySchema,
  guardrailVerdictSchema,
  guardrailCheckSchema,
  guardrailEvidenceSchema,
  guardResultsSchema,
  guardrailSetBodySchema,
  groundingClaimSchema,
  groundingCitationSchema,
  citableSourceSchema,
} from './data/validators'
export {
  normalizeProposalEnvelope,
  rankProposalOptions,
  leadProposalOption,
  findProposalOption,
  listProposalOptionIds,
  deriveEnvelopeConfidence,
  readProposalActions,
  replaceOptionActions,
  isProposalEnvelope,
} from './data/proposalEnvelope'
export { autoApprovable, evaluateAutoApproval } from './lib/disposition/dispositionService'
export type { AutoApprovalDecision } from './lib/disposition/dispositionService'
export type {
  ProposedAction,
  ProposalOption,
  AutoDispositionBlock,
  AgentProposalPayload,
  AgentResult,
  DealHealthCheckResult,
  ProposalDisposition,
  DisposeProposalInput,
  ProposalListQuery,
  GuardrailVerdict,
  GuardrailCheck,
  GuardrailEvidence,
  GuardResults,
  GuardrailPhaseInput,
  GuardrailKindInput,
  GuardrailResultInput,
  GuardrailSetBody,
  GroundingClaim,
  GroundingCitation,
  CitableSource,
} from './data/validators'

// Runtime guardrails (Phase 1) — service + constant for cross-module consumers.
export { GuardrailService, GUARDRAIL_SET_VERSION } from './lib/guardrails/guardrailService'
export type { CheckOutputArgs, CheckInputArgs } from './lib/guardrails/guardrailService'

// Runtime guardrails (Phase 4) — grounding sets + cite-or-abstain check.
export {
  registerGroundingSet,
  resolveGroundingSet,
  listGroundingSets,
  guardrailSetVersionFor,
} from './lib/guardrails/groundingSets'
export { checkGrounding, evaluateGrounding } from './lib/guardrails/grounding'
export { syncGroundingSets, resolveCurrentGroundingSet } from './lib/guardrails/syncGroundingSets'

// Context overlay (Phase 1) — TDCR resolver + registry + provenance schemas for
// trace ("context assembled" panel), guardrails grounding, and compliance lineage.
export {
  ContextResolverImpl,
  ContextModuleNotFoundError,
  assembleInputSchema,
  registerContextModule,
  resolveContextModule,
  listContextCapabilities,
  entityProvenance,
  estimateTokens,
  packCandidates,
} from './lib/context'
export type {
  ContextResolver,
  AssembleInput,
  AssembleResult,
  RetrieveScope,
  RetrievedSnippet,
  ContextModule,
  ContextSourceDecl,
  ContextSourceHit,
  PackCandidate,
  PackResult,
} from './lib/context'
export {
  contextSourceKind,
  contextRoutedSourceSchema,
  contextPrunedSourceSchema,
  contextProvenanceSchema,
  contextRedactionAppliedSchema,
  contextBundleRoutedSourcesSchema,
  contextBundlePrunedSourcesSchema,
  contextBundleSourcesSchema,
  contextBundleRedactionAppliedSchema,
  contextBundleListQuerySchema,
} from './data/validators'
export type {
  ContextSourceKind,
  ContextRoutedSource,
  ContextPrunedSource,
  ContextProvenance,
  ContextRedactionApplied,
  ContextBundleListQuery,
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
