import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type {
  PrivacyDataClassHandler,
  PrivacyEnvironmentSanitizationInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import {
  AgentContextBundle,
  AgentCorrection,
  AgentEvalCase,
  AgentEvalCaseRun,
  AgentEvalResult,
  AgentEvalSuiteRun,
  AgentGuardrailCheck,
  AgentMetricRollup,
  AgentProcess,
  AgentProcessRun,
  AgentProposal,
  AgentRun,
  AgentRunArtifact,
  AgentRunSession,
  AgentSpan,
  AgentToolCall,
} from './data/entities'
import { deleteArtifactBytes } from './lib/runtime/artifactFileStore'
import { deleteArtifact } from './lib/trace/artifactStore'

export const AGENT_ORCHESTRATOR_CONTENT_DATA_CLASS_ID = 'agent_orchestrator.content'

registerPrivacyDataClass({
  id: AGENT_ORCHESTRATOR_CONTENT_DATA_CLASS_ID,
  module: 'agent_orchestrator',
  title: 'Agent orchestration content',
  description: 'Agent inputs, outputs, traces, proposals, runtime artifacts, and derived process records.',
  handlerService: 'agentOrchestratorEnvironmentPrivacyHandler',
  subjectKinds: [],
  subjectActions: [],
  environmentSanitization: { categories: ['ai_content', 'personal_data', 'credentials'] },
})

export class AgentOrchestratorEnvironmentPrivacyHandler implements PrivacyDataClassHandler {
  constructor(
    private readonly em: EntityManager,
    private readonly container: AwilixContainer,
  ) {}

  async sanitizeEnvironment(input: PrivacyEnvironmentSanitizationInput) {
    const matched = await this.countContent(input)
    if (input.dryRun || matched === 0) return { matched, affected: 0 }
    const scope = this.scope(input)
    const [runs, toolCalls, contextBundles, runArtifacts] = await Promise.all([
      this.em.find(AgentRun, scope),
      this.em.find(AgentToolCall, scope),
      this.em.find(AgentContextBundle, scope),
      this.em.find(AgentRunArtifact, scope),
    ])
    for (const run of runs) {
      if (run.outputArtifactKey) await deleteArtifact(this.container, input.scope, run.outputArtifactKey)
    }
    for (const toolCall of toolCalls) {
      if (toolCall.requestArtifactKey) await deleteArtifact(this.container, input.scope, toolCall.requestArtifactKey)
      if (toolCall.responseArtifactKey) await deleteArtifact(this.container, input.scope, toolCall.responseArtifactKey)
    }
    for (const bundle of contextBundles) {
      if (bundle.payloadRef) await deleteArtifact(this.container, input.scope, bundle.payloadRef)
    }
    for (const artifact of runArtifacts) {
      await deleteArtifactBytes(this.container, input.scope, artifact.storageKey)
    }

    await this.em.nativeDelete(AgentRunArtifact, scope)
    await this.em.nativeDelete(AgentToolCall, scope)
    await this.em.nativeDelete(AgentSpan, scope)
    await this.em.nativeDelete(AgentGuardrailCheck, scope)
    await this.em.nativeDelete(AgentCorrection, scope)
    await this.em.nativeDelete(AgentEvalResult, scope)
    await this.em.nativeDelete(AgentEvalCaseRun, scope)
    await this.em.nativeDelete(AgentEvalSuiteRun, scope)
    await this.em.nativeDelete(AgentProposal, scope)
    await this.em.nativeDelete(AgentContextBundle, scope)
    await this.em.nativeDelete(AgentRunSession, scope)
    await this.em.nativeDelete(AgentProcessRun, scope)
    await this.em.nativeDelete(AgentProcess, scope)
    await this.em.nativeDelete(AgentEvalCase, scope)
    await this.em.nativeDelete(AgentMetricRollup, scope)
    await this.em.nativeDelete(AgentRun, scope)
    return { matched, affected: matched }
  }

  async verifyEnvironmentSanitization(input: PrivacyEnvironmentSanitizationInput) {
    const content = await this.countContent(input)
    const findings = content > 0
      ? [{ code: 'agent_orchestrator.content_present', count: content }]
      : []
    return { passed: findings.length === 0, findings }
  }

  private async countContent(input: PrivacyEnvironmentSanitizationInput): Promise<number> {
    const scope = this.scope(input)
    const counts = await Promise.all([
      this.em.count(AgentRunArtifact, scope),
      this.em.count(AgentToolCall, scope),
      this.em.count(AgentSpan, scope),
      this.em.count(AgentGuardrailCheck, scope),
      this.em.count(AgentCorrection, scope),
      this.em.count(AgentEvalResult, scope),
      this.em.count(AgentEvalCaseRun, scope),
      this.em.count(AgentEvalSuiteRun, scope),
      this.em.count(AgentProposal, scope),
      this.em.count(AgentContextBundle, scope),
      this.em.count(AgentRunSession, scope),
      this.em.count(AgentProcessRun, scope),
      this.em.count(AgentProcess, scope),
      this.em.count(AgentEvalCase, scope),
      this.em.count(AgentMetricRollup, scope),
      this.em.count(AgentRun, scope),
    ])
    return counts.reduce((total, count) => total + count, 0)
  }

  private scope(input: PrivacyEnvironmentSanitizationInput) {
    return {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    }
  }
}
