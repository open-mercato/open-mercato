import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  DataQualityCheck,
  DataQualityScanRun,
  type DataQualityScanStatus,
  DataQualitySuite,
  DataQualitySuiteCheck,
} from '../data/entities'
import { emitDataQualityEvent } from '../events'
import { getDataQualityQueue } from '../lib/queue'
import { startScanSchema, type StartScanInput } from '../data/validators'
import {
  DATA_QUALITY_SCAN_QUEUE,
  type DataQualityScanJobPayload,
} from '../workers/data-quality-scan'

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const actorUserId = ctx.auth?.userId ?? ctx.auth?.sub ?? null

  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, 'Organization context is required')
  }

  return { tenantId, organizationId, actorUserId }
}

async function loadChecksForScan(
  em: EntityManager,
  input: StartScanInput,
  tenantId: string,
  organizationId: string,
) {
  const requestedCheckIds = Array.from(new Set(input.checkIds ?? []))
  if (requestedCheckIds.length > 0) {
    const checks = await em.find(DataQualityCheck, {
      id: { $in: requestedCheckIds },
      tenantId,
      organizationId,
      deletedAt: null,
      enabled: true,
    } as never)

    if (checks.length !== requestedCheckIds.length) {
      throw new CrudHttpError(400, 'One or more enabled checks could not be found')
    }

    return checks
  }

  if (!input.suiteId) {
    return []
  }

  const suite = await em.findOne(DataQualitySuite, {
    id: input.suiteId,
    tenantId,
    organizationId,
    deletedAt: null,
  } as never)
  if (!suite) {
    throw new CrudHttpError(404, 'Suite not found')
  }

  const suiteChecks = await em.find(DataQualitySuiteCheck, {
    suiteId: input.suiteId,
    tenantId,
    organizationId,
    deletedAt: null,
    enabled: true,
  } as never, { orderBy: { sequence: 'ASC' } })
  const suiteCheckIds = Array.from(new Set(suiteChecks.map((suiteCheck) => suiteCheck.checkId)))
  if (suiteCheckIds.length === 0) {
    return []
  }

  return em.find(DataQualityCheck, {
    id: { $in: suiteCheckIds },
    tenantId,
    organizationId,
    deletedAt: null,
    enabled: true,
  } as never)
}

const startScanCommand: CommandHandler<StartScanInput, { scanRunId: string; progressJobId: string }> = {
  id: 'data_quality.scan.start',
  async execute(rawInput, ctx) {
    const parsed = startScanSchema.parse(rawInput)
    const { tenantId, organizationId, actorUserId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const progressService = ctx.container.resolve('progressService') as ProgressService

    const checks = await loadChecksForScan(em, parsed, tenantId, organizationId)
    if (checks.length === 0) {
      throw new CrudHttpError(400, 'No enabled checks are available for this scan')
    }

    const targetEntityTypes = new Set(checks.map((check) => check.targetEntityType))
    if (targetEntityTypes.size > 1) {
      throw new CrudHttpError(400, 'All checks in a scan must target the same entity type')
    }

    const derivedTargetEntityType = checks[0]?.targetEntityType ?? null
    if (parsed.targetEntityType && derivedTargetEntityType && parsed.targetEntityType !== derivedTargetEntityType) {
      throw new CrudHttpError(400, 'Target entity type does not match the selected checks')
    }

    const targetEntityType = parsed.targetEntityType ?? derivedTargetEntityType
    const progressJob = await progressService.createJob(
      {
        jobType: 'data_quality.scan',
        name: 'Data Quality Scan',
        description: parsed.suiteId ? 'Suite scan' : 'Ad-hoc check scan',
        cancellable: true,
      },
      {
        tenantId,
        organizationId,
        userId: actorUserId,
      },
    )

    const scanRun = em.create(DataQualityScanRun, {
      suiteId: parsed.suiteId ?? null,
      targetEntityType,
      status: 'pending' as DataQualityScanStatus,
      progressJobId: progressJob.id,
      criteriaJson: {
        suiteId: parsed.suiteId ?? null,
        checkIds: parsed.checkIds ?? null,
        ids: parsed.filters?.ids ?? null,
      },
      requestedBy: actorUserId,
      tenantId,
      organizationId,
    })

    em.persist(scanRun)
    await em.flush()

    const queue = getDataQualityQueue<DataQualityScanJobPayload>(DATA_QUALITY_SCAN_QUEUE)
    await queue.enqueue({
      scanRunId: scanRun.id,
      tenantId,
      organizationId,
      userId: actorUserId,
      progressJobId: progressJob.id,
    })

    await emitDataQualityEvent('data_quality.scan.started', {
      id: scanRun.id,
      tenantId,
      organizationId,
    })

    return { scanRunId: scanRun.id, progressJobId: progressJob.id }
  },
}

const cancelScanCommand: CommandHandler<{ id: string }, { id: string; status: string }> = {
  id: 'data_quality.scan.cancel',
  async execute(rawInput, ctx) {
    const { tenantId, organizationId, actorUserId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const progressService = ctx.container.resolve('progressService') as ProgressService

    const scanRun = await em.findOne(DataQualityScanRun, {
      id: rawInput.id,
      tenantId,
      organizationId,
    } as never)
    if (!scanRun) {
      throw new CrudHttpError(404, 'Scan not found')
    }

    if (scanRun.status === 'completed' || scanRun.status === 'failed' || scanRun.status === 'cancelled') {
      throw new CrudHttpError(400, 'Cannot cancel a scan that is already finished')
    }

    if (scanRun.progressJobId) {
      await progressService.cancelJob(scanRun.progressJobId, {
        tenantId,
        organizationId,
        userId: actorUserId,
      })
    }

    if (scanRun.status === 'pending') {
      scanRun.status = 'cancelled' as DataQualityScanStatus
      scanRun.finishedAt = new Date()
      await em.flush()
    }

    await emitDataQualityEvent('data_quality.scan.cancelled', {
      id: scanRun.id,
      tenantId,
      organizationId,
    })

    return { id: scanRun.id, status: scanRun.status }
  },
}

registerCommand(startScanCommand)
registerCommand(cancelScanCommand)
