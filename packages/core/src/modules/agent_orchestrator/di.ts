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
    agentRuntime: asFunction((cradle: { commandBus: CommandBus }) =>
      new AgentRuntimeService({
        container,
        commandBus: cradle.commandBus,
      }),
    ).scoped(),
    dispositionService: asFunction(() => new DispositionServiceImpl(container)).scoped(),
    agentWorkflowBridge: asFunction(
      (cradle: { agentRuntime: AgentRuntimeService; dispositionService: DispositionService }) =>
        new AgentWorkflowBridgeService({
          container,
          agentRuntime: cradle.agentRuntime,
          dispositionService: cradle.dispositionService,
        }),
    ).scoped(),
  })
}
