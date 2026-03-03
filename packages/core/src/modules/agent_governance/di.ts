import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  AgentGovernanceApprovalTask,
  AgentGovernanceDecisionEntityLink,
  AgentGovernanceDecisionEvent,
  AgentGovernanceDecisionWhyLink,
  AgentGovernancePlaybook,
  AgentGovernancePolicy,
  AgentGovernancePrecedentIndex,
  AgentGovernanceRiskBand,
  AgentGovernanceRun,
  AgentGovernanceRunStep,
  AgentGovernanceSkill,
  AgentGovernanceSkillVersion,
} from './data/entities'
import { createTelemetryService } from './services/telemetry-service'
import { createRunOrchestratorService } from './services/run-orchestrator-service'
import { createHarnessAdapterService } from './services/harness-adapter-service'
import { createToolGrantService } from './services/tool-grant-service'
import { createDecisionProjectorService } from './services/decision-projector-service'
import { createRetrievalPlannerService } from './services/retrieval-planner-service'
import { createRetrievalAdapterService } from './services/retrieval-adapter-service'
import { createRetrievalBenchmarkService } from './services/retrieval-benchmark-service'
import { createSkillLifecycleService } from './services/skill-lifecycle-service'
import { createObservabilityService } from './services/observability-service'

export function register(container: AppContainer) {
  container.register({
    AgentGovernancePolicy: asValue(AgentGovernancePolicy),
    AgentGovernanceRiskBand: asValue(AgentGovernanceRiskBand),
    AgentGovernancePlaybook: asValue(AgentGovernancePlaybook),
    AgentGovernanceRun: asValue(AgentGovernanceRun),
    AgentGovernanceRunStep: asValue(AgentGovernanceRunStep),
    AgentGovernanceDecisionEvent: asValue(AgentGovernanceDecisionEvent),
    AgentGovernanceApprovalTask: asValue(AgentGovernanceApprovalTask),
    AgentGovernanceDecisionEntityLink: asValue(AgentGovernanceDecisionEntityLink),
    AgentGovernanceDecisionWhyLink: asValue(AgentGovernanceDecisionWhyLink),
    AgentGovernancePrecedentIndex: asValue(AgentGovernancePrecedentIndex),
    AgentGovernanceSkill: asValue(AgentGovernanceSkill),
    AgentGovernanceSkillVersion: asValue(AgentGovernanceSkillVersion),

    agentGovernanceHarnessAdapterService: asFunction(() => createHarnessAdapterService()).scoped(),
    agentGovernanceTelemetryService: asFunction(({ em }) => createTelemetryService({ em })).scoped(),
    agentGovernanceToolGrantService: asFunction(({ em }) => createToolGrantService({ em })).scoped(),
    agentGovernanceDecisionProjectorService: asFunction(({ em }) => createDecisionProjectorService({ em })).scoped(),
    agentGovernanceRetrievalAdapterService: asFunction(() => createRetrievalAdapterService()).scoped(),
    agentGovernanceRetrievalPlannerService: asFunction(({ em, agentGovernanceRetrievalAdapterService }) =>
      createRetrievalPlannerService({
        em,
        retrievalAdapterService: agentGovernanceRetrievalAdapterService,
      })
    ).scoped(),
    agentGovernanceRetrievalBenchmarkService: asFunction(({ agentGovernanceRetrievalPlannerService, agentGovernanceRetrievalAdapterService }) =>
      createRetrievalBenchmarkService({
        retrievalPlannerService: agentGovernanceRetrievalPlannerService,
        retrievalAdapterService: agentGovernanceRetrievalAdapterService,
      })
    ).scoped(),
    agentGovernanceSkillLifecycleService: asFunction(({ em }) => createSkillLifecycleService({ em })).scoped(),
    agentGovernanceObservabilityService: asFunction(({ em }) => createObservabilityService({ em })).scoped(),
    agentGovernanceRunOrchestratorService: asFunction(({ em, agentGovernanceTelemetryService, agentGovernanceHarnessAdapterService, agentGovernanceSkillLifecycleService }) =>
      createRunOrchestratorService({
        em,
        telemetryService: agentGovernanceTelemetryService,
        harnessAdapterService: agentGovernanceHarnessAdapterService,
        skillLifecycleService: agentGovernanceSkillLifecycleService,
      })
    ).scoped(),
  })
}
