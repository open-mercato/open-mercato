import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { RequiredEntityData } from '@mikro-orm/core'
import {
  parseWithCustomFields,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
  setCustomFieldsIfAny,
  snapshotsEqual,
} from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { EudrPlot } from '../data/entities'
import {
  plotCreateSchema,
  plotUpdateSchema,
  type PlotCreateInput,
  type PlotUpdateInput,
} from '../data/validators'
import { validatePlotGeometry } from '../lib/geometry'

const PLOT_ENTITY_ID = 'eudr:eudr_plot'

type ScopedCommandInput = {
  tenantId: string
  organizationId: string
}

type SupplierSnapshot = {
  displayName?: string | null
}

type PlotSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  supplierEntityId: string
  supplierSnapshot: SupplierSnapshot | null
  name: string
  externalId: string | null
  description: string | null
  originCountry: string
  plotType: string
  geometry: Record<string, unknown>
  areaHa: string | null
  validationWarnings: string[]
  producerName: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom?: Record<string, unknown> | null
}

type PlotUndoPayload = {
  before?: PlotSnapshot | null
  after?: PlotSnapshot | null
}

type ScopedPlotCreateInput = PlotCreateInput & ScopedCommandInput
type ScopedPlotUpdateInput = PlotUpdateInput & Partial<ScopedCommandInput>

type PlotCommandResult = {
  entityId: string
  updatedAt?: Date
}

type NormalizedPlotGeometry = {
  plotType: string
  geometry: Record<string, unknown>
  areaHa: string | null
  validationWarnings: string[]
}

const scopedCommandInputSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const plotCrudIndexer: CrudIndexerConfig<EudrPlot> = {
  entityType: E.eudr.eudr_plot,
}

const plotCrudEvents: CrudEventsConfig<EudrPlot> = {
  module: 'eudr',
  entity: 'plot',
  persistent: true,
  buildPayload: (emitContext) => ({
    id: emitContext.identifiers.id,
    entityId: emitContext.entity?.id ?? emitContext.identifiers.id,
    organizationId: emitContext.identifiers.organizationId,
    tenantId: emitContext.identifiers.tenantId,
  }),
}

function parseScopedCommandInput(input: unknown): ScopedCommandInput {
  return scopedCommandInputSchema.parse(input)
}

function toNumericString(value: number | null | undefined): string | null {
  return value == null ? null : String(value)
}

function numericStringToNumber(value: string | null | undefined): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function normalizeFeature(feature: { type: string; properties: Record<string, unknown>; geometry: unknown }): Record<string, unknown> {
  return {
    type: feature.type,
    properties: feature.properties,
    geometry: feature.geometry,
  }
}

function isFeatureInput(geometry: unknown): boolean {
  return geometry !== null
    && typeof geometry === 'object'
    && !Array.isArray(geometry)
    && (geometry as Record<string, unknown>).type === 'Feature'
}

function normalizePlotGeometry(input: { geometry: unknown; areaHa?: number | null }): NormalizedPlotGeometry {
  const result = validatePlotGeometry(input.geometry)
  if (!result.ok) {
    throw new CrudHttpError(400, { error: `eudr.errors.${result.errorKey}` })
  }

  // Preserve the client-provided GeoJSON shape: bare geometries stay bare so
  // reads echo the submitted payload, Feature inputs keep their properties.
  const geometry = isFeatureInput(input.geometry)
    ? normalizeFeature(result.feature)
    : (result.feature.geometry as unknown as Record<string, unknown>)

  if (result.plotType === 'point') {
    if (input.areaHa == null || input.areaHa <= 0) {
      throw new CrudHttpError(400, { error: 'eudr.errors.pointAreaRequired' })
    }
    if (input.areaHa > 4) {
      throw new CrudHttpError(400, { error: 'eudr.errors.polygonRequired' })
    }
    return {
      plotType: result.plotType,
      geometry,
      areaHa: toNumericString(input.areaHa),
      validationWarnings: [...result.warnings],
    }
  }

  if (result.computedAreaHa == null || result.computedAreaHa <= 0) {
    throw new CrudHttpError(400, { error: 'eudr.errors.geometryInvalid' })
  }

  return {
    plotType: result.plotType,
    geometry,
    areaHa: toNumericString(result.computedAreaHa),
    validationWarnings: [...result.warnings],
  }
}

function plotSeedFromSnapshot(snapshot: PlotSnapshot): RequiredEntityData<EudrPlot> {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    supplierEntityId: snapshot.supplierEntityId,
    supplierSnapshot: snapshot.supplierSnapshot,
    name: snapshot.name,
    externalId: snapshot.externalId,
    description: snapshot.description,
    originCountry: snapshot.originCountry,
    plotType: snapshot.plotType,
    geometry: snapshot.geometry,
    areaHa: snapshot.areaHa,
    validationWarnings: [...snapshot.validationWarnings],
    producerName: snapshot.producerName,
    isActive: snapshot.isActive,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: toDate(snapshot.deletedAt),
  }
}

async function findPlot(
  em: EntityManager,
  entityId: string,
  includeDeleted = true,
): Promise<EudrPlot | null> {
  return includeDeleted
    ? findOneWithDecryption(em, EudrPlot, { id: entityId })
    : findOneWithDecryption(em, EudrPlot, { id: entityId, deletedAt: null })
}

async function loadPlotSnapshot(em: EntityManager, entityId: string): Promise<PlotSnapshot | null> {
  const record = await findPlot(em, entityId)
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: PLOT_ENTITY_ID,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    supplierEntityId: record.supplierEntityId,
    supplierSnapshot: record.supplierSnapshot ?? null,
    name: record.name,
    externalId: record.externalId ?? null,
    description: record.description ?? null,
    originCountry: record.originCountry,
    plotType: record.plotType,
    geometry: record.geometry,
    areaHa: record.areaHa ?? null,
    validationWarnings: Array.isArray(record.validationWarnings) ? [...record.validationWarnings] : [],
    producerName: record.producerName ?? null,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    custom: Object.keys(custom).length ? custom : null,
  }
}

function restorePlot(record: EudrPlot, snapshot: PlotSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.supplierEntityId = snapshot.supplierEntityId
  record.supplierSnapshot = snapshot.supplierSnapshot
  record.name = snapshot.name
  record.externalId = snapshot.externalId
  record.description = snapshot.description
  record.originCountry = snapshot.originCountry
  record.plotType = snapshot.plotType
  record.geometry = snapshot.geometry
  record.areaHa = snapshot.areaHa
  record.validationWarnings = [...snapshot.validationWarnings]
  record.producerName = snapshot.producerName
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = toDate(snapshot.deletedAt)
}

async function setPlotCustomFields(
  dataEngine: DataEngine,
  entityId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: PLOT_ENTITY_ID,
    recordId: entityId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

const createPlotCommand: CommandHandler<ScopedPlotCreateInput, PlotCommandResult> = {
  id: 'eudr.plots.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(plotCreateSchema, rawInput)
    const scope = parseScopedCommandInput(rawInput)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)

    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record!: EudrPlot

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: PLOT_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: plotCrudEvents,
      indexer: plotCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }),
      phases: [
        () => {
          const geometry = normalizePlotGeometry({
            geometry: parsed.geometry,
            areaHa: parsed.areaHa ?? null,
          })
          record = entityManager.create(EudrPlot, {
            id: randomUUID(),
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            supplierEntityId: parsed.supplierEntityId,
            supplierSnapshot: parsed.supplierSnapshot ?? null,
            name: parsed.name,
            externalId: parsed.externalId ?? null,
            description: parsed.description ?? null,
            originCountry: parsed.originCountry,
            plotType: geometry.plotType,
            geometry: geometry.geometry,
            areaHa: geometry.areaHa,
            validationWarnings: geometry.validationWarnings,
            producerName: parsed.producerName ?? null,
            isActive: parsed.isActive ?? true,
          })
          entityManager.persist(record)
        },
      ],
    })

    return { entityId: record.id }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadPlotSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as PlotSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.plots.create', 'Create EUDR plot'),
      resourceKind: 'eudr.plot',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies PlotUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PlotUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findPlot(entityManager, after.id)
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    await setPlotCustomFields(dataEngine, after.id, after.organizationId, after.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: plotCrudIndexer,
      events: plotCrudEvents,
    })
  },
  redo: makeCreateRedo<EudrPlot, PlotSnapshot, ScopedPlotCreateInput, PlotCommandResult>({
    entityClass: EudrPlot,
    seedFromSnapshot: plotSeedFromSnapshot,
    buildResult: (entity) => ({ entityId: entity.id }),
    indexer: plotCrudIndexer,
    events: plotCrudEvents,
    findRow: ({ em, id }) => findPlot(em, id),
    afterRestore: async ({ ctx, entity, snapshot }) => {
      if (!snapshot.custom || !Object.keys(snapshot.custom).length) return
      await setPlotCustomFields(
        ctx.container.resolve('dataEngine') as DataEngine,
        entity.id,
        entity.organizationId,
        entity.tenantId,
        snapshot.custom,
      )
    },
  }),
}

const updatePlotCommand: CommandHandler<ScopedPlotUpdateInput, PlotCommandResult> = {
  id: 'eudr.plots.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(plotUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadPlotSnapshot(entityManager, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(plotUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findPlot(entityManager, parsed.id, false)
    if (!record) throw new CrudHttpError(404, { error: 'eudr.errors.plotNotFound' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: PLOT_ENTITY_ID,
      action: 'updated',
      scope: { tenantId: record.tenantId, organizationId: record.organizationId },
      customFields: custom,
      events: plotCrudEvents,
      indexer: plotCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }),
      phases: [
        () => {
          const geometry = normalizePlotGeometry({
            geometry: parsed.geometry ?? record.geometry,
            areaHa: parsed.areaHa !== undefined ? parsed.areaHa : numericStringToNumber(record.areaHa),
          })
          if (parsed.supplierEntityId !== undefined) record.supplierEntityId = parsed.supplierEntityId
          if (parsed.supplierSnapshot !== undefined) record.supplierSnapshot = parsed.supplierSnapshot ?? null
          if (parsed.name !== undefined) record.name = parsed.name
          if (parsed.externalId !== undefined) record.externalId = parsed.externalId ?? null
          if (parsed.description !== undefined) record.description = parsed.description ?? null
          if (parsed.originCountry !== undefined) record.originCountry = parsed.originCountry
          record.plotType = geometry.plotType
          record.geometry = geometry.geometry
          record.areaHa = geometry.areaHa
          record.validationWarnings = geometry.validationWarnings
          if (parsed.producerName !== undefined) record.producerName = parsed.producerName ?? null
          if (parsed.isActive !== undefined) record.isActive = parsed.isActive
        },
      ],
    })

    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadPlotSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PlotSnapshot | undefined
    const after = snapshots.after as PlotSnapshot | undefined
    if (!before) return null
    if (after && snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.plots.update', 'Update EUDR plot'),
      resourceKind: 'eudr.plot',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before, after: after ?? null } satisfies PlotUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PlotUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findPlot(entityManager, before.id)
    if (!record) {
      record = entityManager.create(EudrPlot, plotSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restorePlot(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    await setPlotCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: plotCrudIndexer,
      events: plotCrudEvents,
    })
  },
}

const deletePlotCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, PlotCommandResult> = {
  id: 'eudr.plots.delete',
  async prepare(input, ctx) {
    const entityId = requireId(input, 'eudr.errors.plotIdRequired')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadPlotSnapshot(entityManager, entityId)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const entityId = requireId(input, 'eudr.errors.plotIdRequired')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findPlot(entityManager, entityId, false)
    if (!record) throw new CrudHttpError(404, { error: 'eudr.errors.plotNotFound' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const snapshot = await loadPlotSnapshot(entityManager, entityId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (snapshot?.custom) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      await setPlotCustomFields(dataEngine, snapshot.id, snapshot.organizationId, snapshot.tenantId, resetValues)
    }
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: plotCrudIndexer,
      events: plotCrudEvents,
    })
    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as PlotSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.plots.delete', 'Delete EUDR plot'),
      resourceKind: 'eudr.plot',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies PlotUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PlotUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findPlot(entityManager, before.id)
    if (!record) {
      record = entityManager.create(EudrPlot, plotSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restorePlot(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (before.custom) {
      await setPlotCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, before.custom)
    }
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: plotCrudIndexer,
      events: plotCrudEvents,
    })
  },
}

registerCommand(createPlotCommand)
registerCommand(updatePlotCommand)
registerCommand(deletePlotCommand)
