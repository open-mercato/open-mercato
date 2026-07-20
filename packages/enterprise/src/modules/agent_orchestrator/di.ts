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
  AgentEvalResult,
  AgentMetricRollup,
  AgentGuardrailCheck,
  AgentGuardrailSet,
  AgentContextBundle,
  AgentPrincipal,
  AgentDelegationGrant,
  AgentTaskDefinition,
  AgentTaskRun,
  AgentTaskEventTrigger,
  AgentProcess,
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
import { resolveWebSearchProvider } from './lib/webSearch/webSearchProvider'
import type { DispositionService } from './lib/disposition/dispositionService'

export function register(container: AppContainer) {
  container.register({
    AgentRun: asValue(AgentRun),
    AgentProposal: asValue(AgentProposal),
    AgentSpan: asValue(AgentSpan),
    AgentToolCall: asValue(AgentToolCall),
    AgentCorrection: asValue(AgentCorrection),
    AgentEvalCase: asValue(AgentEvalCase),
    AgentEvalAssertion: asValue(AgentEvalAssertion),
    AgentEvalResult: asValue(AgentEvalResult),
    AgentMetricRollup: asValue(AgentMetricRollup),
    AgentGuardrailCheck: asValue(AgentGuardrailCheck),
    AgentGuardrailSet: asValue(AgentGuardrailSet),
    AgentContextBundle: asValue(AgentContextBundle),
    AgentPrincipal: asValue(AgentPrincipal),
    AgentDelegationGrant: asValue(AgentDelegationGrant),
    AgentTaskDefinition: asValue(AgentTaskDefinition),
    AgentTaskRun: asValue(AgentTaskRun),
    AgentTaskEventTrigger: asValue(AgentTaskEventTrigger),
    AgentProcess: asValue(AgentProcess),
    // Identity overlay (Wave 4, Phase 1): provisions a non-interactive agent
    // `User` (kind='agent') + a scoped `Role` so every internal-agent write is
    // attributed to a concrete actor id. Idempotent + org-scoped. The bound
    // functions resolve `em` from the container at call time.
    agentPrincipalService: asFunction(() => ({
      provision: provisionAgentPrincipal.bind(null, container),
      resolve: resolveAgentPrincipal.bind(null, container),
    })).scoped(),
    // Identity overlay (Wave 4, Phase 3): external-agent OAuth client-credentials
    // token server + delegation grants. The `/token` server mints a scoped,
    // short-lived, revocable JWT (signAudienceJwt('agent', …)) bound to the
    // principal + an active AgentDelegationGrant; verification re-checks the grant
    // per request so revocation is immediate. Built on api_keys (bcrypt secret) +
    // jwt.ts — no hand-rolled crypto. The bound functions resolve `em` at call time.
    agentTokenService: asFunction(() => ({
      issue: issueAgentToken.bind(null, container),
      verify: verifyAgentToken.bind(null, container),
      provisionClientSecret: provisionAgentClientSecret.bind(null, container),
    })).scoped(),
    agentDelegationGrantService: asFunction(() => ({
      create: createAgentDelegationGrant.bind(null, container),
      resolve: resolveAgentDelegationGrant.bind(null, container),
    })).scoped(),
    // Identity overlay (Wave 4, Phase 4): auth.md / ID-JAG self-registration. An
    // external agent presents an issuer-signed identity assertion (RFC 7523
    // JWT-bearer); the service validates issuer + audience + signature against the
    // server-side trusted-issuer registry, idempotently onboards a scoped
    // AgentPrincipal (credentialMode='authmd') + AgentDelegationGrant (issuer/
    // subject/audience populated), and mints a token via the SAME core the OAuth
    // /token server uses — an additional credential PATH, not a parallel token
    // system. `discovery` is the secret-free /well-known metadata. The bound
    // functions resolve `em` at call time.
    agentAuthMdService: asFunction(() => ({
      discovery: getAgentAuthDiscovery,
      verifyAssertion: verifyIdJagAssertion,
      register: registerAgentViaIdJag.bind(null, container),
    })).scoped(),
    // CLASSIC injection mode resolves deps by parameter name — destructure the
    // real dependency names (not a `cradle` param) and use .proxy() so the
    // cradle is passed and deps resolve lazily (matches sales/di.ts).
    agentRuntime: asFunction(({ commandBus }: { commandBus: CommandBus }) =>
      new AgentRuntimeService({
        container,
        commandBus,
      }),
    ).proxy().scoped(),
    dispositionService: asFunction(() => new DispositionServiceImpl(container)).scoped(),
    // Phase 1 runtime guardrails: deterministic output schema + tool-scope
    // backstop checks. Pure/stateless aside from the container it persists through.
    guardrailService: asFunction(() => new GuardrailService(container)).scoped(),
    // Cross-process correlation store for OpenCode file-agent runs. Built from
    // each process's own container (app + the separate mcp:serve-http process),
    // both backed by the same DB — the in-process Map seam does not work because
    // the runner and the submit_outcome MCP tool run in different processes.
    agentRunSessionStore: asFunction(() => new DbAgentRunSessionStore(container)).scoped(),
    // File plane (#12): per-run sandbox lifecycle + serialized container lease.
    // SINGLETON so the concurrency semaphore (OM_OPENCODE_POOL_SIZE, default 1) is
    // process-wide — every tool-enabled OpenCode run shares the one shared container.
    agentWorkspaceManager: asFunction(() => new AgentWorkspaceManager()).singleton(),
    // Context overlay (Phase 1): hybrid TDCR resolver. Resolves the per-capability
    // ContextModule (code-first registry, fails closed), reads the mandatory floor
    // via the queryEngine (org-scoped query_index), packs under a token budget, and
    // persists one append-only AgentContextBundle per run. Resolves `queryEngine`
    // lazily from the container at call time.
    agentContextResolver: asFunction(() => new ContextResolverImpl(container)).scoped(),
    // Context overlay (Phase 3): document ingest / OCR extraction. The OCR/layout
    // engine is swappable behind `agentDocumentOcrProvider` (default = the elevated
    // OpenAI vision-OCR path, wrapping the attachments OcrService). The ingest
    // service runs OCR → classify → field-extract and emits typed facts each
    // carrying provenance (source attachment id + page/region locator) + confidence,
    // which the ContextResolver folds into the bundle as citable `document` sources.
    agentDocumentOcrProvider: asFunction(() => resolveDefaultOcrProvider(container)).scoped(),
    // Web egress overlay (spec 2026-07-11-agent-web-search-tool, Phase 5): the
    // DEFAULT provider is model-native (reuses the agent's own LLM `web_search`);
    // `OM_AGENT_WEB_SEARCH_PROVIDER` switches to a keyed adapter (Tavily) or the
    // operator's own SearXNG. Null when the selection lacks required config → the
    // search tool returns `not_configured`. `web_fetch` is independent of this. The
    // network call runs in THIS server process (allowed net), never the sandbox. A
    // deployment can re-register `webSearchProvider` with its own instance.
    webSearchProvider: asFunction(() => resolveWebSearchProvider(container)).scoped(),
    agentDocumentIngestService: asFunction(
      () => new DocumentIngestServiceImpl(container, { provider: resolveDefaultOcrProvider(container) }),
    ).scoped(),
    agentWorkflowBridge: asFunction(
      ({ agentRuntime, dispositionService }: { agentRuntime: AgentRuntimeService; dispositionService: DispositionService }) =>
        new AgentWorkflowBridgeService({
          container,
          agentRuntime,
          dispositionService,
        }),
    ).proxy().scoped(),
  })
}
