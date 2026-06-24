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
} from './data/entities'
import { AgentRuntimeService } from './lib/runtime/agentRuntime'
import { DbAgentRunSessionStore } from './lib/runtime/agentRunSessionStore'
import { DispositionServiceImpl } from './lib/disposition/dispositionService'
import { AgentWorkflowBridgeService } from './lib/runtime/invokeAgentForWorkflow'
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
    // Cross-process correlation store for OpenCode file-agent runs. Built from
    // each process's own container (app + the separate mcp:serve-http process),
    // both backed by the same DB — the in-process Map seam does not work because
    // the runner and the submit_outcome MCP tool run in different processes.
    agentRunSessionStore: asFunction(() => new DbAgentRunSessionStore(container)).scoped(),
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
