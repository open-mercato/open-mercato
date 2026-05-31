import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DataQualityFinding } from '../data/entities'
import type { DataQualityFindingStatus } from '../data/entities'
import { emitDataQualityEvent } from '../events'

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const actorUserId = ctx.auth?.userId ?? ctx.auth?.sub ?? null

  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, 'Organization context is required')
  }

  return { tenantId, organizationId, actorUserId }
}

const resolveFindingCommand: CommandHandler<{ id: string }, { id: string; status: string }> = {
  id: 'data_quality.finding.resolve',
  async execute(rawInput, ctx) {
    const { tenantId, organizationId, actorUserId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const finding = await em.findOne(DataQualityFinding, {
      id: rawInput.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (!finding) {
      throw new CrudHttpError(404, 'Finding not found')
    }

    if (finding.status !== 'open') {
      throw new CrudHttpError(400, 'Only open findings can be resolved')
    }

    finding.status = 'resolved' as DataQualityFindingStatus
    finding.resolvedAt = new Date()
    finding.resolvedBy = actorUserId
    await em.flush()

    await emitDataQualityEvent('data_quality.finding.resolved', {
      id: finding.id,
      checkId: finding.checkId,
      targetRecordId: finding.targetRecordId,
      tenantId,
      organizationId,
    })

    return { id: finding.id, status: finding.status }
  },
}

const ignoreFindingCommand: CommandHandler<{ id: string }, { id: string; status: string }> = {
  id: 'data_quality.finding.ignore',
  async execute(rawInput, ctx) {
    const { tenantId, organizationId, actorUserId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const finding = await em.findOne(DataQualityFinding, {
      id: rawInput.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (!finding) {
      throw new CrudHttpError(404, 'Finding not found')
    }

    if (finding.status === 'ignored') {
      throw new CrudHttpError(400, 'Finding is already ignored')
    }

    finding.status = 'ignored' as DataQualityFindingStatus
    finding.ignoredAt = new Date()
    finding.ignoredBy = actorUserId
    await em.flush()

    await emitDataQualityEvent('data_quality.finding.ignored', {
      id: finding.id,
      checkId: finding.checkId,
      targetRecordId: finding.targetRecordId,
      tenantId,
      organizationId,
    })

    return { id: finding.id, status: finding.status }
  },
}

registerCommand(resolveFindingCommand)
registerCommand(ignoreFindingCommand)
