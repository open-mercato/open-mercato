import { asValue, asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { AgentRun, AgentProposal } from './data/entities'
import { AgentRuntimeService } from './lib/runtime/agentRuntime'
import { DispositionServiceImpl } from './lib/disposition/dispositionService'
import { AgentWorkflowBridgeService } from './lib/runtime/invokeAgentForWorkflow'
import type { DispositionService } from './lib/disposition/dispositionService'

export function register(container: AppContainer) {
  container.register({
    AgentRun: asValue(AgentRun),
    AgentProposal: asValue(AgentProposal),
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
