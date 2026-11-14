import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { PrivacyGovernanceService } from './governanceService'
import { PrivacyServiceError } from './errors'

type RestoreErasureEntry = {
  requestId: string
  tenantId: string
  organizationId: string
  subjectKind: string
  subjectId: string
  dataClassIds?: string[]
  executedAt: string
}

type RestoreErasureManifest = {
  listAfter: (timestamp: Date) => Promise<RestoreErasureEntry[]>
}

export type RestoreReapplicationInput = {
  after: Date
  actorId: string
  dryRun: boolean
  maxEntries: number
  offset: number
  commandContext: CommandRuntimeContext
}

export type RestoreReapplicationResult = {
  after: string
  dryRun: boolean
  totalPending: number
  processed: number
  offset: number
  nextOffset: number | null
  completed: number
  partial: number
  blocked: number
  failed: number
  continuationRequired: boolean
  entries: Array<{
    requestId: string
    operationId: string | null
    status: 'completed' | 'partial' | 'blocked' | 'failed'
  }>
}

export class PrivacyRestoreReapplicationService {
  constructor(
    private readonly governanceService: PrivacyGovernanceService,
    private readonly resolveManifest: () => RestoreErasureManifest | null,
  ) {}

  async reapply(input: RestoreReapplicationInput): Promise<RestoreReapplicationResult> {
    if (!Number.isInteger(input.maxEntries) || input.maxEntries < 1 || input.maxEntries > 1_000) {
      throw new PrivacyServiceError('Invalid restore reapplication batch size.', 'INVALID_BATCH_SIZE', 400)
    }
    if (!Number.isInteger(input.offset) || input.offset < 0) {
      throw new PrivacyServiceError('Invalid restore reapplication offset.', 'INVALID_OFFSET', 400)
    }
    const manifest = this.resolveManifest()
    if (!manifest) {
      throw new PrivacyServiceError('Erasure manifest is unavailable.', 'ERASURE_MANIFEST_UNAVAILABLE', 409)
    }
    const pending = await manifest.listAfter(input.after)
    const selected = pending.slice(input.offset, input.offset + input.maxEntries)
    const entries: RestoreReapplicationResult['entries'] = []

    for (const entry of selected) {
      const commandContext = scopeCommandContext(
        input.commandContext,
        entry.tenantId,
        entry.organizationId,
      )
      try {
        const result = await this.governanceService.runSubjectRequest(
          { tenantId: entry.tenantId, organizationId: entry.organizationId },
          input.actorId,
          {
            action: 'erase',
            subject: { kind: entry.subjectKind, id: entry.subjectId },
            ...(entry.dataClassIds?.length ? { dataClassIds: entry.dataClassIds } : {}),
            dryRun: input.dryRun,
          },
          commandContext,
          { skipManifest: true },
        )
        entries.push({
          requestId: entry.requestId,
          operationId: result.operation.id,
          status: normalizeStatus(result.operation.status),
        })
      } catch {
        entries.push({ requestId: entry.requestId, operationId: null, status: 'failed' })
      }
    }

    return {
      after: input.after.toISOString(),
      dryRun: input.dryRun,
      totalPending: pending.length,
      processed: entries.length,
      offset: input.offset,
      nextOffset: input.offset + selected.length < pending.length
        ? input.offset + selected.length
        : null,
      completed: countStatus(entries, 'completed'),
      partial: countStatus(entries, 'partial'),
      blocked: countStatus(entries, 'blocked'),
      failed: countStatus(entries, 'failed'),
      continuationRequired: input.offset + selected.length < pending.length,
      entries,
    }
  }
}

function scopeCommandContext(
  context: CommandRuntimeContext,
  tenantId: string,
  organizationId: string,
): CommandRuntimeContext {
  return {
    ...context,
    auth: null,
    organizationScope: {
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    systemActor: true,
  }
}

function normalizeStatus(
  status: 'running' | 'completed' | 'partial' | 'failed' | 'blocked',
): 'completed' | 'partial' | 'blocked' | 'failed' {
  return status === 'running' ? 'failed' : status
}

function countStatus(
  entries: RestoreReapplicationResult['entries'],
  status: RestoreReapplicationResult['entries'][number]['status'],
): number {
  return entries.filter((entry) => entry.status === status).length
}
