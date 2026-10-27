/**
 * Workflows Module — Run Outcome Evidence (the data-access half).
 *
 * Counts what the run RECORDED about itself so `resolveRunOutcome`
 * (`lib/run-outcome.ts`, pure) can reach a verdict. Nothing here decides
 * anything: the vocabulary and the precedence both live in the pure module, and
 * this file only turns rows into the counts that module asks for.
 *
 * Every query carries `tenantId` AND `organizationId` on top of the instance id.
 * The instance id alone would already be unique, but a scoped query cannot be
 * turned into a cross-tenant read by a later refactor that widens it.
 */

import type { EntityManager } from '@mikro-orm/core'
import { StepInstance, WorkflowEvent, type WorkflowInstance } from '../data/entities'
import {
  EMPTY_RUN_OUTCOME_EVIDENCE,
  RUN_OUTCOME_FAILED_STEP_STATUS,
  RUN_OUTCOME_FAILURE_EVENT_TYPES,
  RUN_OUTCOME_SKIPPED_STEP_STATUS,
  RUN_OUTCOME_WARNING_EVENT_TYPES,
  type RunOutcomeEvidence,
} from './run-outcome'

/**
 * Count the run's recorded failure and warning evidence.
 *
 * Short-circuits for every terminal status except `COMPLETED`: `cancelled`,
 * `compensated` and `failure` are decided by the lifecycle alone, so querying
 * for evidence that cannot change the verdict would add four round trips to
 * every failing run's termination path.
 */
export async function collectRunOutcomeEvidence(
  em: EntityManager,
  instance: Pick<WorkflowInstance, 'id' | 'tenantId' | 'organizationId'>,
  terminalStatus: string,
): Promise<RunOutcomeEvidence> {
  if (terminalStatus !== 'COMPLETED') {
    return { terminalStatus, ...EMPTY_RUN_OUTCOME_EVIDENCE }
  }

  const scope = {
    workflowInstanceId: instance.id,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
  }

  const [failedSteps, failureEvents, skippedSteps, warningEvents] = await Promise.all([
    em.count(StepInstance, { ...scope, status: RUN_OUTCOME_FAILED_STEP_STATUS }),
    em.count(WorkflowEvent, { ...scope, eventType: { $in: [...RUN_OUTCOME_FAILURE_EVENT_TYPES] } }),
    em.count(StepInstance, { ...scope, status: RUN_OUTCOME_SKIPPED_STEP_STATUS }),
    em.count(WorkflowEvent, { ...scope, eventType: { $in: [...RUN_OUTCOME_WARNING_EVENT_TYPES] } }),
  ])

  return {
    terminalStatus,
    failureEvidenceCount: failedSteps + failureEvents,
    warningEvidenceCount: skippedSteps + warningEvents,
  }
}
