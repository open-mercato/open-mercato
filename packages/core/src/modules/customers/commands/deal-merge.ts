import { LockMode, raw } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { DefaultDataEngine, type DataEngine } from '@open-mercato/shared/lib/data/engine'
import { isReadProjectionAlwaysConsistent } from '@open-mercato/shared/lib/data/consistency'
import { listEntityMergeParticipants } from '@open-mercato/shared/lib/entities/merge-participants'
import { lockEntityReferences } from '@open-mercato/shared/lib/entities/reference-lock'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { decimalToString, parseDecimal } from '@open-mercato/shared/lib/decimal'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  CustomerActivity,
  CustomerComment,
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerDealStageTransition,
  CustomerEntity,
  CustomerInteraction,
  CustomerPipeline,
  CustomerPipelineStage,
} from '../data/entities'
import { dealMergeRequestSchema, type DealMergeRequest } from '../data/validators'
import { emitCustomersEvent } from '../events'
import { canonicalDealStatus, isLostDealStatus, isWonDealStatus } from '../lib/dealStatus'
import { DEAL_LOSS_REASON_DICTIONARY_KEY } from '../lib/dealLossReasons'
import { findInteractionUserInScope } from '../lib/interactionUsers'
import {
  enqueueDealMergeEffects,
  hasDealMergeEffectsConsumer,
  markDealMergeEffects,
  type DealMergeMovedRecords,
  type MovedRecord,
} from '../lib/dealMergeEffects'

const logger = createLogger('customers').child({ component: 'deals.merge' })

const DEAL_ENTITY_ID = 'customers:customer_deal'
const INLINE_MOVED_EFFECT_LIMIT = 32
const outputSchema = z.object({ survivorId: z.string().uuid(), sourceId: z.string().uuid() })

const dealIndexer: CrudIndexerConfig<CustomerDeal> = { entityType: DEAL_ENTITY_ID }
const dealEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'deal',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

export type DealMergeClosureOutcome = 'won' | 'lost' | null

type MergeResult = z.infer<typeof outputSchema> & {
  tenantId: string
  organizationId: string
  survivor: CustomerDeal
  source: CustomerDeal
  participantResults: Record<string, { moved: number; deduplicated: number }>
  snapshotBefore: Record<string, unknown>
  snapshotAfter: Record<string, unknown>
}

type MergeScope = { tenantId: string; organizationId: string }

function snapshotDeal(deal: CustomerDeal): Record<string, unknown> {
  return {
    id: deal.id,
    title: deal.title,
    description: deal.description ?? null,
    status: deal.status,
    pipelineStage: deal.pipelineStage ?? null,
    pipelineId: deal.pipelineId ?? null,
    pipelineStageId: deal.pipelineStageId ?? null,
    valueAmount: deal.valueAmount ?? null,
    valueCurrency: deal.valueCurrency ?? null,
    probability: deal.probability ?? null,
    expectedCloseAt: deal.expectedCloseAt ?? null,
    ownerUserId: deal.ownerUserId ?? null,
    source: deal.source ?? null,
    closureOutcome: deal.closureOutcome ?? null,
    lossReasonId: deal.lossReasonId ?? null,
    lossNotes: deal.lossNotes ?? null,
    updatedAt: deal.updatedAt,
  }
}

function relationId(value: CustomerDeal | CustomerEntity | string): string {
  return typeof value === 'string' ? value : value.id
}

function requireScope(
  ctx: Parameters<CommandHandler<DealMergeRequest, MergeResult>['execute']>[1],
  notFoundMessage: string,
): MergeScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw notFound(notFoundMessage)
  return { tenantId, organizationId }
}

export function dealMergeClosureOutcome(status: string): DealMergeClosureOutcome {
  const canonical = canonicalDealStatus(status.trim())
  if (isWonDealStatus(canonical)) return 'won'
  if (isLostDealStatus(canonical)) return 'lost'
  return null
}

export function resolveDealMergeClosure(values: {
  status: string
  lossReasonId: string | null
  lossNotes: string | null
}): { status: string; closureOutcome: DealMergeClosureOutcome; lossReasonId: string | null; lossNotes: string | null } {
  const status = canonicalDealStatus(values.status.trim())
  const closureOutcome = dealMergeClosureOutcome(status)
  if (closureOutcome !== 'lost') return { status, closureOutcome, lossReasonId: null, lossNotes: null }
  return { status, closureOutcome, lossReasonId: values.lossReasonId, lossNotes: values.lossNotes }
}

type LinkedEntityEntry = { id: string; type: string; label: string }

function sameRecordId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

const DEAL_CHIP_MATCH_SQL = "exists (select 1 from jsonb_array_elements(case when jsonb_typeof(linked_entities) = 'array' then linked_entities else '[]'::jsonb end) as chip where chip->>'type' = 'deal' and lower(chip->>'id') = lower(?))"

export function rewriteDealLinkedEntities(
  entries: unknown,
  sourceId: string,
  survivor: { id: string; title: string },
): LinkedEntityEntry[] | null {
  if (!Array.isArray(entries)) return null
  const typed = entries.filter((entry): entry is LinkedEntityEntry => (
    !!entry
    && typeof entry === 'object'
    && typeof (entry as LinkedEntityEntry).id === 'string'
    && typeof (entry as LinkedEntityEntry).type === 'string'
  ))
  if (!typed.some((entry) => entry.type === 'deal' && sameRecordId(entry.id, sourceId))) return null
  const hasSurvivor = typed.some((entry) => entry.type === 'deal' && sameRecordId(entry.id, survivor.id))
  const result: LinkedEntityEntry[] = []
  let survivorAdded = hasSurvivor
  for (const entry of entries as unknown[]) {
    const candidate = entry as LinkedEntityEntry
    const isSourceDeal = typed.includes(candidate) && candidate.type === 'deal' && sameRecordId(candidate.id, sourceId)
    if (!isSourceDeal) {
      result.push(candidate)
      continue
    }
    if (survivorAdded) continue
    result.push({ ...candidate, id: survivor.id, label: survivor.title })
    survivorAdded = true
  }
  return result
}

async function validateMergeReferences(
  em: EntityManager,
  values: DealMergeRequest['values'],
  closure: ReturnType<typeof resolveDealMergeClosure>,
  deals: CustomerDeal[],
  scope: MergeScope,
  translate: (key: string, fallback?: string) => string,
): Promise<string | null> {
  let stageLabel: string | null = null
  const storedPipelineDeal = values.pipelineId
    ? deals.find((deal) => deal.pipelineId === values.pipelineId && deal.pipelineStageId === values.pipelineStageId)
    : undefined
  if (storedPipelineDeal) {
    stageLabel = storedPipelineDeal.pipelineStage ?? null
  } else if (values.pipelineId) {
    const pipeline = await findOneWithDecryption(em, CustomerPipeline, {
      id: values.pipelineId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, {}, scope)
    if (!pipeline) throw badRequest(translate('customers.errors.pipeline_not_found', 'Pipeline not found'))
  }
  if (!storedPipelineDeal && values.pipelineStageId) {
    const stage = await findOneWithDecryption(em, CustomerPipelineStage, {
      id: values.pipelineStageId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, {}, scope)
    if (!stage) throw badRequest(translate('customers.errors.pipeline_stage_not_found', 'Pipeline stage not found'))
    if (stage.pipelineId !== values.pipelineId) {
      throw badRequest(translate('customers.errors.pipeline_stage_mismatch', 'Pipeline stage does not belong to the selected pipeline'))
    }
    stageLabel = stage.label
  }
  const existingLossReasons = new Set(deals.map((deal) => deal.lossReasonId).filter((id): id is string => !!id))
  if (closure.lossReasonId && !existingLossReasons.has(closure.lossReasonId)) {
    const entry = await findOneWithDecryption(em, DictionaryEntry, {
      id: closure.lossReasonId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }, { populate: ['dictionary'] }, scope)
    const dictionaryKey = entry?.dictionary && typeof entry.dictionary === 'object' ? entry.dictionary.key : null
    if (!entry || dictionaryKey !== DEAL_LOSS_REASON_DICTIONARY_KEY) {
      throw badRequest(translate('customers.deals.merge.errors.invalid_loss_reason', 'Selected loss reason is not available'))
    }
  }
  const existingOwners = new Set(deals.map((deal) => deal.ownerUserId).filter((id): id is string => !!id))
  if (values.ownerUserId && !existingOwners.has(values.ownerUserId)) {
    const owner = await findInteractionUserInScope(em, values.ownerUserId, scope)
    if (!owner) throw badRequest(translate('customers.deals.merge.errors.invalid_owner', 'Selected owner is not available'))
  }
  return stageLabel
}

export async function reconcileDealMergePeople(
  em: EntityManager,
  survivor: CustomerDeal,
  source: CustomerDeal,
  requestedIds: string[],
  primaryId: string | null,
  invalidSelectionMessage: string,
): Promise<void> {
  const desired = new Set(requestedIds)
  const scope = { tenantId: survivor.tenantId, organizationId: survivor.organizationId }
  const entities = desired.size
    ? await findWithDecryption(em, CustomerEntity, {
      id: { $in: [...desired] },
      kind: 'person',
      tenantId: survivor.tenantId,
      organizationId: survivor.organizationId,
      deletedAt: null,
    }, {}, scope)
    : []
  if (entities.length !== desired.size) throw badRequest(invalidSelectionMessage)
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const links = await findWithDecryption(em, CustomerDealPersonLink, {
    deal: { $in: [survivor.id, source.id] },
  }, { populate: ['deal', 'person'] }, scope)
  const survivorByPerson = new Map(
    links.filter((link) => relationId(link.deal) === survivor.id).map((link) => [relationId(link.person), link]),
  )
  for (const link of links) link.isPrimary = false
  await em.flush()
  const removedLinkIds = new Set<string>()
  for (const link of links) {
    const personId = relationId(link.person)
    const isSource = relationId(link.deal) === source.id
    if (!desired.has(personId) || (isSource && survivorByPerson.has(personId))) {
      em.remove(link)
      removedLinkIds.add(link.id)
    }
  }
  await em.flush()
  for (const link of links) {
    const personId = relationId(link.person)
    if (!desired.has(personId) || removedLinkIds.has(link.id)) continue
    if (relationId(link.deal) === source.id) link.deal = survivor
    survivorByPerson.set(personId, link)
  }
  for (const personId of desired) {
    if (survivorByPerson.has(personId)) continue
    const link = em.create(CustomerDealPersonLink, {
      deal: survivor,
      person: entityById.get(personId)!,
      isPrimary: false,
    })
    em.persist(link)
    survivorByPerson.set(personId, link)
  }
  await em.flush()
  if (primaryId) {
    const primaryLink = survivorByPerson.get(primaryId)
    if (!primaryLink) throw badRequest('[internal] Primary Deal person link was not reconciled')
    primaryLink.isPrimary = true
    await em.flush()
  }
}

export async function reconcileDealMergeCompanies(
  em: EntityManager,
  survivor: CustomerDeal,
  source: CustomerDeal,
  requestedIds: string[],
  invalidSelectionMessage: string,
): Promise<void> {
  const desired = new Set(requestedIds)
  const scope = { tenantId: survivor.tenantId, organizationId: survivor.organizationId }
  const entities = desired.size
    ? await findWithDecryption(em, CustomerEntity, {
      id: { $in: [...desired] },
      kind: 'company',
      tenantId: survivor.tenantId,
      organizationId: survivor.organizationId,
      deletedAt: null,
    }, {}, scope)
    : []
  if (entities.length !== desired.size) throw badRequest(invalidSelectionMessage)
  const entityById = new Map(entities.map((entity) => [entity.id, entity]))
  const links = await findWithDecryption(em, CustomerDealCompanyLink, {
    deal: { $in: [survivor.id, source.id] },
  }, { populate: ['deal', 'company'] }, scope)
  const survivorByCompany = new Map(
    links.filter((link) => relationId(link.deal) === survivor.id).map((link) => [relationId(link.company), link]),
  )
  const removedLinkIds = new Set<string>()
  for (const link of links) {
    const companyId = relationId(link.company)
    const isSource = relationId(link.deal) === source.id
    if (!desired.has(companyId) || (isSource && survivorByCompany.has(companyId))) {
      em.remove(link)
      removedLinkIds.add(link.id)
    }
  }
  await em.flush()
  for (const link of links) {
    const companyId = relationId(link.company)
    if (!desired.has(companyId) || removedLinkIds.has(link.id)) continue
    if (relationId(link.deal) === source.id) link.deal = survivor
    survivorByCompany.set(companyId, link)
  }
  for (const companyId of desired) {
    if (survivorByCompany.has(companyId)) continue
    const link = em.create(CustomerDealCompanyLink, {
      deal: survivor,
      company: entityById.get(companyId)!,
    })
    em.persist(link)
    survivorByCompany.set(companyId, link)
  }
  await em.flush()
}

function copyTransition(target: CustomerDealStageTransition, from: CustomerDealStageTransition): void {
  target.pipelineId = from.pipelineId
  target.stageLabel = from.stageLabel
  target.stageOrder = from.stageOrder
  target.transitionedAt = from.transitionedAt
  target.transitionedByUserId = from.transitionedByUserId ?? null
  target.isActive = from.isActive
  target.deletedAt = from.deletedAt ?? null
}

export async function reconcileDealMergeTransitions(
  em: EntityManager,
  survivor: CustomerDeal,
  source: CustomerDeal,
): Promise<void> {
  const transitions = await findWithDecryption(em, CustomerDealStageTransition, {
    deal: { $in: [survivor.id, source.id] },
  }, { populate: ['deal'] }, { tenantId: survivor.tenantId, organizationId: survivor.organizationId })
  const survivorByStage = new Map(
    transitions.filter((item) => relationId(item.deal) === survivor.id).map((item) => [item.stageId, item]),
  )
  const sourceTransitions = transitions.filter((item) => relationId(item.deal) === source.id)
  const reparented: CustomerDealStageTransition[] = []
  for (const sourceTransition of sourceTransitions) {
    const survivorTransition = survivorByStage.get(sourceTransition.stageId)
    if (!survivorTransition) {
      reparented.push(sourceTransition)
      continue
    }
    const sourceLive = !sourceTransition.deletedAt
    const survivorLive = !survivorTransition.deletedAt
    const sourceIsEarlier = sourceTransition.transitionedAt < survivorTransition.transitionedAt
    if (sourceLive && (!survivorLive || sourceIsEarlier)) copyTransition(survivorTransition, sourceTransition)
    em.remove(sourceTransition)
  }
  await em.flush()
  for (const transition of reparented) transition.deal = survivor
  await em.flush()
}

type MovedRow = Record<string, unknown> & { id: string }

async function selectMovedRows(em: EntityManager, sql: string, params: unknown[]): Promise<MovedRow[]> {
  const rows = await em.execute<MovedRow[]>(sql, params)
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === 'string') : []
}

async function collectMovedRecords(
  em: EntityManager,
  sourceId: string,
  survivorId: string,
  scope: MergeScope,
): Promise<{ activities: MovedRecord[]; comments: MovedRecord[]; interactions: MovedRecord[] }> {
  await em.execute(
    `select id from customer_interactions where tenant_id = ? and organization_id = ? and (deal_id = ? or ${DEAL_CHIP_MATCH_SQL}) order by id for update`,
    [scope.tenantId, scope.organizationId, sourceId, sourceId],
  )
  const params = [sourceId, scope.tenantId, scope.organizationId]
  const [activities, comments, interactions] = [
    await selectMovedRows(em,
      'select id, entity_id from customer_activities where deal_id = ? and tenant_id = ? and organization_id = ?',
      params),
    await selectMovedRows(em,
      'select id, entity_id from customer_comments where deal_id = ? and tenant_id = ? and organization_id = ? and deleted_at is null',
      params),
    await selectMovedRows(em,
      'select id, entity_id, interaction_type, status, source from customer_interactions where deal_id = ? and tenant_id = ? and organization_id = ? and deleted_at is null',
      params),
  ]
  return {
    activities: activities.map((row) => ({ id: row.id, payload: { entityId: row.entity_id ?? null, dealId: survivorId } })),
    comments: comments.map((row) => ({ id: row.id, payload: { entityId: row.entity_id ?? null, dealId: survivorId } })),
    interactions: interactions.map((row) => ({
      id: row.id,
      payload: {
        entityId: row.entity_id ?? null,
        interactionType: row.interaction_type ?? null,
        status: row.status ?? null,
        source: row.source ?? null,
        dealId: survivorId,
      },
    })),
  }
}

async function rewriteInteractionLinkedEntities(
  em: EntityManager,
  source: CustomerDeal,
  survivor: CustomerDeal,
  scope: MergeScope,
): Promise<MovedRecord[]> {
  const rows = await selectMovedRows(em,
    `select id, entity_id, interaction_type, status, source, deal_id, linked_entities, deleted_at from customer_interactions where tenant_id = ? and organization_id = ? and ${DEAL_CHIP_MATCH_SQL} order by id for update`,
    [scope.tenantId, scope.organizationId, source.id])
  const rewrites: Array<{ id: string; linked_entities: LinkedEntityEntry[] }> = []
  const touched: MovedRecord[] = []
  for (const row of rows) {
    const raw = typeof row.linked_entities === 'string' ? JSON.parse(row.linked_entities) : row.linked_entities
    const rewritten = rewriteDealLinkedEntities(raw, source.id, { id: survivor.id, title: survivor.title })
    if (!rewritten) continue
    rewrites.push({ id: row.id, linked_entities: rewritten })
    if (row.deleted_at) continue
    touched.push({
      id: row.id,
      payload: {
        entityId: row.entity_id ?? null,
        interactionType: row.interaction_type ?? null,
        status: row.status ?? null,
        source: row.source ?? null,
        dealId: row.deal_id ?? null,
      },
    })
  }
  if (rewrites.length > 0) {
    await em.execute(
      'update customer_interactions as ci set linked_entities = v.linked_entities, updated_at = now() from jsonb_to_recordset(?::jsonb) as v(id uuid, linked_entities jsonb) where ci.id = v.id and ci.tenant_id = ? and ci.organization_id = ?',
      [JSON.stringify(rewrites), scope.tenantId, scope.organizationId],
    )
  }
  return touched
}

function mergeMovedRecords(first: MovedRecord[], second: MovedRecord[]): MovedRecord[] {
  const byId = new Map<string, MovedRecord>()
  for (const record of [...first, ...second]) if (!byId.has(record.id)) byId.set(record.id, record)
  return [...byId.values()]
}

async function emitClosureEvent(
  outcome: 'won' | 'lost',
  survivor: CustomerDeal,
  scope: MergeScope,
): Promise<void> {
  const eventId = outcome === 'won' ? 'customers.deal.won' : 'customers.deal.lost'
  try {
    await emitCustomersEvent(eventId, {
      id: survivor.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ownerUserId: survivor.ownerUserId ?? null,
      title: survivor.title,
      valueAmount: survivor.valueAmount ?? null,
      valueCurrency: survivor.valueCurrency ?? null,
    }, {
      persistent: true,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch (error) {
    logger.warn('Deal closure event emit failed after merge', { eventId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'customers', code: 'customers.deal_merge_closure_event_failed' })
  }
}

async function emitMergedEvent(
  survivorId: string,
  sourceId: string,
  scope: MergeScope,
): Promise<void> {
  try {
    await emitCustomersEvent('customers.deal.merged', {
      id: survivorId,
      survivorId,
      sourceId,
      ...scope,
    }, {
      persistent: true,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch (error) {
    logger.warn('Deal merged event emit failed after merge', { survivorId, sourceId, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'customers', code: 'customers.deal_merge_merged_event_failed' })
  }
}

export const mergeDealsCommand: CommandHandler<DealMergeRequest, MergeResult> = {
  id: 'customers.deals.merge',
  outputSchema,
  async execute(rawInput, ctx) {
    const parsed = dealMergeRequestSchema.parse(rawInput)
    const { translate } = await resolveTranslations()
    const missingDealMessage = translate('customers.deals.merge.errors.not_found', 'Deal not found')
    const scope = requireScope(ctx, missingDealMessage)
    const em = (ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()) as EntityManager
    let survivor!: CustomerDeal
    let source!: CustomerDeal
    const participantResults: Record<string, { moved: number; deduplicated: number }> = {}
    let snapshotBefore: Record<string, unknown> = {}
    let snapshotAfter: Record<string, unknown> = {}
    let previousOutcome: DealMergeClosureOutcome = null
    let closure!: ReturnType<typeof resolveDealMergeClosure>
    let stageLabel: string | null = null
    let moved: DealMergeMovedRecords = {
      activities: [],
      comments: [],
      interactions: [],
    }

    await withAtomicFlush(em, [
      async () => {
        await lockEntityReferences(em, [parsed.survivorId, parsed.sourceId].map((recordId) => ({
          entityId: DEAL_ENTITY_ID,
          recordId,
          ...scope,
        })))
        const deals = await findWithDecryption(em, CustomerDeal, {
          id: { $in: [parsed.survivorId, parsed.sourceId].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) },
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'ASC' } }, scope)
        const survivorRecord = deals.find((deal) => deal.id === parsed.survivorId)
        const sourceRecord = deals.find((deal) => deal.id === parsed.sourceId)
        if (!survivorRecord) {
          enforceRecordGoneIsConflict({
            resourceKind: 'customers.deal',
            resourceId: parsed.survivorId,
            expected: parsed.survivorUpdatedAt,
          })
          throw notFound(missingDealMessage)
        }
        if (!sourceRecord) {
          enforceRecordGoneIsConflict({
            resourceKind: 'customers.deal',
            resourceId: parsed.sourceId,
            expected: parsed.sourceUpdatedAt,
          })
          throw notFound(missingDealMessage)
        }
        survivor = survivorRecord
        source = sourceRecord
        snapshotBefore = { survivor: snapshotDeal(survivor), source: snapshotDeal(source) }
        previousOutcome = dealMergeClosureOutcome(survivor.status)

        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: 'customers.deal',
          resourceId: survivor.id,
          expected: parsed.survivorUpdatedAt,
          current: survivor.updatedAt,
          request: ctx.request ?? null,
        })
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: 'customers.deal',
          resourceId: source.id,
          expected: parsed.sourceUpdatedAt,
          current: source.updatedAt,
          request: ctx.request ?? null,
        })

        closure = resolveDealMergeClosure(parsed.values)
        stageLabel = await validateMergeReferences(em, parsed.values, closure, [survivor, source], scope, translate)
        moved = await collectMovedRecords(em, source.id, survivor.id, scope)
      },
      () => {
        survivor.title = parsed.values.title
        survivor.description = parsed.values.description
        survivor.status = closure.status
        survivor.pipelineStage = stageLabel ?? parsed.values.pipelineStage
        survivor.pipelineId = parsed.values.pipelineId
        survivor.pipelineStageId = parsed.values.pipelineStageId
        const amount = parseDecimal(parsed.values.valueAmount)
        survivor.valueAmount = amount ? decimalToString(amount) : null
        survivor.valueCurrency = parsed.values.valueCurrency
        survivor.probability = parsed.values.probability
        survivor.expectedCloseAt = parsed.values.expectedCloseAt
        survivor.ownerUserId = parsed.values.ownerUserId
        survivor.source = parsed.values.source
        survivor.closureOutcome = closure.closureOutcome
        survivor.lossReasonId = closure.lossReasonId
        survivor.lossNotes = closure.lossNotes
      },
      async () => {
        await em.flush()
      },
      () => reconcileDealMergePeople(
        em,
        survivor,
        source,
        parsed.personIds,
        parsed.primaryPersonEntityId,
        translate('customers.deals.merge.errors.invalid_people', 'Invalid Deal person selection'),
      ),
      () => reconcileDealMergeCompanies(
        em,
        survivor,
        source,
        parsed.companyIds,
        translate('customers.deals.merge.errors.invalid_companies', 'Invalid Deal company selection'),
      ),
      async () => {
        await em.nativeUpdate(CustomerActivity, {
          deal: source.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }, { deal: survivor.id, updatedAt: raw('now()') })
        await em.nativeUpdate(CustomerComment, {
          deal: source.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }, { deal: survivor.id, updatedAt: raw('now()') })
        await em.nativeUpdate(CustomerInteraction, {
          dealId: source.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        }, { dealId: survivor.id, updatedAt: raw('now()') })
        const relinked = await rewriteInteractionLinkedEntities(em, source, survivor, scope)
        moved = { ...moved, interactions: mergeMovedRecords(moved.interactions, relinked) }
      },
      () => reconcileDealMergeTransitions(em, survivor, source),
      async () => {
        const transactionDataEngine = new DefaultDataEngine(em, ctx.container)
        await transactionDataEngine.setCustomFields({
          entityId: DEAL_ENTITY_ID,
          recordId: survivor.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          values: parsed.customFields as Parameters<DataEngine['setCustomFields']>[0]['values'],
          notify: false,
        })
        await em.nativeDelete(CustomFieldValue, {
          entityId: DEAL_ENTITY_ID,
          recordId: source.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      },
      async () => {
        for (const participant of listEntityMergeParticipants(DEAL_ENTITY_ID)) {
          participantResults[participant.id] = await participant.merge({
            em,
            entityId: DEAL_ENTITY_ID,
            survivorId: survivor.id,
            sourceId: source.id,
            ...scope,
          })
        }
      },
      () => {
        survivor.updatedAt = new Date()
        snapshotAfter = {
          survivor: {
            ...snapshotDeal(survivor),
            people: parsed.personIds,
            primaryPersonEntityId: parsed.primaryPersonEntityId,
            companies: parsed.companyIds,
            custom: parsed.customFields,
          },
          mergedSourceId: source.id,
        }
        em.remove(source)
      },
    ], { transaction: true, label: 'customers.deals.merge' })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: survivor,
      identifiers: { id: survivor.id, ...scope },
      indexer: dealIndexer,
      events: dealEvents,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: source,
      identifiers: { id: source.id, ...scope },
      indexer: dealIndexer,
      events: dealEvents,
    })
    const movedCount = moved.activities.length + moved.comments.length + moved.interactions.length
    const movedEffects = { ...scope, moved }
    let effectsQueued = false
    if (movedCount > INLINE_MOVED_EFFECT_LIMIT && hasDealMergeEffectsConsumer() && !ctx.bulkImport && !isReadProjectionAlwaysConsistent()) {
      try {
        await enqueueDealMergeEffects(movedEffects)
        effectsQueued = true
      } catch (error) {
        logger.warn('Deal merge effects enqueue failed, processing inline', { survivorId: survivor.id, sourceId: source.id, err: error })
        getTelemetryRuntime()?.reportError(error, { module: 'customers', code: 'customers.deal_merge_effects_enqueue_failed' })
      }
    }
    if (!effectsQueued) markDealMergeEffects(dataEngine, movedEffects)
    if (closure.closureOutcome && closure.closureOutcome !== previousOutcome) {
      await emitClosureEvent(closure.closureOutcome, survivor, scope)
    }
    await emitMergedEvent(survivor.id, source.id, scope)
    return { survivorId: survivor.id, sourceId: source.id, survivor, source, participantResults, snapshotBefore, snapshotAfter, ...scope }
  },
  async buildLog({ result }) {
    const { translate } = await resolveTranslations()
    return {
      replayable: false,
      resourceKind: 'customers.deal',
      resourceId: result.survivorId,
      relatedResourceKind: 'customers.deal',
      relatedResourceId: result.sourceId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      actionLabel: translate('customers.deals.merge.action', 'Merge deals'),
      payload: {
        survivorId: result.survivorId,
        sourceId: result.sourceId,
        participants: result.participantResults,
      },
      snapshotBefore: result.snapshotBefore,
      snapshotAfter: result.snapshotAfter,
    }
  },
}
