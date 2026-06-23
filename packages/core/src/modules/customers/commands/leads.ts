import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerLead,
  CustomerEntity,
  CustomerPersonProfile,
  CustomerCompanyProfile,
  CustomerDeal,
  CustomerDealPersonLink,
  CustomerDealCompanyLink,
  type CustomerLeadStatus,
} from '../data/entities'
import {
  leadCreateSchema,
  leadUpdateSchema,
  leadConvertSchema,
  type LeadCreateInput,
  type LeadUpdateInput,
  type LeadConvertInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  ensureSameScope,
  extractUndoPayload,
  assertFound,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const LEAD_ENTITY_ID = 'customers:customer_lead'

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

type LeadSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  title: string | null
  description: string | null
  status: CustomerLeadStatus
  source: string | null
  estimatedValueAmount: string | null
  estimatedValueCurrency: string | null
  companyName: string | null
  companyVatId: string | null
  contactFirstName: string | null
  contactLastName: string | null
  contactPhone: string | null
  contactEmail: string | null
  createdDealId: string | null
  createdPersonEntityId: string | null
  createdCompanyEntityId: string | null
  convertedAt: Date | null
  convertedByUserId: string | null
}

type LeadUndoPayload = {
  before?: LeadSnapshot | null
  after?: LeadSnapshot | null
}

function toNumericString(value: number | string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return String(value)
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function serializeLeadSnapshot(lead: CustomerLead): LeadSnapshot {
  return {
    id: lead.id,
    organizationId: lead.organizationId,
    tenantId: lead.tenantId,
    title: lead.title ?? null,
    description: lead.description ?? null,
    status: lead.status,
    source: lead.source ?? null,
    estimatedValueAmount: lead.estimatedValueAmount ?? null,
    estimatedValueCurrency: lead.estimatedValueCurrency ?? null,
    companyName: lead.companyName ?? null,
    companyVatId: lead.companyVatId ?? null,
    contactFirstName: lead.contactFirstName ?? null,
    contactLastName: lead.contactLastName ?? null,
    contactPhone: lead.contactPhone ?? null,
    contactEmail: lead.contactEmail ?? null,
    createdDealId: lead.createdDealId ?? null,
    createdPersonEntityId: lead.createdPersonEntityId ?? null,
    createdCompanyEntityId: lead.createdCompanyEntityId ?? null,
    convertedAt: lead.convertedAt ?? null,
    convertedByUserId: lead.convertedByUserId ?? null,
  }
}

async function loadLeadSnapshot(em: EntityManager, id: string): Promise<LeadSnapshot | null> {
  const lead = await findOneWithDecryption(
    em,
    CustomerLead,
    { id, deletedAt: null },
    undefined,
    undefined,
  )
  if (!lead) return null
  return serializeLeadSnapshot(lead)
}

function applyLeadBaseFields(lead: CustomerLead, parsed: Partial<LeadCreateInput>): void {
  if (parsed.title !== undefined) lead.title = parsed.title
  if (parsed.description !== undefined) lead.description = normalizeOptionalString(parsed.description)
  if (parsed.source !== undefined) lead.source = normalizeOptionalString(parsed.source)
  if (parsed.estimatedValueAmount !== undefined) lead.estimatedValueAmount = toNumericString(parsed.estimatedValueAmount)
  if (parsed.estimatedValueCurrency !== undefined) lead.estimatedValueCurrency = normalizeOptionalString(parsed.estimatedValueCurrency)
  if (parsed.companyName !== undefined) lead.companyName = normalizeOptionalString(parsed.companyName)
  if (parsed.companyVatId !== undefined) lead.companyVatId = normalizeOptionalString(parsed.companyVatId)
  if (parsed.contactFirstName !== undefined) lead.contactFirstName = normalizeOptionalString(parsed.contactFirstName)
  if (parsed.contactLastName !== undefined) lead.contactLastName = normalizeOptionalString(parsed.contactLastName)
  if (parsed.contactPhone !== undefined) lead.contactPhone = normalizeOptionalString(parsed.contactPhone)
  if (parsed.contactEmail !== undefined) lead.contactEmail = normalizeOptionalString(parsed.contactEmail)
}

async function resolveLead(
  em: EntityManager,
  id: string,
  tenantId: string,
  organizationId: string
): Promise<CustomerLead> {
  const lead = await findOneWithDecryption(
    em,
    CustomerLead,
    { id, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!lead) throw new CrudHttpError(404, { error: 'Lead not found' })
  ensureSameScope(lead, organizationId, tenantId)
  return lead
}

const createLeadCommand: CommandHandler<LeadCreateInput, { leadId: string }> = {
  id: 'customers.leads.create',
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(leadCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = em.create(CustomerLead, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      title: parsed.title,
      description: normalizeOptionalString(parsed.description),
      status: parsed.status ?? 'open',
      source: normalizeOptionalString(parsed.source),
      estimatedValueAmount: toNumericString(parsed.estimatedValueAmount),
      estimatedValueCurrency: normalizeOptionalString(parsed.estimatedValueCurrency),
      companyName: normalizeOptionalString(parsed.companyName),
      companyVatId: normalizeOptionalString(parsed.companyVatId),
      contactFirstName: normalizeOptionalString(parsed.contactFirstName),
      contactLastName: normalizeOptionalString(parsed.contactLastName),
      contactPhone: normalizeOptionalString(parsed.contactPhone),
      contactEmail: normalizeOptionalString(parsed.contactEmail),
    })
    em.persist(lead)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: lead,
      identifiers: {
        id: lead.id,
        organizationId: lead.organizationId,
        tenantId: lead.tenantId,
      },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
    })

    return { leadId: lead.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadLeadSnapshot(em, result.leadId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as LeadSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.leads.create', 'Create lead'),
      resourceKind: 'customers.lead',
      resourceId: result.leadId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        } satisfies LeadUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const leadId = logEntry?.resourceId
    if (!leadId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await em.findOne(CustomerLead, { id: leadId })
    if (!lead) return
    em.remove(lead)
    await em.flush()
  },
}

const updateLeadCommand: CommandHandler<LeadUpdateInput, { leadId: string }> = {
  id: 'customers.leads.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(leadUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadLeadSnapshot(em, parsed.id!)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(leadUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await resolveLead(em, parsed.id!, parsed.tenantId!, parsed.organizationId!)
    ensureTenantScope(ctx, lead.tenantId)
    ensureOrganizationScope(ctx, lead.organizationId)

    if (lead.status === 'qualified') {
      throw new CrudHttpError(409, { error: 'Converted leads cannot be updated' })
    }

    applyLeadBaseFields(lead, parsed)
    if (parsed.status !== undefined) {
      lead.status = parsed.status as CustomerLeadStatus
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: lead,
      identifiers: {
        id: lead.id,
        organizationId: lead.organizationId,
        tenantId: lead.tenantId,
      },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
    })

    return { leadId: lead.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadLeadSnapshot(em, result.leadId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as LeadSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as LeadSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.leads.update', 'Update lead'),
      resourceKind: 'customers.lead',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies LeadUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LeadUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let lead = await em.findOne(CustomerLead, { id: before.id })
    if (!lead) {
      lead = em.create(CustomerLead, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        title: before.title ?? '',
        description: before.description,
        status: before.status,
        source: before.source,
        estimatedValueAmount: before.estimatedValueAmount,
        estimatedValueCurrency: before.estimatedValueCurrency,
        companyName: before.companyName,
        companyVatId: before.companyVatId,
        contactFirstName: before.contactFirstName,
        contactLastName: before.contactLastName,
        contactPhone: before.contactPhone,
        contactEmail: before.contactEmail,
        createdDealId: before.createdDealId,
        createdPersonEntityId: before.createdPersonEntityId,
        createdCompanyEntityId: before.createdCompanyEntityId,
        convertedAt: before.convertedAt,
        convertedByUserId: before.convertedByUserId,
      })
      em.persist(lead)
    } else {
      lead.title = before.title ?? lead.title
      lead.description = before.description
      lead.status = before.status
      lead.source = before.source
      lead.estimatedValueAmount = before.estimatedValueAmount
      lead.estimatedValueCurrency = before.estimatedValueCurrency
      lead.companyName = before.companyName
      lead.companyVatId = before.companyVatId
      lead.contactFirstName = before.contactFirstName
      lead.contactLastName = before.contactLastName
      lead.contactPhone = before.contactPhone
      lead.contactEmail = before.contactEmail
      lead.createdDealId = before.createdDealId
      lead.createdPersonEntityId = before.createdPersonEntityId
      lead.createdCompanyEntityId = before.createdCompanyEntityId
      lead.convertedAt = before.convertedAt
      lead.convertedByUserId = before.convertedByUserId
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: lead,
      identifiers: {
        id: lead.id,
        organizationId: lead.organizationId,
        tenantId: lead.tenantId,
      },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
    })
  },
}

const updateLeadStatusCommand: CommandHandler<{ id: string; tenantId: string; organizationId: string; status: string }, { leadId: string }> = {
  id: 'customers.leads.update_status',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(
      leadUpdateSchema.pick({ id: true, tenantId: true, organizationId: true }).extend({ status: leadUpdateSchema.shape.status }),
      rawInput,
    )
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadLeadSnapshot(em, parsed.id!)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(
      leadUpdateSchema.pick({ id: true, tenantId: true, organizationId: true }).extend({ status: leadUpdateSchema.shape.status }),
      rawInput,
    )
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await resolveLead(em, parsed.id!, parsed.tenantId!, parsed.organizationId!)
    ensureTenantScope(ctx, lead.tenantId)
    ensureOrganizationScope(ctx, lead.organizationId)

    if (lead.status === 'qualified') {
      throw new CrudHttpError(409, { error: 'Converted leads cannot be updated' })
    }

    if (parsed.status !== undefined) {
      lead.status = parsed.status as CustomerLeadStatus
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: lead,
      identifiers: {
        id: lead.id,
        organizationId: lead.organizationId,
        tenantId: lead.tenantId,
      },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
    })

    return { leadId: lead.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadLeadSnapshot(em, result.leadId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as LeadSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as LeadSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.leads.status_changed', 'Change lead status'),
      resourceKind: 'customers.lead',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies LeadUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LeadUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await em.findOne(CustomerLead, { id: before.id })
    if (!lead) return
    lead.status = before.status
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: lead,
      identifiers: {
        id: lead.id,
        organizationId: lead.organizationId,
        tenantId: lead.tenantId,
      },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
    })
  },
}

const deleteLeadCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { leadId: string }> = {
  id: 'customers.leads.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Lead id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadLeadSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Lead id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await em.findOne(CustomerLead, { id, deletedAt: null })
    const record = lead ?? null
    if (!record) throw new CrudHttpError(404, { error: 'Lead not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
    })
    return { leadId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as LeadSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.audit.leads.delete', 'Delete lead'),
      resourceKind: 'customers.lead',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies LeadUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LeadUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let lead = await em.findOne(CustomerLead, { id: before.id })
    if (!lead) {
      lead = em.create(CustomerLead, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        title: before.title ?? '',
        description: before.description,
        status: before.status,
        source: before.source,
        estimatedValueAmount: before.estimatedValueAmount,
        estimatedValueCurrency: before.estimatedValueCurrency,
        companyName: before.companyName,
        companyVatId: before.companyVatId,
        contactFirstName: before.contactFirstName,
        contactLastName: before.contactLastName,
        contactPhone: before.contactPhone,
        contactEmail: before.contactEmail,
        createdDealId: before.createdDealId,
        createdPersonEntityId: before.createdPersonEntityId,
        createdCompanyEntityId: before.createdCompanyEntityId,
        convertedAt: before.convertedAt,
        convertedByUserId: before.convertedByUserId,
      })
      em.persist(lead)
      await em.flush()
    }

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: lead,
      identifiers: {
        id: lead.id,
        organizationId: lead.organizationId,
        tenantId: lead.tenantId,
      },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
    })
  },
}

type ConvertResult = {
  leadId: string
  createdDealId?: string
  createdPersonEntityId?: string
  createdCompanyEntityId?: string
}

async function runInTransaction<TResult>(
  em: EntityManager,
  operation: (trx: EntityManager) => Promise<TResult>,
): Promise<TResult> {
  const transactionalEm = em as EntityManager & {
    transactional?: (callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
  }
  if (typeof transactionalEm.transactional === 'function') {
    return transactionalEm.transactional((trx) => operation(trx))
  }
  return operation(em)
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value)
  return normalized ? normalized.toLowerCase() : null
}

const convertLeadCommand: CommandHandler<LeadConvertInput, ConvertResult> = {
  id: 'customers.leads.convert',
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(leadConvertSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const lead = await resolveLead(em, parsed.id, parsed.tenantId, parsed.organizationId)

    if (lead.status === 'qualified') {
      throw new CrudHttpError(409, { error: 'Lead is already converted' })
    }
    if (!parsed.createDeal && !parsed.createPerson && !parsed.createCompany) {
      throw new CrudHttpError(400, { error: 'At least one conversion target must be selected' })
    }

    const convertedByUserId = ctx.auth && 'sub' in ctx.auth && typeof ctx.auth.sub === 'string' ? ctx.auth.sub : null
    const now = new Date()

    const result = await runInTransaction(em, async (trx) => {
      let createdDealId: string | undefined
      let createdPersonEntityId: string | undefined
      let createdCompanyEntityId: string | undefined

      if (parsed.createCompany) {
        const companyName = normalizeOptionalString(lead.companyName)
        if (!companyName) {
          throw new CrudHttpError(400, { error: 'Company name is required for conversion' })
        }
        const entity = trx.create(CustomerEntity, {
          organizationId: lead.organizationId,
          tenantId: lead.tenantId,
          kind: 'company',
          displayName: companyName,
          description: null,
          ownerUserId: null,
          primaryEmail: null,
          primaryPhone: null,
          status: null,
          lifecycleStage: null,
          source: normalizeOptionalString(lead.source),
          nextInteractionAt: null,
          nextInteractionName: null,
          nextInteractionRefId: null,
          nextInteractionIcon: null,
          nextInteractionColor: null,
          isActive: true,
        })
        const profile = trx.create(CustomerCompanyProfile, {
          organizationId: lead.organizationId,
          tenantId: lead.tenantId,
          entity,
          legalName: companyName,
          brandName: null,
          domain: null,
          websiteUrl: null,
          industry: null,
          sizeBucket: null,
          annualRevenue: null,
        })
        trx.persist(entity)
        trx.persist(profile)
        await trx.flush()
        createdCompanyEntityId = entity.id
      }

      if (parsed.createPerson) {
        const firstName = normalizeOptionalString(lead.contactFirstName)
        const lastName = normalizeOptionalString(lead.contactLastName)
        if (!firstName || !lastName) {
          throw new CrudHttpError(400, { error: 'Contact first and last name are required for conversion' })
        }
        const displayName = `${firstName} ${lastName}`.trim()
        const company = createdCompanyEntityId
          ? await trx.findOne(CustomerEntity, { id: createdCompanyEntityId })
          : null
        const entity = trx.create(CustomerEntity, {
          organizationId: lead.organizationId,
          tenantId: lead.tenantId,
          kind: 'person',
          displayName,
          description: null,
          ownerUserId: null,
          primaryEmail: normalizeEmail(lead.contactEmail),
          primaryPhone: normalizeOptionalString(lead.contactPhone),
          status: null,
          lifecycleStage: null,
          source: normalizeOptionalString(lead.source),
          nextInteractionAt: null,
          nextInteractionName: null,
          nextInteractionRefId: null,
          nextInteractionIcon: null,
          nextInteractionColor: null,
          isActive: true,
        })
        const profile = trx.create(CustomerPersonProfile, {
          organizationId: lead.organizationId,
          tenantId: lead.tenantId,
          entity,
          firstName,
          lastName,
          preferredName: null,
          jobTitle: null,
          department: null,
          seniority: null,
          timezone: null,
          linkedInUrl: null,
          twitterUrl: null,
          company: company ?? null,
        })
        trx.persist(entity)
        trx.persist(profile)
        await trx.flush()
        createdPersonEntityId = entity.id
      }

      if (parsed.createDeal) {
        const dealTitle = normalizeOptionalString(parsed.deal?.title) ?? lead.title
        const deal = trx.create(CustomerDeal, {
          organizationId: lead.organizationId,
          tenantId: lead.tenantId,
          title: dealTitle,
          description: lead.description ?? null,
          status: 'open',
          pipelineStage: null,
          pipelineId: parsed.deal?.pipelineId ?? null,
          pipelineStageId: parsed.deal?.pipelineStageId ?? null,
          valueAmount: toNumericString(parsed.deal?.valueAmount ?? lead.estimatedValueAmount),
          valueCurrency: normalizeOptionalString(parsed.deal?.valueCurrency ?? lead.estimatedValueCurrency),
          probability: null,
          expectedCloseAt: null,
          ownerUserId: null,
          source: normalizeOptionalString(lead.source),
        })
        trx.persist(deal)
        await trx.flush()
        createdDealId = deal.id

        if (createdPersonEntityId) {
          const person = await trx.findOne(CustomerEntity, { id: createdPersonEntityId })
          if (person) {
            const link = trx.create(CustomerDealPersonLink, {
              deal,
              person,
            })
            trx.persist(link)
          }
        }
        if (createdCompanyEntityId) {
          const company = await trx.findOne(CustomerEntity, { id: createdCompanyEntityId })
          if (company) {
            const link = trx.create(CustomerDealCompanyLink, {
              deal,
              company,
            })
            trx.persist(link)
          }
        }
        if (createdPersonEntityId || createdCompanyEntityId) {
          await trx.flush()
        }
      }

      lead.status = 'qualified'
      lead.convertedAt = now
      lead.convertedByUserId = convertedByUserId
      lead.createdDealId = createdDealId ?? null
      lead.createdPersonEntityId = createdPersonEntityId ?? null
      lead.createdCompanyEntityId = createdCompanyEntityId ?? null
      await trx.flush()

      return {
        leadId: lead.id,
        createdDealId,
        createdPersonEntityId,
        createdCompanyEntityId,
      }
    })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)

    if (result.createdCompanyEntityId) {
      const companyEntity = await em.findOne(CustomerEntity, { id: result.createdCompanyEntityId })
      if (companyEntity) {
        await emitCrudSideEffects({
          dataEngine: de,
          action: 'created',
          entity: companyEntity,
          identifiers: {
            id: companyEntity.id,
            organizationId: companyEntity.organizationId,
            tenantId: companyEntity.tenantId,
          },
          indexer: { entityType: E.customers.customer_company_profile },
          events: {
            module: 'customers',
            entity: 'company',
            persistent: true,
            buildPayload: (eventCtx) => ({
              id: eventCtx.identifiers.id,
              organizationId: eventCtx.identifiers.organizationId,
              tenantId: eventCtx.identifiers.tenantId,
            }),
          },
        })
      }
    }

    if (result.createdPersonEntityId) {
      const personEntity = await em.findOne(CustomerEntity, { id: result.createdPersonEntityId })
      if (personEntity) {
        await emitCrudSideEffects({
          dataEngine: de,
          action: 'created',
          entity: personEntity,
          identifiers: {
            id: personEntity.id,
            organizationId: personEntity.organizationId,
            tenantId: personEntity.tenantId,
          },
          indexer: { entityType: E.customers.customer_person_profile },
          events: {
            module: 'customers',
            entity: 'person',
            persistent: true,
            buildPayload: (eventCtx) => ({
              id: eventCtx.identifiers.id,
              organizationId: eventCtx.identifiers.organizationId,
              tenantId: eventCtx.identifiers.tenantId,
            }),
          },
        })
      }
    }

    if (result.createdDealId) {
      const deal = await em.findOne(CustomerDeal, { id: result.createdDealId })
      if (deal) {
        await emitCrudSideEffects({
          dataEngine: de,
          action: 'created',
          entity: deal,
          identifiers: {
            id: deal.id,
            organizationId: deal.organizationId,
            tenantId: deal.tenantId,
          },
          indexer: { entityType: E.customers.customer_deal },
          events: {
            module: 'customers',
            entity: 'deal',
            persistent: true,
            buildPayload: (eventCtx) => ({
              id: eventCtx.identifiers.id,
              organizationId: eventCtx.identifiers.organizationId,
              tenantId: eventCtx.identifiers.tenantId,
            }),
          },
        })
      }
    }

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: lead,
      identifiers: {
        id: lead.id,
        organizationId: lead.organizationId,
        tenantId: lead.tenantId,
      },
      indexer: leadCrudIndexer,
      events: leadCrudEvents,
    })

    return result
  },
  buildLog: async ({ input, result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.audit.leads.convert', 'Convert lead'),
      resourceKind: 'customers.lead',
      resourceId: result.leadId,
      tenantId: input.tenantId ?? null,
      organizationId: input.organizationId ?? null,
      payload: {
        createdDealId: result.createdDealId ?? null,
        createdPersonEntityId: result.createdPersonEntityId ?? null,
        createdCompanyEntityId: result.createdCompanyEntityId ?? null,
      },
    }
  },
}

registerCommand(createLeadCommand)
registerCommand(updateLeadCommand)
registerCommand(updateLeadStatusCommand)
registerCommand(deleteLeadCommand)
registerCommand(convertLeadCommand)
