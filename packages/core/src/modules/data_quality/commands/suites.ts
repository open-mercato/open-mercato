import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  DataQualityCheck,
  DataQualitySuite,
  DataQualitySuiteCheck,
} from '../data/entities'
import {
  assignSuiteChecksSchema,
  type AssignSuiteChecksInput,
  createSuiteSchema,
  type CreateSuiteInput,
  updateSuiteSchema,
  type UpdateSuiteInput,
} from '../data/validators'

const suiteCrudEvents: CrudEventsConfig = {
  module: 'data_quality',
  entity: 'suite',
  persistent: true,
  buildPayload: ({ entity, identifiers }) => ({
    id: identifiers.id,
    code: (entity as DataQualitySuite).code,
    tenantId: identifiers.tenantId,
    organizationId: identifiers.organizationId,
  }),
}

const suiteCrudIndexer: CrudIndexerConfig = {
  entityType: 'data_quality:suites',
}

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const actorUserId = ctx.auth?.userId ?? ctx.auth?.sub ?? null

  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, 'Organization context is required')
  }

  return { tenantId, organizationId, actorUserId }
}

async function emitSuiteCrudSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  suite: DataQualitySuite,
  tenantId: string,
  organizationId: string,
) {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: suite,
    identifiers: {
      id: suite.id,
      tenantId,
      organizationId,
    },
    syncOrigin: ctx.syncOrigin,
    events: suiteCrudEvents,
    indexer: suiteCrudIndexer,
  })
}

const createSuiteCommand: CommandHandler<CreateSuiteInput, { id: string }> = {
  id: 'data_quality.suite.create',
  async execute(rawInput, ctx) {
    const parsed = createSuiteSchema.parse(rawInput)
    const { tenantId, organizationId, actorUserId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const existing = await em.findOne(DataQualitySuite, {
      tenantId,
      organizationId,
      code: parsed.code,
    } as never)
    if (existing) {
      throw new CrudHttpError(409, 'A suite with this code already exists')
    }

    const suite = em.create(DataQualitySuite, {
      code: parsed.code,
      name: parsed.name,
      description: parsed.description ?? null,
      enabled: parsed.enabled ?? true,
      createdBy: actorUserId,
      tenantId,
      organizationId,
    })

    em.persist(suite)
    await em.flush()
    await emitSuiteCrudSideEffects(ctx, 'created', suite, tenantId, organizationId)

    return { id: suite.id }
  },
}

const updateSuiteCommand: CommandHandler<UpdateSuiteInput & { id: string }, { id: string }> = {
  id: 'data_quality.suite.update',
  async execute(rawInput, ctx) {
    const { id, ...updateData } = rawInput
    const parsed = updateSuiteSchema.parse(updateData)
    const { tenantId, organizationId, actorUserId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const suite = await em.findOne(DataQualitySuite, {
      id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (!suite) {
      throw new CrudHttpError(404, 'Suite not found')
    }

    if (parsed.name !== undefined) suite.name = parsed.name
    if (parsed.description !== undefined) suite.description = parsed.description ?? null
    if (parsed.enabled !== undefined) suite.enabled = parsed.enabled
    suite.updatedBy = actorUserId

    await em.flush()
    await emitSuiteCrudSideEffects(ctx, 'updated', suite, tenantId, organizationId)

    return { id: suite.id }
  },
}

const deleteSuiteCommand: CommandHandler<{ id: string }, { id: string }> = {
  id: 'data_quality.suite.delete',
  async execute(rawInput, ctx) {
    const { tenantId, organizationId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const suite = await em.findOne(DataQualitySuite, {
      id: rawInput.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (!suite) {
      throw new CrudHttpError(404, 'Suite not found')
    }

    suite.deletedAt = new Date()
    await em.flush()
    await emitSuiteCrudSideEffects(ctx, 'deleted', suite, tenantId, organizationId)

    return { id: suite.id }
  },
}

const assignSuiteChecksCommand: CommandHandler<AssignSuiteChecksInput & { suiteId: string }, { suiteId: string; count: number }> = {
  id: 'data_quality.suite_check.assign',
  async execute(rawInput, ctx) {
    const { suiteId, ...assignData } = rawInput
    const parsed = assignSuiteChecksSchema.parse(assignData)
    const { tenantId, organizationId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const suite = await em.findOne(DataQualitySuite, {
      id: suiteId,
      tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (!suite) {
      throw new CrudHttpError(404, 'Suite not found')
    }

    const checkIds = Array.from(new Set(parsed.checkIds))
    const checks = await em.find(DataQualityCheck, {
      id: { $in: checkIds },
      tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (checks.length !== checkIds.length) {
      throw new CrudHttpError(400, 'One or more checks could not be found')
    }

    const targetEntityTypes = new Set(checks.map((check) => check.targetEntityType))
    if (targetEntityTypes.size > 1) {
      throw new CrudHttpError(400, 'All checks assigned to a suite must target the same entity type')
    }

    const existingAssignments = await em.find(DataQualitySuiteCheck, {
      suiteId,
      tenantId,
      organizationId,
    } as never)
    const assignmentByCheckId = new Map(existingAssignments.map((assignment) => [assignment.checkId, assignment]))
    const requestedCheckIds = new Set(checkIds)
    const now = new Date()

    if (parsed.mode === 'replace') {
      let sequence = 0
      for (const assignment of existingAssignments) {
        if (!requestedCheckIds.has(assignment.checkId) && assignment.deletedAt === null) {
          assignment.deletedAt = now
        }
      }

      for (const checkId of checkIds) {
        const assignment = assignmentByCheckId.get(checkId)
        if (assignment) {
          assignment.deletedAt = null
          assignment.enabled = true
          assignment.sequence = sequence
        } else {
          em.create(DataQualitySuiteCheck, {
            suiteId,
            checkId,
            sequence,
            enabled: true,
            tenantId,
            organizationId,
          })
        }
        sequence += 1
      }
    } else {
      let sequence = existingAssignments
        .filter((assignment) => assignment.deletedAt === null)
        .reduce((max, assignment) => Math.max(max, assignment.sequence), -1) + 1

      for (const checkId of checkIds) {
        const assignment = assignmentByCheckId.get(checkId)
        if (assignment?.deletedAt === null) {
          continue
        }

        if (assignment) {
          assignment.deletedAt = null
          assignment.enabled = true
          assignment.sequence = sequence
        } else {
          em.create(DataQualitySuiteCheck, {
            suiteId,
            checkId,
            sequence,
            enabled: true,
            tenantId,
            organizationId,
          })
        }

        sequence += 1
      }
    }

    await em.flush()
    await emitSuiteCrudSideEffects(ctx, 'updated', suite, tenantId, organizationId)

    return { suiteId, count: checkIds.length }
  },
}

registerCommand(createSuiteCommand)
registerCommand(updateSuiteCommand)
registerCommand(deleteSuiteCommand)
registerCommand(assignSuiteChecksCommand)
