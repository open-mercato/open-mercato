import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerBranch } from '../data/entities'
import {
  branchCreateSchema,
  branchUpdateSchema,
  type BranchCreateInput,
  type BranchUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
  type CustomFieldChangeSet,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'

const BRANCH_ENTITY_ID = 'customers:customer_branch'
const branchCrudIndexer: CrudIndexerConfig<CustomerBranch> = {
  entityType: E.customers.customer_branch,
}

const branchCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'branch',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type BranchSnapshot = {
  branch: {
    id: string
    organizationId: string
    tenantId: string
    companyEntityId: string
    name: string
    branchType: string | null
    specialization: string | null
    budget: string | null
    headcount: number | null
    responsiblePersonId: string | null
    isActive: boolean
  }
  custom?: Record<string, unknown>
}

type BranchUndoPayload = {
  before?: BranchSnapshot | null
  after?: BranchSnapshot | null
}

function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

async function loadBranchSnapshot(em: EntityManager, id: string): Promise<BranchSnapshot | null> {
  const branch = await findOneWithDecryption(em, CustomerBranch, { id, deletedAt: null })
  if (!branch) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: BRANCH_ENTITY_ID,
    recordId: branch.id,
    tenantId: branch.tenantId,
    organizationId: branch.organizationId,
  })
  return {
    branch: {
      id: branch.id,
      organizationId: branch.organizationId,
      tenantId: branch.tenantId,
      companyEntityId: branch.companyEntityId,
      name: branch.name,
      branchType: branch.branchType ?? null,
      specialization: branch.specialization ?? null,
      budget: branch.budget ?? null,
      headcount: branch.headcount ?? null,
      responsiblePersonId: branch.responsiblePersonId ?? null,
      isActive: branch.isActive,
    },
    custom,
  }
}

const createBranchCommand: CommandHandler<BranchCreateInput, { branchId: string }> = {
  id: 'customers.branches.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(branchCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const branch = em.create(CustomerBranch, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      companyEntityId: parsed.companyEntityId,
      name: parsed.name,
      branchType: parsed.branchType ?? null,
      specialization: parsed.specialization ?? null,
      budget: toNumericString(parsed.budget),
      headcount: parsed.headcount ?? null,
      responsiblePersonId: parsed.responsiblePersonId ?? null,
      isActive: parsed.isActive ?? true,
    })
    em.persist(branch)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: BRANCH_ENTITY_ID,
      recordId: branch.id,
      organizationId: branch.organizationId,
      tenantId: branch.tenantId,
      values: custom,
      notify: false,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: branch,
      identifiers: {
        id: branch.id,
        organizationId: branch.organizationId,
        tenantId: branch.tenantId,
      },
      indexer: branchCrudIndexer,
      events: branchCrudEvents,
    })

    return { branchId: branch.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadBranchSnapshot(em, result.branchId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as BranchSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.branches.create', 'Create branch'),
      resourceKind: 'customers.branch',
      resourceId: result.branchId,
      tenantId: snapshot?.branch.tenantId ?? null,
      organizationId: snapshot?.branch.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        } satisfies BranchUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const branchId = logEntry?.resourceId
    if (!branchId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const branch = await findOneWithDecryption(em, CustomerBranch, { id: branchId, deletedAt: null })
    if (!branch) return
    em.remove(branch)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: branch,
      identifiers: {
        id: branch.id,
        organizationId: branch.organizationId,
        tenantId: branch.tenantId,
      },
      indexer: branchCrudIndexer,
      events: branchCrudEvents,
    })
  },
}

const updateBranchCommand: CommandHandler<BranchUpdateInput, { branchId: string }> = {
  id: 'customers.branches.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(branchUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadBranchSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(branchUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const branch = await findOneWithDecryption(em, CustomerBranch, { id: parsed.id, deletedAt: null })
    if (!branch) throw new CrudHttpError(404, { error: 'Branch not found' })
    ensureTenantScope(ctx, branch.tenantId)
    ensureOrganizationScope(ctx, branch.organizationId)

    if (parsed.name !== undefined) branch.name = parsed.name
    if (parsed.branchType !== undefined) branch.branchType = parsed.branchType ?? null
    if (parsed.specialization !== undefined) branch.specialization = parsed.specialization ?? null
    if (parsed.budget !== undefined) branch.budget = toNumericString(parsed.budget)
    if (parsed.headcount !== undefined) branch.headcount = parsed.headcount ?? null
    if (parsed.responsiblePersonId !== undefined) branch.responsiblePersonId = parsed.responsiblePersonId ?? null
    if (parsed.isActive !== undefined) branch.isActive = parsed.isActive

    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: BRANCH_ENTITY_ID,
      recordId: branch.id,
      organizationId: branch.organizationId,
      tenantId: branch.tenantId,
      values: custom,
      notify: false,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: branch,
      identifiers: {
        id: branch.id,
        organizationId: branch.organizationId,
        tenantId: branch.tenantId,
      },
      indexer: branchCrudIndexer,
      events: branchCrudEvents,
    })

    return { branchId: branch.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadBranchSnapshot(em, result.branchId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as BranchSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as BranchSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.branches.update', 'Update branch'),
      resourceKind: 'customers.branch',
      resourceId: before.branch.id,
      tenantId: before.branch.tenantId,
      organizationId: before.branch.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies BranchUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = logEntry?.payload?.undo as BranchUndoPayload | undefined
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let branch = await em.findOne(CustomerBranch, { id: before.branch.id })
    if (!branch) {
      branch = em.create(CustomerBranch, {
        id: before.branch.id,
        organizationId: before.branch.organizationId,
        tenantId: before.branch.tenantId,
        companyEntityId: before.branch.companyEntityId,
        name: before.branch.name,
        branchType: before.branch.branchType as CustomerBranch['branchType'],
        specialization: before.branch.specialization,
        budget: before.branch.budget,
        headcount: before.branch.headcount,
        responsiblePersonId: before.branch.responsiblePersonId,
        isActive: before.branch.isActive,
      })
      em.persist(branch)
    } else {
      branch.name = before.branch.name
      branch.branchType = before.branch.branchType as CustomerBranch['branchType']
      branch.specialization = before.branch.specialization
      branch.budget = before.branch.budget
      branch.headcount = before.branch.headcount
      branch.responsiblePersonId = before.branch.responsiblePersonId
      branch.isActive = before.branch.isActive
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: branch,
      identifiers: {
        id: branch.id,
        organizationId: branch.organizationId,
        tenantId: branch.tenantId,
      },
      indexer: branchCrudIndexer,
      events: branchCrudEvents,
    })

    const resetValues = buildCustomFieldResetMap(before.custom, payload?.after?.custom)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: BRANCH_ENTITY_ID,
        recordId: branch.id,
        organizationId: branch.organizationId,
        tenantId: branch.tenantId,
        values: resetValues,
        notify: false,
      })
    }
  },
}

const deleteBranchCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { branchId: string }> =
  {
    id: 'customers.branches.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Branch id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadBranchSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Branch id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const branch = await findOneWithDecryption(em, CustomerBranch, { id, deletedAt: null })
      if (!branch) throw new CrudHttpError(404, { error: 'Branch not found' })
      ensureTenantScope(ctx, branch.tenantId)
      ensureOrganizationScope(ctx, branch.organizationId)
      em.remove(branch)
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: branch,
        identifiers: {
          id: branch.id,
          organizationId: branch.organizationId,
          tenantId: branch.tenantId,
        },
        indexer: branchCrudIndexer,
        events: branchCrudEvents,
      })
      return { branchId: branch.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as BranchSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.branches.delete', 'Delete branch'),
        resourceKind: 'customers.branch',
        resourceId: before.branch.id,
        tenantId: before.branch.tenantId,
        organizationId: before.branch.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies BranchUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = logEntry?.payload?.undo as BranchUndoPayload | undefined
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      let branch = await em.findOne(CustomerBranch, { id: before.branch.id })
      if (!branch) {
        branch = em.create(CustomerBranch, {
          id: before.branch.id,
          organizationId: before.branch.organizationId,
          tenantId: before.branch.tenantId,
          companyEntityId: before.branch.companyEntityId,
          name: before.branch.name,
          branchType: before.branch.branchType as CustomerBranch['branchType'],
          specialization: before.branch.specialization,
          budget: before.branch.budget,
          headcount: before.branch.headcount,
          responsiblePersonId: before.branch.responsiblePersonId,
          isActive: before.branch.isActive,
        })
        em.persist(branch)
      }
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: branch,
        identifiers: {
          id: branch.id,
          organizationId: branch.organizationId,
          tenantId: branch.tenantId,
        },
        indexer: branchCrudIndexer,
        events: branchCrudEvents,
      })

      const resetValues = buildCustomFieldResetMap(before.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: de,
          entityId: BRANCH_ENTITY_ID,
          recordId: branch.id,
          organizationId: branch.organizationId,
          tenantId: branch.tenantId,
          values: resetValues,
          notify: false,
        })
      }
    },
  }

registerCommand(createBranchCommand)
registerCommand(updateBranchCommand)
registerCommand(deleteBranchCommand)
