import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import { emitAgentGovernanceEvent } from '../events'
import type { DecisionTelemetryEnvelopeInput } from '../data/validators'
import type { TelemetryService } from '../services/telemetry-service'
import type { HarnessAdapterService } from '../services/harness-adapter-service'

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function ensureRecordScope(
  ctx: CommandRuntimeContext,
  tenantId: string,
  organizationId: string,
): void {
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
}

export function scopeFromContext(ctx: CommandRuntimeContext): { tenantId: string | null; organizationId: string | null } {
  return {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
  }
}

export async function recordCommandDecision(
  ctx: CommandRuntimeContext,
  input: DecisionTelemetryEnvelopeInput,
  options?: {
    durability?: 'fail_closed' | 'fail_soft'
    repairCode?: string
    repairMarker?: Record<string, unknown> | null
  },
): Promise<{ eventId: string | null; telemetryRepairRequired: boolean }> {
  const telemetryService = ctx.container.resolve('agentGovernanceTelemetryService') as TelemetryService
  const telemetryResult = await telemetryService.recordDecisionWithDurability(input, options)

  if (telemetryResult.eventId) {
    await emitAgentGovernanceEvent('agent_governance.decision.recorded', {
      eventId: telemetryResult.eventId,
      runId: input.runId ?? null,
      actionType: input.actionType,
      targetEntity: input.targetEntity,
      targetId: input.targetId ?? null,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
  }

  if (telemetryResult.repairRequired) {
    await emitAgentGovernanceEvent('agent_governance.telemetry.repair_flagged', {
      runId: input.runId ?? null,
      targetEntity: input.targetEntity,
      targetId: input.targetId ?? null,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
  }

  return {
    eventId: telemetryResult.eventId,
    telemetryRepairRequired: telemetryResult.repairRequired,
  }
}

export function resolveHarnessProvider(ctx: CommandRuntimeContext): string {
  try {
    const harnessAdapterService = ctx.container.resolve('agentGovernanceHarnessAdapterService') as HarnessAdapterService
    return harnessAdapterService.getActiveProviderId()
  } catch {
    return 'open_mercato'
  }
}
