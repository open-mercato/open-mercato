import { defineProcessDiRegistrar, asScopedService } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue, asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import {
  AgentRun,
  AgentProposal,
  AgentSpan,
  AgentToolCall,
  AgentCorrection,
  AgentEvalCase,
  AgentEvalAssertion,
  AgentEvalCaseRun,
  AgentEvalSuiteRun,
  AgentEvalResult,
  AgentMetricRollup,
  AgentGuardrailCheck,
  AgentGuardrailSet,
  AgentContextBundle,
  AgentPrincipal,
  AgentDelegationGrant,
  ProcessDefinition,
  ProcessInstance,
} from './data/entities'
import { provisionAgentPrincipal, resolveAgentPrincipal } from './lib/identity/agentPrincipalService'
import {
  createAgentDelegationGrant,
  resolveAgentDelegationGrant,
} from './lib/identity/agentDelegationGrantService'
import {
  issueAgentToken,
  verifyAgentToken,
  provisionAgentClientSecret,
} from './lib/identity/agentTokenService'
import {
  getAgentAuthDiscovery,
  registerAgentViaIdJag,
  verifyIdJagAssertion,
} from './lib/identity/agentAuthMdService'
import { AgentRuntimeService } from './lib/runtime/agentRuntime'
import { GuardrailService } from './lib/guardrails/guardrailService'
import { DbAgentRunSessionStore } from './lib/runtime/agentRunSessionStore'
import { AgentWorkspaceManager } from './lib/runtime/agentWorkspaceManager'
import { DispositionServiceImpl } from './lib/disposition/dispositionService'
import { AgentWorkflowBridgeService } from './lib/runtime/invokeAgentForWorkflow'
import { ContextResolverImpl } from './lib/context/contextResolver'
import { DocumentIngestServiceImpl } from './lib/context/documentIngest'
import { resolveDefaultOcrProvider } from './lib/context/documentOcrProvider'
import { buildWebSearchEngine } from './lib/webSearch/registry'
import type { DispositionService } from './lib/disposition/dispositionService'
import { registerWorkInboxSources } from '@open-mercato/core/modules/workflows/lib/work-inbox/provider'
import {
  agentDispositionWorkInboxSource,
  AGENT_ORCHESTRATOR_MODULE_ID,
} from './lib/workInbox/agentDispositionSource'

// Registered at module-DI load time (top-level, like the core `user_task`
// source) so the queue is present before the first work-inbox request resolves
// `workInboxService`. Registration merges by module id, so load order between
// this module and workflows is irrelevant, and on an install without enterprise
// the inbox simply lists workflow tasks (spec §2.3).
//
// The source declares `administrativeQueueFeature`, which is what gives
// disposition work a visibility class of its own under §6.4: an item nobody was
// assigned is admitted to holders of `agent_orchestrator.proposals.view` rather
// than to nobody at all. Nothing in `dispositionService.ts` changes — the
// auto-approve boundary is not touched.
registerWorkInboxSources([
  { moduleId: AGENT_ORCHESTRATOR_MODULE_ID, sources: [agentDispositionWorkInboxSource] },
])

function registerLegacy(container: AppContainer) {
  container.register({
    AgentRun: asValue(AgentRun),
    AgentProposal: asValue(AgentProposal),
    AgentSpan: asValue(AgentSpan),
    AgentToolCall: asValue(AgentToolCall),
    AgentCorrection: asValue(AgentCorrection),
    AgentEvalCase: asValue(AgentEvalCase),
    AgentEvalAssertion: asValue(AgentEvalAssertion),
    AgentEvalSuiteRun: asValue(AgentEvalSuiteRun),
    AgentEvalCaseRun: asValue(AgentEvalCaseRun),
    AgentEvalResult: asValue(AgentEvalResult),
    AgentMetricRollup: asValue(AgentMetricRollup),
    AgentGuardrailCheck: asValue(AgentGuardrailCheck),
    AgentGuardrailSet: asValue(AgentGuardrailSet),
    AgentContextBundle: asValue(AgentContextBundle),
    AgentPrincipal: asValue(AgentPrincipal),
    AgentDelegationGrant: asValue(AgentDelegationGrant),
    ProcessDefinition: asValue(ProcessDefinition),
    ProcessInstance: asValue(ProcessInstance),
    // Identity overlay (Wave 4, Phase 1): provisions a non-interactive agent
    // `User` (kind='agent') + a scoped `Role` so every internal-agent write is
    // attributed to a concrete actor id. Idempotent + org-scoped. The bound
    // functions resolve `em` from the container at call time.
    agentPrincipalService: asScopedService((container) => (asFunction(() => ({
      provision: provisionAgentPrincipal.bind(null, container),
      resolve: resolveAgentPrincipal.bind(null, container),
    })).scoped()).resolve(container)),
    // Identity overlay (Wave 4, Phase 3): external-agent OAuth client-credentials
    // token server + delegation grants. The `/token` server mints a scoped,
    // short-lived, revocable JWT (signAudienceJwt('agent', …)) bound to the
    // principal + an active AgentDelegationGrant; verification re-checks the grant
    // per request so revocation is immediate. Built on api_keys (bcrypt secret) +
    // jwt.ts — no hand-rolled crypto. The bound functions resolve `em` at call time.
    agentTokenService: asScopedService((container) => (asFunction(() => ({
      issue: issueAgentToken.bind(null, container),
      verify: verifyAgentToken.bind(null, container),
      provisionClientSecret: provisionAgentClientSecret.bind(null, container),
    })).scoped()).resolve(container)),
    agentDelegationGrantService: asScopedService((container) => (asFunction(() => ({
      create: createAgentDelegationGrant.bind(null, container),
      resolve: resolveAgentDelegationGrant.bind(null, container),
    })).scoped()).resolve(container)),
    // Identity overlay (Wave 4, Phase 4): auth.md / ID-JAG self-registration. An
    // external agent presents an issuer-signed identity assertion (RFC 7523
    // JWT-bearer); the service validates issuer + audience + signature against the
    // server-side trusted-issuer registry, idempotently onboards a scoped
    // AgentPrincipal (credentialMode='authmd') + AgentDelegationGrant (issuer/
    // subject/audience populated), and mints a token via the SAME core the OAuth
    // /token server uses — an additional credential PATH, not a parallel token
    // system. `discovery` is the secret-free /well-known metadata. The bound
    // functions resolve `em` at call time.
    agentAuthMdService: asScopedService((container) => (asFunction(() => ({
      discovery: getAgentAuthDiscovery,
      verifyAssertion: verifyIdJagAssertion,
      register: registerAgentViaIdJag.bind(null, container),
    })).scoped()).resolve(container)),
    // CLASSIC injection mode resolves deps by parameter name — destructure the
    // real dependency names (not a `cradle` param) and use .proxy() so the
    // cradle is passed and deps resolve lazily (matches sales/di.ts).
    agentRuntime: asScopedService((container) => (asFunction(({ commandBus }: { commandBus: CommandBus }) =>
      new AgentRuntimeService({
        container,
        commandBus,
      }),
    ).proxy().scoped()).resolve(container)),
    dispositionService: asScopedService((container) => (asFunction(() => new DispositionServiceImpl(container)).scoped()).resolve(container)),
    // Phase 1 runtime guardrails: deterministic output schema + tool-scope
    // backstop checks. Pure/stateless aside from the container it persists through.
    guardrailService: asScopedService((container) => (asFunction(() => new GuardrailService(container)).scoped()).resolve(container)),
    // Cross-process correlation store for OpenCode file-agent runs. Built from
    // each process's own container (app + the separate mcp:serve-http process),
    // both backed by the same DB — the in-process Map seam does not work because
    // the runner and the submit_outcome MCP tool run in different processes.
    agentRunSessionStore: asScopedService((container) => (asFunction(() => new DbAgentRunSessionStore(container)).scoped()).resolve(container)),
    // File plane (#12): per-run sandbox lifecycle + serialized container lease.
    // SINGLETON so the concurrency semaphore (OM_OPENCODE_POOL_SIZE, default 1) is
    // process-wide — every tool-enabled OpenCode run shares the one shared container.
    agentWorkspaceManager: asFunction(() => new AgentWorkspaceManager()).singleton(),
    // Context overlay (Phase 1): hybrid TDCR resolver. Resolves the per-capability
    // ContextModule (code-first registry, fails closed), reads the mandatory floor
    // via the queryEngine (org-scoped query_index), packs under a token budget, and
    // persists one append-only AgentContextBundle per run. Resolves `queryEngine`
    // lazily from the container at call time.
    agentContextResolver: asScopedService((container) => (asFunction(() => new ContextResolverImpl(container)).scoped()).resolve(container)),
    // Context overlay (Phase 3): document ingest / OCR extraction. The OCR/layout
    // engine is swappable behind `agentDocumentOcrProvider` (default = the elevated
    // OpenAI vision-OCR path, wrapping the attachments OcrService). The ingest
    // service runs OCR → classify → field-extract and emits typed facts each
    // carrying provenance (source attachment id + page/region locator) + confidence,
    // which the ContextResolver folds into the bundle as citable `document` sources.
    agentDocumentOcrProvider: asScopedService((container) => (asFunction(() => resolveDefaultOcrProvider(container)).scoped()).resolve(container)),
    // Web egress overlay. Adapters come from the generated registry the app
    // provides as `webResearchAdapterEntries`; policy (which are enabled, their
    // order, deadlines, thresholds) is per tenant and therefore resolved inside
    // the tool handler, where the tenant is known. Egress runs in THIS process
    // (allowed net), never the sandbox. A deployment can re-register
    // `webSearchEngineFactory` to wrap or replace the chain.
    webSearchEngineFactory: asFunction(() => buildWebSearchEngine).scoped(),
    agentDocumentIngestService: asScopedService((container) => (asFunction(
      () => new DocumentIngestServiceImpl(container, { provider: resolveDefaultOcrProvider(container) }),
    ).scoped()).resolve(container)),
    agentWorkflowBridge: asScopedService((container) => (asFunction(
      ({ agentRuntime, dispositionService }: { agentRuntime: AgentRuntimeService; dispositionService: DispositionService }) =>
        new AgentWorkflowBridgeService({
          container,
          agentRuntime,
          dispositionService,
        }),
    ).proxy().scoped()).resolve(container)),
  })
}

const WORKSPACE_MANAGER_KEY = Symbol.for('@open-mercato/agent-orchestrator/workspace-manager')
type WorkspaceManagerGlobals = typeof globalThis & {
  [WORKSPACE_MANAGER_KEY]?: AgentWorkspaceManager
}

export const register = defineProcessDiRegistrar((container: AppContainer) => {
  registerLegacy(container)
  container.register({
    agentWorkspaceManager: asFunction(() => {
      const globals = globalThis as WorkspaceManagerGlobals
      return globals[WORKSPACE_MANAGER_KEY] ??= new AgentWorkspaceManager()
    }).singleton(),
  })
}, { legacy: registerLegacy })
