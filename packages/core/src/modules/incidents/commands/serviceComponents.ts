import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import {
  IncidentServiceComponent,
  IncidentServiceDependency,
} from '../data/entities'
import {
  serviceComponentCreateSchema,
  serviceComponentUpdateSchema,
  serviceDependencyCreateSchema,
  serviceDependencyUpdateSchema,
  type IncidentServiceComponentCreateInput,
  type IncidentServiceComponentUpdateInput,
  type IncidentServiceDependencyCreateInput,
  type IncidentServiceDependencyUpdateInput,
} from '../data/validators'
import type { IncidentScope } from './incident'

type ScopedInput = {
  organizationId?: string | null
  tenantId?: string | null
}

type ConfigDeleteInput = ScopedInput & {
  id?: string
}

type ServiceComponentCommandResult = IncidentScope & {
  id: string
  updatedAt?: Date
}

const serviceComponentIndexer: CrudIndexerConfig<IncidentServiceComponent> = {
  entityType: E.incidents.incident_service_component,
}

const serviceDependencyIndexer: CrudIndexerConfig<IncidentServiceDependency> = {
  entityType: E.incidents.incident_service_dependency,
}

function resolveCommandScope(ctx: CommandRuntimeContext, input: ScopedInput): IncidentScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant scope required' })
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization scope required' })
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

async function emitSideEffects<TEntity extends IncidentServiceComponent | IncidentServiceDependency>(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  entity: TEntity,
  indexer: CrudIndexerConfig<TEntity>,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity,
    identifiers: {
      id: entity.id,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
    },
    indexer,
  })
}

async function ensureUniqueComponentKey(
  em: EntityManager,
  scope: IncidentScope,
  key: string,
  excludeId?: string,
): Promise<void> {
  const existing = await em.findOne(IncidentServiceComponent, { ...scope, key, deletedAt: null })
  if (existing?.id && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: 'Incident service component key already exists for this scope' })
  }
}

async function requireComponentInScope(
  em: EntityManager,
  scope: IncidentScope,
  id: string,
): Promise<IncidentServiceComponent> {
  const component = await em.findOne(IncidentServiceComponent, { id, ...scope, deletedAt: null })
  if (!component) throw new CrudHttpError(404, { error: '[internal] incident service component not found' })
  return component
}

async function requireDependencyInScope(
  em: EntityManager,
  scope: IncidentScope,
  id: string,
): Promise<IncidentServiceDependency> {
  const dependency = await em.findOne(IncidentServiceDependency, { id, ...scope, deletedAt: null })
  if (!dependency) throw new CrudHttpError(404, { error: '[internal] incident service dependency not found' })
  return dependency
}

async function ensureUniqueDependency(
  em: EntityManager,
  scope: IncidentScope,
  sourceComponentId: string,
  targetComponentId: string,
  dependencyKind: string,
  excludeId?: string,
): Promise<void> {
  if (sourceComponentId === targetComponentId) {
    throw new CrudHttpError(400, { error: 'Incident service dependency cannot point to itself' })
  }
  const existing = await em.findOne(IncidentServiceDependency, {
    ...scope,
    sourceComponentId,
    targetComponentId,
    dependencyKind,
    deletedAt: null,
  })
  if (existing?.id && existing.id !== excludeId) {
    throw new CrudHttpError(409, { error: 'Incident service dependency already exists for this scope' })
  }
}

const createServiceComponentCommand: CommandHandler<
  IncidentServiceComponentCreateInput,
  ServiceComponentCommandResult
> = {
  id: 'incidents.service_components.create',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = serviceComponentCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureUniqueComponentKey(em, scope, parsed.key)
    const now = new Date()
    let component!: IncidentServiceComponent
    await withAtomicFlush(em, [() => {
      component = em.create(IncidentServiceComponent, {
        ...scope,
        key: parsed.key,
        name: parsed.name,
        description: normalizeOptionalText(parsed.description),
        componentType: parsed.componentType ?? 'service',
        ownerTeamId: parsed.ownerTeamId ?? null,
        ownerUserId: parsed.ownerUserId ?? null,
        criticality: parsed.criticality ?? 'medium',
        tier: normalizeOptionalText(parsed.tier),
        sloTargetBasisPoints: parsed.sloTargetBasisPoints ?? null,
        sourceType: normalizeOptionalText(parsed.sourceType),
        sourceId: normalizeOptionalText(parsed.sourceId),
        snapshot: parsed.snapshot ?? null,
        isActive: parsed.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(component)
    }], { transaction: true, label: 'incidents.service_components.create' })
    await emitSideEffects(ctx, 'created', component, serviceComponentIndexer)
    return { id: component.id, ...scope, updatedAt: component.updatedAt }
  },
}

const updateServiceComponentCommand: CommandHandler<
  IncidentServiceComponentUpdateInput,
  ServiceComponentCommandResult
> = {
  id: 'incidents.service_components.update',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = serviceComponentUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const component = await requireComponentInScope(em, scope, parsed.id)
    if (parsed.key !== undefined && parsed.key !== component.key) {
      await ensureUniqueComponentKey(em, scope, parsed.key, component.id)
    }
    await withAtomicFlush(em, [() => {
      if (parsed.key !== undefined) component.key = parsed.key
      if (parsed.name !== undefined) component.name = parsed.name
      if (parsed.description !== undefined) component.description = normalizeOptionalText(parsed.description)
      if (parsed.componentType !== undefined) component.componentType = parsed.componentType
      if (parsed.ownerTeamId !== undefined) component.ownerTeamId = parsed.ownerTeamId ?? null
      if (parsed.ownerUserId !== undefined) component.ownerUserId = parsed.ownerUserId ?? null
      if (parsed.criticality !== undefined) component.criticality = parsed.criticality
      if (parsed.tier !== undefined) component.tier = normalizeOptionalText(parsed.tier)
      if (parsed.sloTargetBasisPoints !== undefined) component.sloTargetBasisPoints = parsed.sloTargetBasisPoints ?? null
      if (parsed.sourceType !== undefined) component.sourceType = normalizeOptionalText(parsed.sourceType)
      if (parsed.sourceId !== undefined) component.sourceId = normalizeOptionalText(parsed.sourceId)
      if (parsed.snapshot !== undefined) component.snapshot = parsed.snapshot ?? null
      if (parsed.isActive !== undefined) component.isActive = parsed.isActive
      component.updatedAt = new Date()
    }], { transaction: true, label: 'incidents.service_components.update' })
    await emitSideEffects(ctx, 'updated', component, serviceComponentIndexer)
    return { id: component.id, ...scope, updatedAt: component.updatedAt }
  },
}

const deleteServiceComponentCommand: CommandHandler<ConfigDeleteInput, ServiceComponentCommandResult> = {
  id: 'incidents.service_components.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Incident service component id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const component = await requireComponentInScope(em, scope, id)
    const dependencies = await em.find(IncidentServiceDependency, {
      ...scope,
      deletedAt: null,
      $or: [{ sourceComponentId: id }, { targetComponentId: id }],
    })
    const now = new Date()
    await withAtomicFlush(em, [() => {
      component.deletedAt = now
      component.isActive = false
      component.updatedAt = now
      for (const dependency of dependencies) {
        dependency.deletedAt = now
        dependency.isActive = false
        dependency.updatedAt = now
      }
    }], { transaction: true, label: 'incidents.service_components.delete' })
    for (const dependency of dependencies) {
      await emitSideEffects(ctx, 'deleted', dependency, serviceDependencyIndexer)
    }
    await emitSideEffects(ctx, 'deleted', component, serviceComponentIndexer)
    return { id: component.id, ...scope, updatedAt: component.updatedAt }
  },
}

const createServiceDependencyCommand: CommandHandler<
  IncidentServiceDependencyCreateInput,
  ServiceComponentCommandResult
> = {
  id: 'incidents.service_dependencies.create',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = serviceDependencyCreateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await requireComponentInScope(em, scope, parsed.sourceComponentId)
    await requireComponentInScope(em, scope, parsed.targetComponentId)
    const dependencyKind = normalizeOptionalText(parsed.dependencyKind) ?? 'depends_on'
    await ensureUniqueDependency(em, scope, parsed.sourceComponentId, parsed.targetComponentId, dependencyKind)
    const now = new Date()
    let dependency!: IncidentServiceDependency
    await withAtomicFlush(em, [() => {
      dependency = em.create(IncidentServiceDependency, {
        ...scope,
        sourceComponentId: parsed.sourceComponentId,
        targetComponentId: parsed.targetComponentId,
        dependencyKind,
        snapshot: parsed.snapshot ?? null,
        isActive: parsed.isActive ?? true,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      em.persist(dependency)
    }], { transaction: true, label: 'incidents.service_dependencies.create' })
    await emitSideEffects(ctx, 'created', dependency, serviceDependencyIndexer)
    return { id: dependency.id, ...scope, updatedAt: dependency.updatedAt }
  },
}

const updateServiceDependencyCommand: CommandHandler<
  IncidentServiceDependencyUpdateInput,
  ServiceComponentCommandResult
> = {
  id: 'incidents.service_dependencies.update',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = serviceDependencyUpdateSchema.parse(input)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dependency = await requireDependencyInScope(em, scope, parsed.id)
    const sourceComponentId = parsed.sourceComponentId ?? dependency.sourceComponentId
    const targetComponentId = parsed.targetComponentId ?? dependency.targetComponentId
    const dependencyKind = normalizeOptionalText(parsed.dependencyKind) ?? dependency.dependencyKind
    if (parsed.sourceComponentId !== undefined) await requireComponentInScope(em, scope, parsed.sourceComponentId)
    if (parsed.targetComponentId !== undefined) await requireComponentInScope(em, scope, parsed.targetComponentId)
    if (
      sourceComponentId !== dependency.sourceComponentId ||
      targetComponentId !== dependency.targetComponentId ||
      dependencyKind !== dependency.dependencyKind
    ) {
      await ensureUniqueDependency(em, scope, sourceComponentId, targetComponentId, dependencyKind, dependency.id)
    }
    await withAtomicFlush(em, [() => {
      if (parsed.sourceComponentId !== undefined) dependency.sourceComponentId = parsed.sourceComponentId
      if (parsed.targetComponentId !== undefined) dependency.targetComponentId = parsed.targetComponentId
      if (parsed.dependencyKind !== undefined) dependency.dependencyKind = dependencyKind
      if (parsed.snapshot !== undefined) dependency.snapshot = parsed.snapshot ?? null
      if (parsed.isActive !== undefined) dependency.isActive = parsed.isActive
      dependency.updatedAt = new Date()
    }], { transaction: true, label: 'incidents.service_dependencies.update' })
    await emitSideEffects(ctx, 'updated', dependency, serviceDependencyIndexer)
    return { id: dependency.id, ...scope, updatedAt: dependency.updatedAt }
  },
}

const deleteServiceDependencyCommand: CommandHandler<ConfigDeleteInput, ServiceComponentCommandResult> = {
  id: 'incidents.service_dependencies.delete',
  isUndoable: false,
  async execute(input, ctx) {
    const id = requireId(input, 'Incident service dependency id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dependency = await requireDependencyInScope(em, scope, id)
    await withAtomicFlush(em, [() => {
      dependency.deletedAt = new Date()
      dependency.isActive = false
      dependency.updatedAt = new Date()
    }], { transaction: true, label: 'incidents.service_dependencies.delete' })
    await emitSideEffects(ctx, 'deleted', dependency, serviceDependencyIndexer)
    return { id: dependency.id, ...scope, updatedAt: dependency.updatedAt }
  },
}

registerCommand(createServiceComponentCommand)
registerCommand(updateServiceComponentCommand)
registerCommand(deleteServiceComponentCommand)
registerCommand(createServiceDependencyCommand)
registerCommand(updateServiceDependencyCommand)
registerCommand(deleteServiceDependencyCommand)
