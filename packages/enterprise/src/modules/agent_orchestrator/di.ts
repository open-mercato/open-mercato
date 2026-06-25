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
} from './data/entities'
import { provisionAgentPrincipal, resolveAgentPrincipal } from './lib/identity/agentPrincipalService'
import { AgentRuntimeService } from './lib/runtime/agentRuntime'
import { GuardrailService } from './lib/guardrails/guardrailService'
import { DbAgentRunSessionStore } from './lib/runtime/agentRunSessionStore'
import { DispositionServiceImpl } from './lib/disposition/dispositionService'
import { AgentWorkflowBridgeService } from './lib/runtime/invokeAgentForWorkflow'
import { ContextResolverImpl } from './lib/context/contextResolver'
import { DocumentIngestServiceImpl } from './lib/context/documentIngest'
import { resolveDefaultOcrProvider } from './lib/context/documentOcrProvider'
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
    // Identity overlay (Wave 4, Phase 1): provisions a non-interactive agent
    // `User` (kind='agent') + a scoped `Role` so every internal-agent write is
    // attributed to a concrete actor id. Idempotent + org-scoped. The bound
    // functions resolve `em` from the container at call time.
    agentPrincipalService: asFunction(() => ({
      provision: provisionAgentPrincipal.bind(null, container),
      resolve: resolveAgentPrincipal.bind(null, container),
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
