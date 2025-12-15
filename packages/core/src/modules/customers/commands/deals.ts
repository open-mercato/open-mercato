import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerDealPersonLink, CustomerDealCompanyLink } from '../data/entities'
import {
  dealCreateSchema,
  dealUpdateSchema,
  type DealCreateInput,
  type DealUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireCustomerEntity,
  ensureSameScope,
  extractUndoPayload,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  loadCustomFieldSnapshot,
  diffCustomFieldChanges,
  buildCustomFieldResetMap,
  type CustomFieldChangeSet,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

const DEAL_ENTITY_ID = 'customers:customer_deal'
const dealCrudIndexer: CrudIndexerConfig<CustomerDeal> = {
  entityType: E.customers.customer_deal,
}

type DealSnapshot = {
  deal: {
    id: string
    organizationId: string
    tenantId: string
    title: string
    description: string | null
    status: string
    pipelineStage: string | null
    valueAmount: string | null
    valueCurrency: string | null
    probability: number | null
    expectedCloseAt: Date | null
    ownerUserId: string | null
    source: string | null
  }
  people: string[]
  companies: string[]
  custom?: Record<string, unknown>
}

type DealUndoPayload = {
  before?: DealSnapshot | null
  after?: DealSnapshot | null
}

type DealChangeMap = Record<string, { from: unknown; to: unknown }> & {
  custom?: CustomFieldChangeSet
}

async function loadDealSnapshot(em: EntityManager, id: string): Promise<DealSnapshot | null> {
  const deal = await em.findOne(CustomerDeal, { id, deletedAt: null })
  if (!deal) return null
  const peopleLinks = await em.find(CustomerDealPersonLink, { deal: deal }, { populate: ['person'] })
  const companyLinks = await em.find(CustomerDealCompanyLink, { deal: deal }, { populate: ['company'] })
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: DEAL_ENTITY_ID,
    recordId: deal.id,
    tenantId: deal.tenantId,
    organizationId: deal.organizationId,
  })
  return {
    deal: {
      id: deal.id,
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
      title: deal.title,
      description: deal.description ?? null,
      status: deal.status,
      pipelineStage: deal.pipelineStage ?? null,
      valueAmount: deal.valueAmount ?? null,
      valueCurrency: deal.valueCurrency ?? null,
      probability: deal.probability ?? null,
      expectedCloseAt: deal.expectedCloseAt ?? null,
      ownerUserId: deal.ownerUserId ?? null,
      source: deal.source ?? null,
    },
    people: peopleLinks.map((link) =>
      typeof link.person === 'string' ? link.person : link.person.id
    ),
    companies: companyLinks.map((link) =>
      typeof link.company === 'string' ? link.company : link.company.id
    ),
    custom,
  }
}

function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

async function syncDealPeople(
  em: EntityManager,
  deal: CustomerDeal,
  personIds: string[] | undefined | null
): Promise<void> {
  if (personIds === undefined) return
  await em.nativeDelete(CustomerDealPersonLink, { deal })
  if (!personIds || !personIds.length) return
  const unique = Array.from(new Set(personIds))
  for (const personId of unique) {
    const person = await requireCustomerEntity(em, personId, 'person', 'Person not found')
    ensureSameScope(person, deal.organizationId, deal.tenantId)
    const link = em.create(CustomerDealPersonLink, {
      deal,
      person,
    })
    em.persist(link)
  }
}

async function syncDealCompanies(
  em: EntityManager,
  deal: CustomerDeal,
  companyIds: string[] | undefined | null
): Promise<void> {
  if (companyIds === undefined) return
  await em.nativeDelete(CustomerDealCompanyLink, { deal })
  if (!companyIds || !companyIds.length) return
  const unique = Array.from(new Set(companyIds))
  for (const companyId of unique) {
    const company = await requireCustomerEntity(em, companyId, 'company', 'Company not found')
    ensureSameScope(company, deal.organizationId, deal.tenantId)
    const link = em.create(CustomerDealCompanyLink, {
      deal,
      company,
    })
    em.persist(link)
  }
}

function arraysEqual(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, idx) => value === sortedB[idx])
}

const createDealCommand: CommandHandler<DealCreateInput, { dealId: string }> = {
  id: 'customers.deals.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(dealCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const deal = em.create(CustomerDeal, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      title: parsed.title,
      description: parsed.description ?? null,
      status: parsed.status ?? 'open',
      pipelineStage: parsed.pipelineStage ?? null,
      valueAmount: toNumericString(parsed.valueAmount),
      valueCurrency: parsed.valueCurrency ?? null,
      probability: parsed.probability ?? null,
      expectedCloseAt: parsed.expectedCloseAt ?? null,
      ownerUserId: parsed.ownerUserId ?? null,
      source: parsed.source ?? null,
    })
    em.persist(deal)
    await em.flush()

    await syncDealPeople(em, deal, parsed.personIds ?? [])
    await syncDealCompanies(em, deal, parsed.companyIds ?? [])
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: DEAL_ENTITY_ID,
      recordId: deal.id,
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
      values: custom,
      notify: false,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: deal,
      identifiers: {
        id: deal.id,
        organizationId: deal.organizationId,
        tenantId: deal.tenantId,
      },
      indexer: dealCrudIndexer,
    })

    return { dealId: deal.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return await loadDealSnapshot(em, result.dealId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadDealSnapshot(em, result.dealId)
    return {
      actionLabel: translate('customers.audit.deals.create', 'Create deal'),
      resourceKind: 'customers.deal',
      resourceId: result.dealId,
      tenantId: snapshot?.deal.tenantId ?? null,
      organizationId: snapshot?.deal.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        } satisfies DealUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const dealId = logEntry?.resourceId
    if (!dealId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const deal = await em.findOne(CustomerDeal, { id: dealId })
    if (!deal) return
    await em.nativeDelete(CustomerDealPersonLink, { deal })
    await em.nativeDelete(CustomerDealCompanyLink, { deal })
    em.remove(deal)
    await em.flush()
  },
}

const updateDealCommand: CommandHandler<DealUpdateInput, { dealId: string }> = {
  id: 'customers.deals.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(dealUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadDealSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(dealUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const deal = await em.findOne(CustomerDeal, { id: parsed.id, deletedAt: null })
    const record = deal ?? null
    if (!record) throw new CrudHttpError(404, { error: 'Deal not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.title !== undefined) record.title = parsed.title
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.status !== undefined) record.status = parsed.status ?? record.status
    if (parsed.pipelineStage !== undefined) record.pipelineStage = parsed.pipelineStage ?? null
    if (parsed.valueAmount !== undefined) record.valueAmount = toNumericString(parsed.valueAmount)
    if (parsed.valueCurrency !== undefined) record.valueCurrency = parsed.valueCurrency ?? null
    if (parsed.probability !== undefined) record.probability = parsed.probability ?? null
    if (parsed.expectedCloseAt !== undefined) record.expectedCloseAt = parsed.expectedCloseAt ?? null
    if (parsed.ownerUserId !== undefined) record.ownerUserId = parsed.ownerUserId ?? null
    if (parsed.source !== undefined) record.source = parsed.source ?? null

    await syncDealPeople(em, record, parsed.personIds)
    await syncDealCompanies(em, record, parsed.companyIds)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: DEAL_ENTITY_ID,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
      notify: false,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: dealCrudIndexer,
    })

    return { dealId: record.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as DealSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const afterSnapshot = await loadDealSnapshot(em, before.deal.id)
    const changeKeys: readonly string[] = [
      'title',
      'description',
      'status',
      'pipelineStage',
      'valueAmount',
      'valueCurrency',
      'probability',
      'expectedCloseAt',
      'ownerUserId',
      'source',
    ]
    const coreChanges: DealChangeMap =
      afterSnapshot && afterSnapshot.deal
        ? buildChanges(
            before.deal as Record<string, unknown>,
            afterSnapshot.deal as Record<string, unknown>,
            changeKeys
          )
        : {}
    const changes: DealChangeMap = { ...coreChanges }
    if (!arraysEqual(before.people, afterSnapshot?.people)) {
      changes.people = { from: before.people, to: afterSnapshot?.people ?? [] }
    }
    if (!arraysEqual(before.companies, afterSnapshot?.companies)) {
      changes.companies = { from: before.companies, to: afterSnapshot?.companies ?? [] }
    }
    const customChanges = diffCustomFieldChanges(before.custom, afterSnapshot?.custom)
    if (Object.keys(customChanges).length) {
      changes.custom = customChanges
    }
    return {
      actionLabel: translate('customers.audit.deals.update', 'Update deal'),
      resourceKind: 'customers.deal',
      resourceId: before.deal.id,
      tenantId: before.deal.tenantId,
      organizationId: before.deal.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies DealUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DealUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let deal = await em.findOne(CustomerDeal, { id: before.deal.id })
    if (!deal) {
      deal = em.create(CustomerDeal, {
        id: before.deal.id,
        organizationId: before.deal.organizationId,
        tenantId: before.deal.tenantId,
        title: before.deal.title,
        description: before.deal.description,
        status: before.deal.status,
        pipelineStage: before.deal.pipelineStage,
        valueAmount: before.deal.valueAmount,
        valueCurrency: before.deal.valueCurrency,
        probability: before.deal.probability,
        expectedCloseAt: before.deal.expectedCloseAt,
        ownerUserId: before.deal.ownerUserId,
        source: before.deal.source,
      })
      em.persist(deal)
    } else {
      deal.title = before.deal.title
      deal.description = before.deal.description
      deal.status = before.deal.status
      deal.pipelineStage = before.deal.pipelineStage
      deal.valueAmount = before.deal.valueAmount
      deal.valueCurrency = before.deal.valueCurrency
      deal.probability = before.deal.probability
      deal.expectedCloseAt = before.deal.expectedCloseAt
      deal.ownerUserId = before.deal.ownerUserId
      deal.source = before.deal.source
    }
    await em.flush()
    await syncDealPeople(em, deal, before.people)
    await syncDealCompanies(em, deal, before.companies)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: deal,
      identifiers: {
        id: deal.id,
        organizationId: deal.organizationId,
        tenantId: deal.tenantId,
      },
      indexer: dealCrudIndexer,
    })

    const resetValues = buildCustomFieldResetMap(before.custom, payload?.after?.custom)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: DEAL_ENTITY_ID,
        recordId: deal.id,
        organizationId: deal.organizationId,
        tenantId: deal.tenantId,
        values: resetValues,
        notify: false,
      })
    }
  },
}

const deleteDealCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { dealId: string }> =
  {
    id: 'customers.deals.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Deal id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadDealSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Deal id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const deal = await em.findOne(CustomerDeal, { id, deletedAt: null })
      const record = deal ?? null
      if (!record) throw new CrudHttpError(404, { error: 'Deal not found' })
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      await em.nativeDelete(CustomerDealPersonLink, { deal: record })
      await em.nativeDelete(CustomerDealCompanyLink, { deal: record })
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
        indexer: dealCrudIndexer,
      })
      return { dealId: record.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as DealSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.deals.delete', 'Delete deal'),
        resourceKind: 'customers.deal',
        resourceId: before.deal.id,
        tenantId: before.deal.tenantId,
        organizationId: before.deal.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies DealUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<DealUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      let deal = await em.findOne(CustomerDeal, { id: before.deal.id })
      if (!deal) {
        deal = em.create(CustomerDeal, {
          id: before.deal.id,
          organizationId: before.deal.organizationId,
          tenantId: before.deal.tenantId,
          title: before.deal.title,
          description: before.deal.description,
          status: before.deal.status,
          pipelineStage: before.deal.pipelineStage,
          valueAmount: before.deal.valueAmount,
          valueCurrency: before.deal.valueCurrency,
          probability: before.deal.probability,
          expectedCloseAt: before.deal.expectedCloseAt,
          ownerUserId: before.deal.ownerUserId,
          source: before.deal.source,
        })
        em.persist(deal)
      }
      await em.flush()
      await syncDealPeople(em, deal, before.people)
      await syncDealCompanies(em, deal, before.companies)
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: deal,
        identifiers: {
          id: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
        },
        indexer: dealCrudIndexer,
      })

      const resetValues = buildCustomFieldResetMap(before.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: de,
          entityId: DEAL_ENTITY_ID,
          recordId: deal.id,
          organizationId: deal.organizationId,
          tenantId: deal.tenantId,
          values: resetValues,
          notify: false,
        })
      }
    },
  }

registerCommand(createDealCommand)
registerCommand(updateDealCommand)
registerCommand(deleteDealCommand)
