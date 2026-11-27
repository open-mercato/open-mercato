import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import type { RawOutputPointer } from '../guardrails/integrity/pipeline'
import { syncIntegritySets } from '../guardrails/integrity/integritySets'
import { ARTIFACT_REFS, putArtifact } from '../trace/artifactStore'
import { withRuntimeAuditWrite } from '../identity/agentWriteScope'
import type { AgentRunCtx } from './persistence'

const logger = createLogger('agent_orchestrator').child({ component: 'integrity-run-support' })

/**
 * Offloads the pre-repair model output as an encrypted artifact (spec
 * `2026-10-21-output-integrity-guardrails` → Raw model output). Fail-open: an
 * unavailable store or a failed upload never fails the run.
 */
export async function storeRunRawOutput(
  container: AwilixContainer,
  ctx: AgentRunCtx,
  runId: string,
  rawOutput: unknown,
): Promise<RawOutputPointer> {
  try {
    const key = await putArtifact(
      container,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      ARTIFACT_REFS.runRawOutput,
      rawOutput,
    )
    return key ? { key, status: 'stored' } : { status: 'storage_unavailable' }
  } catch (error) {
    logger.warn('raw model output offload failed', {
      runId,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.raw_output_store_failed',
      attributes: { runId },
    })
    return { status: 'storage_unavailable' }
  }
}

/**
 * Makes sure the integrity set the check rows pin exists in
 * `agent_guardrail_sets` for this organization (tenants created before the set
 * changed are synced on first use). Runs in the runtime-audit write scope so a
 * principal-bound run may append the set row. Fail-open: a sync failure never
 * fails the run.
 */
export async function ensureRunIntegritySetSynced(
  container: AwilixContainer,
  ctx: AgentRunCtx,
  entry: AgentRegistryEntry,
): Promise<void> {
  try {
    const em = (container.resolve('em') as EntityManager).fork()
    await withRuntimeAuditWrite(() =>
      syncIntegritySets(em, { tenantId: ctx.tenantId, organizationId: ctx.organizationId }, [entry]),
    )
  } catch (error) {
    logger.warn('integrity set sync failed', {
      agentId: entry.id,
      error: error instanceof Error ? error.message : String(error),
    })
    getTelemetryRuntime()?.reportError(error, {
      module: 'agent_orchestrator',
      code: 'agent_orchestrator.integrity_set_sync_failed',
      attributes: { agentId: entry.id },
    })
  }
}
