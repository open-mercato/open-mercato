import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerCompanyProfile,
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerEntity,
  CustomerLead,
  CustomerLeadHistory,
  CustomerLeadLostReason,
  CustomerLeadPipeline,
  CustomerLeadPipelineStage,
  CustomerPersonProfile,
  type CustomerLeadHistoryEntryType,
} from '../data/entities'
import {
  leadAdvanceStageSchema,
  leadAssignSchema,
  leadConvertSchema,
  leadCreateCompanySchema,
  leadCreateDealSchema,
  leadCreatePersonSchema,
  leadCreateSchema,
  leadDeleteSchema,
  leadLinkCompanySchema,
  leadLinkDealSchema,
  leadLinkPersonSchema,
  leadLostReasonCreateSchema,
  leadLostReasonDeleteSchema,
  leadLostReasonUpdateSchema,
  leadMarkLostSchema,
  leadPipelineCreateSchema,
  leadPipelineDeleteSchema,
  leadPipelineStageCreateSchema,
  leadPipelineStageDeleteSchema,
  leadPipelineStageUpdateSchema,
  leadPipelineUpdateSchema,
  leadUpdateSchema,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, normalizeAuthorUserId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

type Scope = { tenantId: string; organizationId: string }

const leadCrudIndexer: CrudIndexerConfig<CustomerLead> = {
  entityType: E.customers.customer_lead,
}

const leadCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'lead',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const personCrudIndexer: CrudIndexerConfig<CustomerEntity> = {
  entityType: E.customers.customer_person_profile,
}

const personCrudEvents: CrudEventsConfig<CustomerEntity> = {
  module: 'customers',
  entity: 'person',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    entityId: ctx.entity?.id ?? ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const companyCrudIndexer: CrudIndexerConfig<CustomerEntity> = {
  entityType: E.customers.customer_company_profile,
}

const companyCrudEvents: CrudEventsConfig<CustomerEntity> = {
  module: 'customers',
  entity: 'company',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    entityId: ctx.entity?.id ?? ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const dealCrudIndexer: CrudIndexerConfig<CustomerDeal> = {
  entityType: E.customers.customer_deal,
}

const dealCrudEvents: CrudEventsConfig<CustomerDeal> = {
  module: 'customers',
  entity: 'deal',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

function readString(record: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!record) return null
  const value = record[key]
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!record) return null
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function dataRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' ? value : {}
}

async function loadLead(em: EntityManager, id: string, scope: Scope): Promise<CustomerLead> {
  const lead = await findOneWithDecryption(
    em,
    CustomerLead,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!lead) throw notFound('Lead not found')
  return lead
}

async function appendHistory(
  em: EntityManager,
  lead: CustomerLead,
  entryType: CustomerLeadHistoryEntryType,
  input: { message?: string | null; payload?: Record<string, unknown> | null; actorUserId?: string | null } = {},
): Promise<void> {
  const entry = em.create(CustomerLeadHistory, {
    organizationId: lead.organizationId,
    tenantId: lead.tenantId,
    leadId: lead.id,
    entryType,
    actorUserId: input.actorUserId ?? null,
    message: input.message ?? null,
    payload: input.payload ?? null,
    createdAt: new Date(),
  })
  em.persist(entry)
}

async function resolvePipeline(
  em: EntityManager,
  scope: Scope,
  pipelineId?: string | null,
): Promise<CustomerLeadPipeline> {
  const pipeline = pipelineId
    ? await em.findOne(CustomerLeadPipeline, {
        id: pipelineId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    : await em.findOne(CustomerLeadPipeline, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        isActive: true,
        isDefault: true,
      }) ?? await em.findOne(CustomerLeadPipeline, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        isActive: true,
      })
  if (!pipeline) {
    throw new CrudHttpError(400, { error: 'No active lead pipeline is configured.' })
  }
  return pipeline
}

async function resolveStage(
  em: EntityManager,
  pipelineId: string,
  stageId?: string | null,
  kind: 'open' | 'won' | 'lost' = 'open',
): Promise<CustomerLeadPipelineStage> {
  if (stageId) {
    const stage = await em.findOne(CustomerLeadPipelineStage, { id: stageId, pipelineId })
    if (!stage) {
      throw new CrudHttpError(400, { error: 'The selected stage does not belong to this pipeline.' })
    }
    return stage
  }
  const stage = await em.findOne(
    CustomerLeadPipelineStage,
    { pipelineId, kind, isActive: true },
    { orderBy: { position: 'asc' } },
  )
  if (!stage) {
    throw new CrudHttpError(400, { error: 'The selected pipeline has no usable stage.' })
  }
  return stage
}

async function resolveLostReason(
  em: EntityManager,
  lead: { pipelineId: string; tenantId: string; organizationId: string },
  lostReasonId: string,
): Promise<CustomerLeadLostReason> {
  const reason = await em.findOne(CustomerLeadLostReason, {
    id: lostReasonId,
    tenantId: lead.tenantId,
    organizationId: lead.organizationId,
  })
  if (!reason || (reason.pipelineId && reason.pipelineId !== lead.pipelineId)) {
    throw new CrudHttpError(400, { error: 'The selected lost reason does not apply to this pipeline.' })
  }
  return reason
}

async function ensureLeadUnlocked(lead: CustomerLead): Promise<void> {
  if (lead.convertedAt || lead.conversionLockedAt) {
    throw new CrudHttpError(409, { error: 'This lead has already been converted.' })
  }
}

async function enforceLeadOptimisticLock(
  ctx: CommandRuntimeContext,
  lead: CustomerLead,
): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: 'customers.lead',
    resourceId: lead.id,
    current: lead.updatedAt,
    request: ctx.request ?? null,
  })
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const key of keys) {
    if (key === 'updatedAt') continue
    const left = before[key]
    const right = after[key]
    if (JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)) changed.push(key)
  }
  return changed.sort((left, right) => left.localeCompare(right))
}

async function emitLifecycleEvent(
  ctx: { container: { resolve(name: string): unknown } },
  event: string,
  lead: CustomerLead,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const eventBus = ctx.container.resolve('eventBus') as
      | { emitEvent(event: string, payload: unknown, options?: unknown): Promise<void> }
      | undefined
    if (!eventBus) return
    await eventBus.emitEvent(
      event,
      {
        id: lead.id,
        tenantId: lead.tenantId,
        organizationId: lead.organizationId,
        pipelineId: lead.pipelineId,
        stageId: lead.stageId,
        outcome: lead.outcome,
        ownerUserId: lead.ownerUserId ?? null,
        displayName: lead.displayName,
        ...extra,
      },
      {
        persistent: true,
        tenantId: lead.tenantId,
        organizationId: lead.organizationId,
      },
    )
  } catch (err) {
    logger.warn('Lead lifecycle event emit failed', { component: 'leads', event, err })
  }
}

async function createPersonFromLead(
  em: EntityManager,
  lead: CustomerLead,
  overrides: Record<string, unknown>,
): Promise<CustomerEntity> {
  const data = { ...dataRecord(lead.personData), ...overrides }
  const displayName = readString(data, 'displayName') ?? lead.displayName
  const firstName = readString(data, 'firstName')
  const lastName = readString(data, 'lastName')
  const [fallbackFirst, ...fallbackRest] = displayName.split(/\s+/)
  const entity = em.create(CustomerEntity, {
    organizationId: lead.organizationId,
    tenantId: lead.tenantId,
    kind: 'person',
    displayName,
    description: readString(data, 'description'),
    ownerUserId: lead.ownerUserId ?? null,
    primaryEmail: readString(data, 'primaryEmail') ?? lead.primaryEmail ?? null,
    primaryPhone: readString(data, 'primaryPhone') ?? lead.primaryPhone ?? null,
    status: readString(data, 'status'),
    lifecycleStage: readString(data, 'lifecycleStage'),
    source: lead.source ?? null,
    isActive: true,
  })
  const profile = em.create(CustomerPersonProfile, {
    organizationId: lead.organizationId,
    tenantId: lead.tenantId,
    entity,
    firstName: firstName ?? fallbackFirst ?? null,
    lastName: lastName ?? (fallbackRest.join(' ') || null),
    preferredName: readString(data, 'preferredName'),
    jobTitle: readString(data, 'jobTitle'),
    department: readString(data, 'department'),
    seniority: readString(data, 'seniority'),
    linkedInUrl: readString(data, 'linkedInUrl'),
    company: null,
  })
  em.persist(entity)
  em.persist(profile)
  return entity
}

async function createCompanyFromLead(
  em: EntityManager,
  lead: CustomerLead,
  overrides: Record<string, unknown>,
): Promise<CustomerEntity> {
  const data = { ...dataRecord(lead.companyData), ...overrides }
  const displayName = readString(data, 'displayName') ?? lead.displayName
  const entity = em.create(CustomerEntity, {
    organizationId: lead.organizationId,
    tenantId: lead.tenantId,
    kind: 'company',
    displayName,
    description: readString(data, 'description'),
    ownerUserId: lead.ownerUserId ?? null,
    primaryEmail: readString(data, 'primaryEmail') ?? lead.primaryEmail ?? null,
    primaryPhone: readString(data, 'primaryPhone') ?? lead.primaryPhone ?? null,
    status: readString(data, 'status'),
    lifecycleStage: readString(data, 'lifecycleStage'),
    source: lead.source ?? null,
    isActive: true,
    temperature: readString(data, 'temperature'),
  })
  const profile = em.create(CustomerCompanyProfile, {
    organizationId: lead.organizationId,
    tenantId: lead.tenantId,
    entity,
    legalName: readString(data, 'legalName'),
    brandName: readString(data, 'brandName'),
    domain: readString(data, 'domain'),
    websiteUrl: readString(data, 'websiteUrl'),
    industry: readString(data, 'industry'),
    sizeBucket: readString(data, 'sizeBucket'),
    annualRevenue: readNumber(data, 'annualRevenue') !== null ? String(readNumber(data, 'annualRevenue')) : null,
  })
  em.persist(entity)
  em.persist(profile)
  return entity
}

async function createDealFromLead(
  em: EntityManager,
  lead: CustomerLead,
  overrides: Record<string, unknown>,
  personEntity: CustomerEntity | null,
  companyEntity: CustomerEntity | null,
): Promise<CustomerDeal> {
  const data = { ...dataRecord(lead.dealData), ...overrides }
  const title = readString(data, 'title') ?? readString(data, 'displayName') ?? lead.displayName
  const valueAmount = readNumber(data, 'valueAmount')
  const deal = em.create(CustomerDeal, {
    organizationId: lead.organizationId,
    tenantId: lead.tenantId,
    title,
    description: readString(data, 'description'),
    status: readString(data, 'status') ?? 'open',
    pipelineId: readString(data, 'pipelineId'),
    pipelineStageId: readString(data, 'pipelineStageId'),
    valueAmount: valueAmount !== null ? String(valueAmount) : null,
    valueCurrency: readString(data, 'valueCurrency') ?? 'SAR',
    probability: readNumber(data, 'probability'),
    expectedCloseAt: data.expectedCloseAt ? new Date(String(data.expectedCloseAt)) : null,
    ownerUserId: lead.ownerUserId ?? null,
    source: lead.source ?? null,
  })
  em.persist(deal)
  if (personEntity) {
    em.persist(em.create(CustomerDealPersonLink, {
      deal,
      person: personEntity,
    }))
  }
  if (companyEntity) {
    em.persist(em.create(CustomerDealCompanyLink, {
      deal,
      company: companyEntity,
    }))
  }
  return deal
}

async function loadLinkedPerson(
  em: EntityManager,
  id: string | null | undefined,
  scope: Scope,
): Promise<CustomerEntity | null> {
  if (!id) return null
  const entity = await em.findOne(CustomerEntity, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    kind: 'person',
  })
  if (!entity) throw new CrudHttpError(400, { error: 'The selected person was not found.' })
  return entity
}

async function loadLinkedCompany(
  em: EntityManager,
  id: string | null | undefined,
  scope: Scope,
): Promise<CustomerEntity | null> {
  if (!id) return null
  const entity = await em.findOne(CustomerEntity, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    kind: 'company',
  })
  if (!entity) throw new CrudHttpError(400, { error: 'The selected company was not found.' })
  return entity
}

async function loadLinkedDeal(
  em: EntityManager,
  id: string | null | undefined,
  scope: Scope,
): Promise<CustomerDeal | null> {
  if (!id) return null
  const deal = await em.findOne(CustomerDeal, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!deal) throw new CrudHttpError(400, { error: 'The selected deal was not found.' })
  return deal
}

const createLeadCommand: CommandHandler<z.infer<typeof leadCreateSchema>, { leadId: string }> = {
  id: 'customers.leads.create',
  async execute(rawInput, ctx) {
    const parsed = leadCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const pipeline = await resolvePipeline(em, scope, parsed.pipelineId)
    const stage = await resolveStage(em, pipeline.id, parsed.stageId, 'open')
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    let lead!: CustomerLead
    await withAtomicFlush(em, [
      () => {
        lead = em.create(CustomerLead, {
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          outcome: 'open',
          displayName: parsed.displayName,
          ownerUserId: parsed.ownerUserId ?? null,
          source: parsed.source ?? null,
          sourceChannel: parsed.sourceChannel ?? null,
          sourceExternalId: parsed.sourceExternalId ?? null,
          sourcePayloadRaw: parsed.sourcePayloadRaw ?? null,
          sourceReceivedAt: parsed.sourceReceivedAt ?? (parsed.sourcePayloadRaw ? new Date() : null),
          primaryEmail: parsed.primaryEmail ?? null,
          primaryPhone: parsed.primaryPhone ?? null,
          vatId: parsed.vatId ?? null,
          spamScore: parsed.spamScore !== undefined && parsed.spamScore !== null ? String(parsed.spamScore) : null,
          qualificationNotes: parsed.qualificationNotes ?? null,
          personData: parsed.personData ?? null,
          companyData: parsed.companyData ?? null,
          dealData: parsed.dealData ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(lead)
      },
      () => appendHistory(em, lead, 'created', { actorUserId, message: null }),
    ], { transaction: true, label: 'customers.leads.create' })

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: lead,
      identifiers: { id: lead.id, organizationId: lead.organizationId, tenantId: lead.tenantId },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
      actorUserId,
    })
    await emitLifecycleEvent(ctx, 'customers.lead.created', lead)
    return { leadId: lead.id }
  },
}

const updateLeadCommand: CommandHandler<z.infer<typeof leadUpdateSchema>, void> = {
  id: 'customers.leads.update',
  async execute(rawInput, ctx) {
    const parsed = leadUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await findOneWithDecryption(em, CustomerLead, { id: parsed.id, deletedAt: null })
    if (!lead) throw notFound('Lead not found')
    ensureTenantScope(ctx, lead.tenantId)
    ensureOrganizationScope(ctx, lead.organizationId)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: 'customers.lead',
      resourceId: lead.id,
      current: lead.updatedAt,
      request: ctx.request ?? null,
    })
    const before = {
      displayName: lead.displayName,
      ownerUserId: lead.ownerUserId ?? null,
      source: lead.source ?? null,
      sourceChannel: lead.sourceChannel ?? null,
      primaryEmail: lead.primaryEmail ?? null,
      primaryPhone: lead.primaryPhone ?? null,
      vatId: lead.vatId ?? null,
      qualificationNotes: lead.qualificationNotes ?? null,
      personData: lead.personData ?? null,
      companyData: lead.companyData ?? null,
      dealData: lead.dealData ?? null,
    }
    const nextPipelineId = parsed.pipelineId ?? lead.pipelineId
    const nextStageId = parsed.stageId ?? lead.stageId
    if (parsed.pipelineId !== undefined || parsed.stageId !== undefined) {
      const stage = await em.findOne(CustomerLeadPipelineStage, {
        id: nextStageId,
        pipelineId: nextPipelineId,
      })
      if (!stage) {
        throw new CrudHttpError(400, { error: 'The selected stage does not belong to this pipeline.' })
      }
      if (stage.kind !== 'open' && stage.id !== lead.stageId) {
        throw new CrudHttpError(400, {
          error: 'Use the stage or conversion actions to close a lead.',
        })
      }
    }
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    await withAtomicFlush(em, [
      () => {
        if (parsed.displayName !== undefined) lead.displayName = parsed.displayName
        if (parsed.ownerUserId !== undefined) lead.ownerUserId = parsed.ownerUserId ?? null
        if (parsed.source !== undefined) lead.source = parsed.source ?? null
        if (parsed.sourceChannel !== undefined) lead.sourceChannel = parsed.sourceChannel ?? null
        if (parsed.sourceExternalId !== undefined) lead.sourceExternalId = parsed.sourceExternalId ?? null
        if (parsed.sourcePayloadRaw !== undefined) lead.sourcePayloadRaw = parsed.sourcePayloadRaw ?? null
        if (parsed.sourceReceivedAt !== undefined) lead.sourceReceivedAt = parsed.sourceReceivedAt ?? null
        if (parsed.primaryEmail !== undefined) lead.primaryEmail = parsed.primaryEmail ?? null
        if (parsed.primaryPhone !== undefined) lead.primaryPhone = parsed.primaryPhone ?? null
        if (parsed.vatId !== undefined) lead.vatId = parsed.vatId ?? null
        if (parsed.spamScore !== undefined) {
          lead.spamScore = parsed.spamScore !== null ? String(parsed.spamScore) : null
        }
        if (parsed.qualificationNotes !== undefined) lead.qualificationNotes = parsed.qualificationNotes ?? null
        if (parsed.personData !== undefined) lead.personData = parsed.personData ?? null
        if (parsed.companyData !== undefined) lead.companyData = parsed.companyData ?? null
        if (parsed.dealData !== undefined) lead.dealData = parsed.dealData ?? null
        if (parsed.pipelineId !== undefined) {
          if (!parsed.pipelineId) throw new CrudHttpError(400, { error: 'A pipeline is required.' })
          lead.pipelineId = parsed.pipelineId
        }
        if (parsed.stageId !== undefined) {
          if (!parsed.stageId) throw new CrudHttpError(400, { error: 'A stage is required.' })
          lead.stageId = parsed.stageId
        }
        lead.updatedAt = new Date()
      },
      () => appendHistory(em, lead, 'updated', {
        actorUserId,
        payload: { fields: changedFields(before, {
          displayName: lead.displayName,
          ownerUserId: lead.ownerUserId ?? null,
          source: lead.source ?? null,
          sourceChannel: lead.sourceChannel ?? null,
          primaryEmail: lead.primaryEmail ?? null,
          primaryPhone: lead.primaryPhone ?? null,
          vatId: lead.vatId ?? null,
          qualificationNotes: lead.qualificationNotes ?? null,
          personData: lead.personData ?? null,
          companyData: lead.companyData ?? null,
          dealData: lead.dealData ?? null,
        }) },
      }),
    ], { transaction: true, label: 'customers.leads.update' })

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: lead,
      identifiers: { id: lead.id, organizationId: lead.organizationId, tenantId: lead.tenantId },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
      actorUserId,
    })
    await emitLifecycleEvent(ctx, 'customers.lead.updated', lead)
  },
}

const deleteLeadCommand: CommandHandler<z.infer<typeof leadDeleteSchema>, void> = {
  id: 'customers.leads.delete',
  async execute(rawInput, ctx) {
    const parsed = leadDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await em.findOne(CustomerLead, { id: parsed.id, deletedAt: null })
    if (!lead) {
      enforceRecordGoneIsConflict({ resourceKind: 'customers.lead', resourceId: parsed.id, request: ctx.request ?? null })
      throw notFound('Lead not found')
    }
    ensureTenantScope(ctx, lead.tenantId)
    ensureOrganizationScope(ctx, lead.organizationId)
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: 'customers.lead',
      resourceId: lead.id,
      current: lead.updatedAt,
      request: ctx.request ?? null,
    })
    lead.deletedAt = new Date()
    lead.updatedAt = new Date()
    await em.flush()
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: lead,
      identifiers: { id: lead.id, organizationId: lead.organizationId, tenantId: lead.tenantId },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
      actorUserId: normalizeAuthorUserId(null, ctx.auth),
    })
    await emitLifecycleEvent(ctx, 'customers.lead.deleted', lead)
  },
}

const assignLeadCommand: CommandHandler<z.infer<typeof leadAssignSchema>, void> = {
  id: 'customers.leads.assign',
  async execute(rawInput, ctx) {
    const parsed = leadAssignSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await loadLead(em, parsed.id, scope)
    await enforceLeadOptimisticLock(ctx, lead)
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    await withAtomicFlush(em, [
      () => {
        lead.ownerUserId = parsed.ownerUserId
        lead.updatedAt = new Date()
      },
      () => appendHistory(em, lead, 'assigned', {
        actorUserId,
        payload: { ownerUserId: parsed.ownerUserId },
      }),
    ], { transaction: true, label: 'customers.leads.assign' })
    await emitLifecycleEvent(ctx, 'customers.lead.assigned', lead, { ownerUserId: parsed.ownerUserId })
  },
}

const advanceLeadStageCommand: CommandHandler<z.infer<typeof leadAdvanceStageSchema>, void> = {
  id: 'customers.leads.advance_stage',
  async execute(rawInput, ctx) {
    const parsed = leadAdvanceStageSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await loadLead(em, parsed.id, scope)
    await enforceLeadOptimisticLock(ctx, lead)
    const stage = await resolveStage(em, lead.pipelineId, parsed.stageId)
    if (stage.kind === 'won') {
      throw new CrudHttpError(400, {
        error: 'Use the conversion action to move a lead to a won stage.',
      })
    }
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    const previousStageId = lead.stageId
    if (stage.kind === 'lost') {
      if (!parsed.lostReasonId) {
        throw new CrudHttpError(400, { error: 'A lost reason is required to close a lead as lost.' })
      }
      await resolveLostReason(em, lead, parsed.lostReasonId)
    }
    await withAtomicFlush(em, [
      () => {
        lead.stageId = stage.id
        if (stage.kind === 'lost') {
          lead.outcome = 'lost'
          lead.lostReasonId = parsed.lostReasonId ?? null
        } else {
          lead.outcome = 'open'
          lead.lostReasonId = null
        }
        lead.updatedAt = new Date()
      },
      () => appendHistory(em, lead, stage.kind === 'lost' ? 'lost' : 'stage_changed', {
        actorUserId,
        message: parsed.note ?? null,
        payload: { fromStageId: previousStageId, toStageId: stage.id, stageKind: stage.kind },
      }),
    ], { transaction: true, label: 'customers.leads.advance_stage' })
    await emitLifecycleEvent(ctx, stage.kind === 'lost' ? 'customers.lead.lost' : 'customers.lead.stage_changed', lead, {
      stageId: stage.id,
      stageKind: stage.kind,
      previousStageId,
    })
  },
}

const markLeadLostCommand: CommandHandler<z.infer<typeof leadMarkLostSchema>, void> = {
  id: 'customers.leads.mark_lost',
  async execute(rawInput, ctx) {
    const parsed = leadMarkLostSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await loadLead(em, parsed.id, scope)
    await enforceLeadOptimisticLock(ctx, lead)
    await resolveLostReason(em, lead, parsed.lostReasonId)
    const lostStage = await resolveStage(em, lead.pipelineId, null, 'lost')
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    await withAtomicFlush(em, [
      () => {
        lead.outcome = 'lost'
        lead.lostReasonId = parsed.lostReasonId
        lead.stageId = lostStage.id
        lead.updatedAt = new Date()
      },
      () => appendHistory(em, lead, 'lost', {
        actorUserId,
        message: parsed.note ?? null,
        payload: { lostReasonId: parsed.lostReasonId, stageId: lostStage.id },
      }),
    ], { transaction: true, label: 'customers.leads.mark_lost' })
    await emitLifecycleEvent(ctx, 'customers.lead.lost', lead, { lostReasonId: parsed.lostReasonId })
  },
}

function buildLinkCommand<Input extends { id: string; tenantId: string; organizationId: string }>(
  id: string,
  entryType: CustomerLeadHistoryEntryType,
  event: string,
  validate: (em: EntityManager, lead: CustomerLead, input: Input) => Promise<void>,
  apply: (lead: CustomerLead, input: Input) => void,
): CommandHandler<Input, void> {
  return {
    id,
    async execute(rawInput, ctx) {
      const input = rawInput
      ensureTenantScope(ctx, input.tenantId)
      ensureOrganizationScope(ctx, input.organizationId)
      const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const lead = await loadLead(em, input.id, scope)
      await enforceLeadOptimisticLock(ctx, lead)
      await validate(em, lead, input)
      const actorUserId = normalizeAuthorUserId(null, ctx.auth)
      await withAtomicFlush(em, [
        () => {
          apply(lead, input)
          lead.updatedAt = new Date()
        },
        () => appendHistory(em, lead, entryType, { actorUserId }),
      ], { transaction: true, label: id })
      await emitLifecycleEvent(ctx, event, lead)
    },
  }
}

const linkPersonCommand = buildLinkCommand(
  'customers.leads.link_person',
  'person_linked',
  'customers.lead.person_linked',
  async (em, lead, input: z.infer<typeof leadLinkPersonSchema>) => {
    await loadLinkedPerson(em, input.personId, {
      tenantId: lead.tenantId,
      organizationId: lead.organizationId,
    })
  },
  (lead, input: z.infer<typeof leadLinkPersonSchema>) => {
    lead.linkedPersonId = input.personId
  },
)

const linkCompanyCommand = buildLinkCommand(
  'customers.leads.link_company',
  'company_linked',
  'customers.lead.company_linked',
  async (em, lead, input: z.infer<typeof leadLinkCompanySchema>) => {
    await loadLinkedCompany(em, input.companyId, {
      tenantId: lead.tenantId,
      organizationId: lead.organizationId,
    })
  },
  (lead, input: z.infer<typeof leadLinkCompanySchema>) => {
    lead.linkedCompanyId = input.companyId
  },
)

const linkDealCommand = buildLinkCommand(
  'customers.leads.link_deal',
  'deal_linked',
  'customers.lead.deal_linked',
  async (em, lead, input: z.infer<typeof leadLinkDealSchema>) => {
    await loadLinkedDeal(em, input.dealId, {
      tenantId: lead.tenantId,
      organizationId: lead.organizationId,
    })
  },
  (lead, input: z.infer<typeof leadLinkDealSchema>) => {
    lead.linkedDealId = input.dealId
  },
)

const createPersonForLeadCommand: CommandHandler<z.infer<typeof leadCreatePersonSchema>, { personId: string }> = {
  id: 'customers.leads.create_person',
  async execute(rawInput, ctx) {
    const parsed = leadCreatePersonSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await loadLead(em, parsed.id, scope)
    await enforceLeadOptimisticLock(ctx, lead)
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    let person!: CustomerEntity
    await withAtomicFlush(em, [
      async () => {
        person = await createPersonFromLead(em, lead, parsed.overrides ?? {})
      },
      () => {
        lead.createdPersonId = person.id
        lead.updatedAt = new Date()
      },
      () => appendHistory(em, lead, 'person_created', {
        actorUserId,
        payload: { personId: person.id },
      }),
    ], { transaction: true, label: 'customers.leads.create_person' })
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: person,
      identifiers: { id: person.id, organizationId: lead.organizationId, tenantId: lead.tenantId },
      indexer: personCrudIndexer,
      events: personCrudEvents,
      actorUserId,
    })
    await emitLifecycleEvent(ctx, 'customers.lead.person_created', lead, { personId: person.id })
    return { personId: person.id }
  },
}

const createCompanyForLeadCommand: CommandHandler<z.infer<typeof leadCreateCompanySchema>, { companyId: string }> = {
  id: 'customers.leads.create_company',
  async execute(rawInput, ctx) {
    const parsed = leadCreateCompanySchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await loadLead(em, parsed.id, scope)
    await enforceLeadOptimisticLock(ctx, lead)
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    let company!: CustomerEntity
    await withAtomicFlush(em, [
      async () => {
        company = await createCompanyFromLead(em, lead, parsed.overrides ?? {})
      },
      () => {
        lead.createdCompanyId = company.id
        lead.updatedAt = new Date()
      },
      () => appendHistory(em, lead, 'company_created', {
        actorUserId,
        payload: { companyId: company.id },
      }),
    ], { transaction: true, label: 'customers.leads.create_company' })
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: company,
      identifiers: { id: company.id, organizationId: lead.organizationId, tenantId: lead.tenantId },
      indexer: companyCrudIndexer,
      events: companyCrudEvents,
      actorUserId,
    })
    await emitLifecycleEvent(ctx, 'customers.lead.company_created', lead, { companyId: company.id })
    return { companyId: company.id }
  },
}

const createDealForLeadCommand: CommandHandler<z.infer<typeof leadCreateDealSchema>, { dealId: string }> = {
  id: 'customers.leads.create_deal',
  async execute(rawInput, ctx) {
    const parsed = leadCreateDealSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await loadLead(em, parsed.id, scope)
    await enforceLeadOptimisticLock(ctx, lead)
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    let deal!: CustomerDeal
    await withAtomicFlush(em, [
      async () => {
        const person = await loadLinkedPerson(em, lead.linkedPersonId ?? lead.createdPersonId, scope)
        const company = await loadLinkedCompany(em, lead.linkedCompanyId ?? lead.createdCompanyId, scope)
        deal = await createDealFromLead(em, lead, parsed.overrides ?? {}, person, company)
      },
      () => {
        lead.createdDealId = deal.id
        lead.updatedAt = new Date()
      },
      () => appendHistory(em, lead, 'deal_created', {
        actorUserId,
        payload: { dealId: deal.id },
      }),
    ], { transaction: true, label: 'customers.leads.create_deal' })
    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: deal,
      identifiers: { id: deal.id, organizationId: lead.organizationId, tenantId: lead.tenantId },
      indexer: dealCrudIndexer,
      events: dealCrudEvents,
      actorUserId,
    })
    await emitLifecycleEvent(ctx, 'customers.lead.deal_created', lead, { dealId: deal.id })
    return { dealId: deal.id }
  },
}

const convertLeadCommand: CommandHandler<
  z.infer<typeof leadConvertSchema>,
  { leadId: string; personId: string | null; companyId: string | null; dealId: string | null }
> = {
  id: 'customers.leads.convert',
  async execute(rawInput, ctx) {
    const parsed = leadConvertSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await loadLead(em, parsed.id, scope)
    await enforceLeadOptimisticLock(ctx, lead)
    await ensureLeadUnlocked(lead)
    const actorUserId = normalizeAuthorUserId(null, ctx.auth)
    const wonStage = await resolveStage(em, lead.pipelineId, null, 'won')
    const resolved: {
      person: CustomerEntity | null
      company: CustomerEntity | null
      deal: CustomerDeal | null
      created: CustomerEntity[]
      createdDeal: CustomerDeal | null
    } = { person: null, company: null, deal: null, created: [], createdDeal: null }

    await withAtomicFlush(em, [
      async () => {
        if (parsed.person) {
          if (parsed.person.mode === 'link') {
            resolved.person = await loadLinkedPerson(em, parsed.person.id, scope)
          } else {
            resolved.person = lead.createdPersonId
              ? await loadLinkedPerson(em, lead.createdPersonId, scope)
              : await createPersonFromLead(em, lead, {})
            if (!lead.createdPersonId && resolved.person) {
              resolved.created.push(resolved.person)
            }
          }
        }
        if (parsed.company) {
          if (parsed.company.mode === 'link') {
            resolved.company = await loadLinkedCompany(em, parsed.company.id, scope)
          } else {
            resolved.company = lead.createdCompanyId
              ? await loadLinkedCompany(em, lead.createdCompanyId, scope)
              : await createCompanyFromLead(em, lead, {})
            if (!lead.createdCompanyId && resolved.company) {
              resolved.created.push(resolved.company)
            }
          }
        }
        if (parsed.deal) {
          if (parsed.deal.mode === 'link') {
            resolved.deal = await loadLinkedDeal(em, parsed.deal.id, scope)
          } else {
            resolved.deal = lead.createdDealId
              ? await loadLinkedDeal(em, lead.createdDealId, scope)
              : await createDealFromLead(em, lead, {}, resolved.person, resolved.company)
            if (!lead.createdDealId && resolved.deal) {
              resolved.createdDeal = resolved.deal
            }
          }
        }
      },
      () => {
        if (parsed.person?.mode === 'link') {
          lead.linkedPersonId = resolved.person?.id ?? null
        } else if (resolved.person && !lead.createdPersonId) {
          lead.createdPersonId = resolved.person.id
        }
        if (parsed.company?.mode === 'link') {
          lead.linkedCompanyId = resolved.company?.id ?? null
        } else if (resolved.company && !lead.createdCompanyId) {
          lead.createdCompanyId = resolved.company.id
        }
        if (parsed.deal?.mode === 'link') {
          lead.linkedDealId = resolved.deal?.id ?? null
        } else if (resolved.deal && !lead.createdDealId) {
          lead.createdDealId = resolved.deal.id
        }
        lead.outcome = 'won'
        lead.stageId = wonStage.id
        lead.lostReasonId = null
        lead.convertedAt = new Date()
        lead.convertedByUserId = actorUserId
        lead.conversionLockedAt = new Date()
        lead.updatedAt = new Date()
      },
      () => appendHistory(em, lead, 'converted', {
        actorUserId,
        message: parsed.note ?? null,
        payload: {
          personId: resolved.person?.id ?? null,
          companyId: resolved.company?.id ?? null,
          dealId: resolved.deal?.id ?? null,
          personMode: parsed.person?.mode ?? null,
          companyMode: parsed.company?.mode ?? null,
          dealMode: parsed.deal?.mode ?? null,
        },
      }),
    ], { transaction: true, label: 'customers.leads.convert' })

    const de = ctx.container.resolve('dataEngine') as DataEngine
    for (const entity of resolved.created) {
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'created',
        entity,
        identifiers: { id: entity.id, organizationId: lead.organizationId, tenantId: lead.tenantId },
        indexer: entity.kind === 'person' ? personCrudIndexer : companyCrudIndexer,
        events: entity.kind === 'person' ? personCrudEvents : companyCrudEvents,
        actorUserId,
      })
    }
    if (resolved.createdDeal) {
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'created',
        entity: resolved.createdDeal,
        identifiers: {
          id: resolved.createdDeal.id,
          organizationId: resolved.createdDeal.organizationId,
          tenantId: resolved.createdDeal.tenantId,
        },
        indexer: dealCrudIndexer,
        events: dealCrudEvents,
        actorUserId,
      })
    }
    await emitLifecycleEvent(ctx, 'customers.lead.converted', lead, {
      personId: resolved.person?.id ?? null,
      companyId: resolved.company?.id ?? null,
      dealId: resolved.deal?.id ?? null,
    })
    return {
      leadId: lead.id,
      personId: resolved.person?.id ?? null,
      companyId: resolved.company?.id ?? null,
      dealId: resolved.deal?.id ?? null,
    }
  },
}

// --- Configuration: pipelines, stages, lost reasons ---

const createLeadPipelineCommand: CommandHandler<
  z.infer<typeof leadPipelineCreateSchema>,
  { pipelineId: string }
> = {
  id: 'customers.lead_pipelines.create',
  async execute(rawInput, ctx) {
    const parsed = leadPipelineCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const pipeline = em.create(CustomerLeadPipeline, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code,
      isDefault: parsed.isDefault ?? false,
      isActive: parsed.isActive ?? true,
    })
    await withAtomicFlush(em, [
      async () => {
        if (pipeline.isDefault) {
          await em.nativeUpdate(
            CustomerLeadPipeline,
            { organizationId: parsed.organizationId, tenantId: parsed.tenantId, isDefault: true },
            { isDefault: false },
          )
        }
        em.persist(pipeline)
      },
    ], { transaction: true, label: 'customers.lead_pipelines.create' })
    return { pipelineId: pipeline.id }
  },
}

const updateLeadPipelineCommand: CommandHandler<z.infer<typeof leadPipelineUpdateSchema>, void> = {
  id: 'customers.lead_pipelines.update',
  async execute(rawInput, ctx) {
    const parsed = leadPipelineUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const pipeline = await em.findOne(CustomerLeadPipeline, { id: parsed.id })
    if (!pipeline) throw notFound('Lead pipeline not found')
    ensureTenantScope(ctx, pipeline.tenantId)
    ensureOrganizationScope(ctx, pipeline.organizationId)
    await withAtomicFlush(em, [
      async () => {
        if (parsed.isDefault === true && !pipeline.isDefault) {
          await em.nativeUpdate(
            CustomerLeadPipeline,
            { organizationId: pipeline.organizationId, tenantId: pipeline.tenantId, isDefault: true },
            { isDefault: false },
          )
        }
        if (parsed.name !== undefined) pipeline.name = parsed.name
        if (parsed.code !== undefined) pipeline.code = parsed.code
        if (parsed.isDefault !== undefined) pipeline.isDefault = parsed.isDefault
        if (parsed.isActive !== undefined) pipeline.isActive = parsed.isActive
        pipeline.updatedAt = new Date()
      },
    ], { transaction: true, label: 'customers.lead_pipelines.update' })
  },
}

const deleteLeadPipelineCommand: CommandHandler<z.infer<typeof leadPipelineDeleteSchema>, void> = {
  id: 'customers.lead_pipelines.delete',
  async execute(rawInput, ctx) {
    const parsed = leadPipelineDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const pipeline = await em.findOne(CustomerLeadPipeline, { id: parsed.id })
    if (!pipeline) throw notFound('Lead pipeline not found')
    ensureTenantScope(ctx, pipeline.tenantId)
    ensureOrganizationScope(ctx, pipeline.organizationId)
    const leads = await em.count(CustomerLead, { pipelineId: pipeline.id, deletedAt: null })
    if (leads > 0) {
      throw new CrudHttpError(409, { error: 'Cannot delete a pipeline that still has leads.' })
    }
    await em.nativeDelete(CustomerLeadPipelineStage, { pipelineId: pipeline.id })
    await em.nativeDelete(CustomerLeadLostReason, { pipelineId: pipeline.id })
    em.remove(pipeline)
    await em.flush()
  },
}

const createLeadPipelineStageCommand: CommandHandler<
  z.infer<typeof leadPipelineStageCreateSchema>,
  { stageId: string }
> = {
  id: 'customers.lead_pipeline_stages.create',
  async execute(rawInput, ctx) {
    const parsed = leadPipelineStageCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const pipeline = await em.findOne(CustomerLeadPipeline, {
      id: parsed.pipelineId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!pipeline) throw new CrudHttpError(400, { error: 'Lead pipeline not found.' })
    const stage = em.create(CustomerLeadPipelineStage, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      pipelineId: parsed.pipelineId,
      name: parsed.name,
      code: parsed.code,
      position: parsed.position ?? 0,
      kind: parsed.kind ?? 'open',
      isActive: parsed.isActive ?? true,
    })
    em.persist(stage)
    await em.flush()
    return { stageId: stage.id }
  },
}

const updateLeadPipelineStageCommand: CommandHandler<z.infer<typeof leadPipelineStageUpdateSchema>, void> = {
  id: 'customers.lead_pipeline_stages.update',
  async execute(rawInput, ctx) {
    const parsed = leadPipelineStageUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const stage = await em.findOne(CustomerLeadPipelineStage, { id: parsed.id })
    if (!stage) throw notFound('Lead pipeline stage not found')
    ensureTenantScope(ctx, stage.tenantId)
    ensureOrganizationScope(ctx, stage.organizationId)
    if (parsed.name !== undefined) stage.name = parsed.name
    if (parsed.code !== undefined) stage.code = parsed.code
    if (parsed.position !== undefined) stage.position = parsed.position
    if (parsed.kind !== undefined) stage.kind = parsed.kind
    if (parsed.isActive !== undefined) stage.isActive = parsed.isActive
    stage.updatedAt = new Date()
    await em.flush()
  },
}

const deleteLeadPipelineStageCommand: CommandHandler<z.infer<typeof leadPipelineStageDeleteSchema>, void> = {
  id: 'customers.lead_pipeline_stages.delete',
  async execute(rawInput, ctx) {
    const parsed = leadPipelineStageDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const stage = await em.findOne(CustomerLeadPipelineStage, { id: parsed.id })
    if (!stage) throw notFound('Lead pipeline stage not found')
    ensureTenantScope(ctx, stage.tenantId)
    ensureOrganizationScope(ctx, stage.organizationId)
    const leads = await em.count(CustomerLead, { stageId: stage.id, deletedAt: null })
    if (leads > 0) {
      throw new CrudHttpError(409, { error: 'Cannot delete a stage that still has leads.' })
    }
    em.remove(stage)
    await em.flush()
  },
}

const createLeadLostReasonCommand: CommandHandler<
  z.infer<typeof leadLostReasonCreateSchema>,
  { lostReasonId: string }
> = {
  id: 'customers.lead_lost_reasons.create',
  async execute(rawInput, ctx) {
    const parsed = leadLostReasonCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const reason = em.create(CustomerLeadLostReason, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      pipelineId: parsed.pipelineId ?? null,
      name: parsed.name,
      code: parsed.code,
      isActive: parsed.isActive ?? true,
      sortOrder: parsed.sortOrder ?? 0,
    })
    em.persist(reason)
    await em.flush()
    return { lostReasonId: reason.id }
  },
}

const updateLeadLostReasonCommand: CommandHandler<z.infer<typeof leadLostReasonUpdateSchema>, void> = {
  id: 'customers.lead_lost_reasons.update',
  async execute(rawInput, ctx) {
    const parsed = leadLostReasonUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const reason = await em.findOne(CustomerLeadLostReason, { id: parsed.id })
    if (!reason) throw notFound('Lead lost reason not found')
    ensureTenantScope(ctx, reason.tenantId)
    ensureOrganizationScope(ctx, reason.organizationId)
    if (parsed.pipelineId !== undefined) reason.pipelineId = parsed.pipelineId ?? null
    if (parsed.name !== undefined) reason.name = parsed.name
    if (parsed.code !== undefined) reason.code = parsed.code
    if (parsed.isActive !== undefined) reason.isActive = parsed.isActive
    if (parsed.sortOrder !== undefined) reason.sortOrder = parsed.sortOrder
    reason.updatedAt = new Date()
    await em.flush()
  },
}

const deleteLeadLostReasonCommand: CommandHandler<z.infer<typeof leadLostReasonDeleteSchema>, void> = {
  id: 'customers.lead_lost_reasons.delete',
  async execute(rawInput, ctx) {
    const parsed = leadLostReasonDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const reason = await em.findOne(CustomerLeadLostReason, { id: parsed.id })
    if (!reason) throw notFound('Lead lost reason not found')
    ensureTenantScope(ctx, reason.tenantId)
    ensureOrganizationScope(ctx, reason.organizationId)
    em.remove(reason)
    await em.flush()
  },
}

export {
  advanceLeadStageCommand,
  assignLeadCommand,
  convertLeadCommand,
  createCompanyForLeadCommand,
  createDealForLeadCommand,
  createLeadCommand,
  createLeadLostReasonCommand,
  createLeadPipelineCommand,
  createLeadPipelineStageCommand,
  createPersonForLeadCommand,
  deleteLeadCommand,
  deleteLeadLostReasonCommand,
  deleteLeadPipelineCommand,
  deleteLeadPipelineStageCommand,
  linkCompanyCommand,
  linkDealCommand,
  linkPersonCommand,
  markLeadLostCommand,
  updateLeadCommand,
  updateLeadLostReasonCommand,
  updateLeadPipelineCommand,
  updateLeadPipelineStageCommand,
}

registerCommand(createLeadCommand)
registerCommand(updateLeadCommand)
registerCommand(deleteLeadCommand)
registerCommand(assignLeadCommand)
registerCommand(advanceLeadStageCommand)
registerCommand(markLeadLostCommand)
registerCommand(linkPersonCommand)
registerCommand(linkCompanyCommand)
registerCommand(linkDealCommand)
registerCommand(createPersonForLeadCommand)
registerCommand(createCompanyForLeadCommand)
registerCommand(createDealForLeadCommand)
registerCommand(convertLeadCommand)
registerCommand(createLeadPipelineCommand)
registerCommand(updateLeadPipelineCommand)
registerCommand(deleteLeadPipelineCommand)
registerCommand(createLeadPipelineStageCommand)
registerCommand(updateLeadPipelineStageCommand)
registerCommand(deleteLeadPipelineStageCommand)
registerCommand(createLeadLostReasonCommand)
registerCommand(updateLeadLostReasonCommand)
registerCommand(deleteLeadLostReasonCommand)
