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
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  CustomerAddress,
  CustomerComment,
  CustomerCompanyProfile,
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerActivity,
  CustomerTodoLink,
  CustomerEntity,
  CustomerPersonProfile,
  CustomerTagAssignment,
} from '../data/entities'
import {
  companyCreateSchema,
  companyUpdateSchema,
  type CompanyCreateInput,
  type CompanyUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  assertRecordFound,
  syncEntityTags,
  loadEntityTagIds,
  emitQueryIndexDeleteEvents,
  emitQueryIndexUpsertEvents,
  type QueryIndexEventEntry,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  loadCustomFieldSnapshot,
  diffCustomFieldChanges,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const COMPANY_ENTITY_ID = 'customers:customer_company_profile'

const companyCrudIndexer: CrudIndexerConfig<CustomerEntity> = {
  entityType: E.customers.customer_company_profile,
}

const companyCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'company',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type CompanyAddressSnapshot = {
  id: string
  name: string | null
  purpose: string | null
  addressLine1: string
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  isPrimary: boolean
}

type CompanyCommentSnapshot = {
  id: string
  body: string
  authorUserId: string | null
  dealId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

type CompanyActivitySnapshot = {
  id: string
  activityType: string
  subject: string | null
  body: string | null
  occurredAt: Date | null
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  dealId: string | null
  createdAt: Date
  updatedAt: Date
}

type CompanyTodoSnapshot = {
  id: string
  todoId: string
  todoSource: string
  createdAt: Date
  createdByUserId: string | null
}

type CompanySnapshot = {
  entity: {
    id: string
    organizationId: string
    tenantId: string
    displayName: string
    description: string | null
    ownerUserId: string | null
    primaryEmail: string | null
    primaryPhone: string | null
    status: string | null
    lifecycleStage: string | null
    source: string | null
    nextInteractionAt: Date | null
    nextInteractionName: string | null
    nextInteractionRefId: string | null
    nextInteractionIcon: string | null
    nextInteractionColor: string | null
    isActive: boolean
  }
  profile: {
    id: string
    legalName: string | null
    brandName: string | null
    domain: string | null
    websiteUrl: string | null
    industry: string | null
    sizeBucket: string | null
    annualRevenue: string | null
  }
  tagIds: string[]
  custom?: Record<string, unknown>
  deals: Array<{
    id: string
    dealId: string
    createdAt: Date
  }>
  members: Array<{
    profileId: string
    personEntityId: string
  }>
  addresses: CompanyAddressSnapshot[]
  comments: CompanyCommentSnapshot[]
  activities: CompanyActivitySnapshot[]
  todos: CompanyTodoSnapshot[]
}

type CompanyUndoPayload = {
  before?: CompanySnapshot | null
  after?: CompanySnapshot | null
}

async function loadCompanySnapshot(em: EntityManager, id: string): Promise<CompanySnapshot | null> {
  const entity = await em.findOne(CustomerEntity, { id, deletedAt: null })
  if (!entity || entity.kind !== 'company') return null
  const profile = await em.findOne(CustomerCompanyProfile, { entity })
  if (!profile) return null
  const tagIds = await loadEntityTagIds(em, entity)
  const deals = await findWithDecryption(
    em,
    CustomerDealCompanyLink,
    { company: entity },
    { orderBy: { createdAt: 'asc' }, populate: ['deal'] },
    { tenantId: entity.tenantId, organizationId: entity.organizationId },
  )
  const members = await findWithDecryption(
    em,
    CustomerPersonProfile,
    { company: entity },
    { orderBy: { createdAt: 'asc' }, populate: ['entity'] },
    { tenantId: entity.tenantId, organizationId: entity.organizationId },
  )
  const addresses = await em.find(CustomerAddress, { entity }, { orderBy: { createdAt: 'asc' } })
  const comments = await findWithDecryption(
    em,
    CustomerComment,
    { entity },
    { orderBy: { createdAt: 'asc' }, populate: ['deal'] },
    { tenantId: entity.tenantId, organizationId: entity.organizationId },
  )
  const activities = await findWithDecryption(
    em,
    CustomerActivity,
    { entity },
    { orderBy: { createdAt: 'asc' }, populate: ['deal'] },
    { tenantId: entity.tenantId, organizationId: entity.organizationId },
  )
  const todoLinks = await em.find(CustomerTodoLink, { entity }, { orderBy: { createdAt: 'asc' } })
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: COMPANY_ENTITY_ID,
    recordId: profile.id,
    tenantId: entity.tenantId,
    organizationId: entity.organizationId,
  })
  return {
    entity: {
      id: entity.id,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
      displayName: entity.displayName,
      description: entity.description ?? null,
      ownerUserId: entity.ownerUserId ?? null,
      primaryEmail: entity.primaryEmail ?? null,
      primaryPhone: entity.primaryPhone ?? null,
      status: entity.status ?? null,
      lifecycleStage: entity.lifecycleStage ?? null,
      source: entity.source ?? null,
      nextInteractionAt: entity.nextInteractionAt ?? null,
      nextInteractionName: entity.nextInteractionName ?? null,
      nextInteractionRefId: entity.nextInteractionRefId ?? null,
      nextInteractionIcon: entity.nextInteractionIcon ?? null,
      nextInteractionColor: entity.nextInteractionColor ?? null,
      isActive: entity.isActive,
    },
    profile: {
      id: profile.id,
      legalName: profile.legalName ?? null,
      brandName: profile.brandName ?? null,
      domain: profile.domain ?? null,
      websiteUrl: profile.websiteUrl ?? null,
      industry: profile.industry ?? null,
      sizeBucket: profile.sizeBucket ?? null,
      annualRevenue: profile.annualRevenue ?? null,
    },
    tagIds,
    custom,
    deals: deals
      .filter((link) => link.deal)
      .map((link) => ({
        id: link.id,
        dealId: link.deal.id,
        createdAt: link.createdAt,
      })),
    members: members
      .filter((member) => member.entity)
      .map((member) => ({
        profileId: member.id,
        personEntityId: typeof member.entity === 'string' ? member.entity : member.entity.id,
      })),
    addresses: addresses.map((address) => ({
      id: address.id,
      name: address.name ?? null,
      purpose: address.purpose ?? null,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      city: address.city ?? null,
      region: address.region ?? null,
      postalCode: address.postalCode ?? null,
      country: address.country ?? null,
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
      isPrimary: address.isPrimary,
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorUserId: comment.authorUserId ?? null,
      dealId: comment.deal
        ? typeof comment.deal === 'string'
          ? comment.deal
          : comment.deal.id
        : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      deletedAt: comment.deletedAt ?? null,
      appearanceIcon: comment.appearanceIcon ?? null,
      appearanceColor: comment.appearanceColor ?? null,
    })),
    activities: activities.map((activity) => ({
      id: activity.id,
      activityType: activity.activityType,
      subject: activity.subject ?? null,
      body: activity.body ?? null,
      occurredAt: activity.occurredAt ?? null,
      authorUserId: activity.authorUserId ?? null,
      appearanceIcon: activity.appearanceIcon ?? null,
      appearanceColor: activity.appearanceColor ?? null,
      dealId: activity.deal
        ? typeof activity.deal === 'string'
          ? activity.deal
          : activity.deal.id
        : null,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
    })),
    todos: todoLinks.map((todo) => ({
      id: todo.id,
      todoId: todo.todoId,
      todoSource: todo.todoSource,
      createdAt: todo.createdAt,
      createdByUserId: todo.createdByUserId ?? null,
    })),
  }
}

async function setCompanyCustomFields(
  ctx: CommandRuntimeContext,
  profileId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>
) {
  if (!values || !Object.keys(values).length) return
  const de = (ctx.container.resolve('dataEngine') as DataEngine)
  await setCustomFieldsIfAny({
    dataEngine: de,
    entityId: COMPANY_ENTITY_ID,
    recordId: profileId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^#([0-9a-f]{6})$/.test(trimmed) ? trimmed : null
}

const createCompanyCommand: CommandHandler<CompanyCreateInput, { entityId: string; companyId: string }> = {
  id: 'customers.companies.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(companyCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const nextInteractionName = parsed.nextInteraction?.name ? parsed.nextInteraction.name.trim() : null
    const nextInteractionRefId = normalizeOptionalString(parsed.nextInteraction?.refId)
    const nextInteractionIcon = normalizeOptionalString(parsed.nextInteraction?.icon)
    const nextInteractionColor = normalizeHexColor(parsed.nextInteraction?.color)
    const entity = em.create(CustomerEntity, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      kind: 'company',
      displayName: parsed.displayName,
      description: parsed.description ?? null,
      ownerUserId: parsed.ownerUserId ?? null,
      primaryEmail: parsed.primaryEmail ?? null,
      primaryPhone: parsed.primaryPhone ?? null,
      status: parsed.status ?? null,
      lifecycleStage: parsed.lifecycleStage ?? null,
      source: parsed.source ?? null,
      nextInteractionAt: parsed.nextInteraction?.at ?? null,
      nextInteractionName,
      nextInteractionRefId,
      nextInteractionIcon,
      nextInteractionColor,
      isActive: parsed.isActive ?? true,
    })

    const profile = em.create(CustomerCompanyProfile, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      entity,
      legalName: parsed.legalName ?? null,
      brandName: parsed.brandName ?? null,
      domain: parsed.domain ?? null,
      websiteUrl: parsed.websiteUrl ?? null,
      industry: parsed.industry ?? null,
      sizeBucket: parsed.sizeBucket ?? null,
      annualRevenue: parsed.annualRevenue !== undefined ? String(parsed.annualRevenue) : null,
    })

    em.persist(entity)
    em.persist(profile)
    await em.flush()

    await syncEntityTags(em, entity, parsed.tags)
    await em.flush()
    await setCompanyCustomFields(ctx, profile.id, entity.organizationId, entity.tenantId, custom)

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity,
      identifiers: {
        id: profile.id ?? entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
      indexer: companyCrudIndexer,
      events: companyCrudEvents,
    })

    return { entityId: entity.id, companyId: profile.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return await loadCompanySnapshot(em, result.entityId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadCompanySnapshot(em, result.entityId)
    return {
      actionLabel: translate('customers.audit.companies.create', 'Create company'),
      resourceKind: 'customers.company',
      resourceId: result.entityId,
      tenantId: snapshot?.entity.tenantId ?? null,
      organizationId: snapshot?.entity.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        } satisfies CompanyUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const entityId = logEntry?.resourceId
    if (!entityId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await em.findOne(CustomerEntity, { id: entityId })
    if (!entity) return
    await em.nativeDelete(CustomerCompanyProfile, { entity })
    await em.nativeDelete(CustomerTagAssignment, { entity })
    em.remove(entity)
    await em.flush()
  },
}

const updateCompanyCommand: CommandHandler<CompanyUpdateInput, { entityId: string }> = {
  id: 'customers.companies.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(companyUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadCompanySnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(companyUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await em.findOne(CustomerEntity, { id: parsed.id, deletedAt: null })
    const record = assertRecordFound(entity, 'Company not found')
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const profile = await em.findOne(CustomerCompanyProfile, { entity: record })
    if (!profile) throw new CrudHttpError(404, { error: 'Company profile not found' })

    if (parsed.displayName !== undefined) record.displayName = parsed.displayName
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.ownerUserId !== undefined) record.ownerUserId = parsed.ownerUserId ?? null
    if (parsed.primaryEmail !== undefined) record.primaryEmail = parsed.primaryEmail ?? null
    if (parsed.primaryPhone !== undefined) record.primaryPhone = parsed.primaryPhone ?? null
    if (parsed.status !== undefined) record.status = parsed.status ?? null
    if (parsed.lifecycleStage !== undefined) record.lifecycleStage = parsed.lifecycleStage ?? null
    if (parsed.source !== undefined) record.source = parsed.source ?? null
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive

    if (parsed.nextInteraction) {
      record.nextInteractionAt = parsed.nextInteraction.at
      record.nextInteractionName = parsed.nextInteraction.name.trim()
      record.nextInteractionRefId = normalizeOptionalString(parsed.nextInteraction.refId) ?? null
      record.nextInteractionIcon = normalizeOptionalString(parsed.nextInteraction.icon)
      record.nextInteractionColor = normalizeHexColor(parsed.nextInteraction.color)
    } else if (parsed.nextInteraction === null) {
      record.nextInteractionAt = null
      record.nextInteractionName = null
      record.nextInteractionRefId = null
      record.nextInteractionIcon = null
      record.nextInteractionColor = null
    }

    if (parsed.legalName !== undefined) profile.legalName = parsed.legalName ?? null
    if (parsed.brandName !== undefined) profile.brandName = parsed.brandName ?? null
    if (parsed.domain !== undefined) profile.domain = parsed.domain ?? null
    if (parsed.websiteUrl !== undefined) profile.websiteUrl = parsed.websiteUrl ?? null
    if (parsed.industry !== undefined) profile.industry = parsed.industry ?? null
    if (parsed.sizeBucket !== undefined) profile.sizeBucket = parsed.sizeBucket ?? null
    if (parsed.annualRevenue !== undefined) {
      profile.annualRevenue = parsed.annualRevenue !== null && parsed.annualRevenue !== undefined ? String(parsed.annualRevenue) : null
    }

    await syncEntityTags(em, record, parsed.tags)
    await em.flush()

    await setCompanyCustomFields(ctx, profile.id, record.organizationId, record.tenantId, custom)

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: profile.id ?? record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: companyCrudIndexer,
      events: companyCrudEvents,
    })

    return { entityId: record.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as CompanySnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const afterSnapshot = await loadCompanySnapshot(em, before.entity.id)
    const changeKeys: readonly string[] = [
      'displayName',
      'description',
      'ownerUserId',
      'primaryEmail',
      'primaryPhone',
      'status',
      'lifecycleStage',
      'source',
      'nextInteractionAt',
      'nextInteractionName',
      'nextInteractionRefId',
      'nextInteractionIcon',
      'nextInteractionColor',
      'isActive',
    ]
    const changes =
      afterSnapshot && afterSnapshot.entity
        ? buildChanges(
            before.entity as Record<string, unknown>,
            afterSnapshot.entity as Record<string, unknown>,
            changeKeys
          )
        : {}
    const customChanges = diffCustomFieldChanges(before.custom, afterSnapshot?.custom)
    return {
      actionLabel: translate('customers.audit.companies.update', 'Update company'),
      resourceKind: 'customers.company',
      resourceId: before.entity.id,
      tenantId: before.entity.tenantId,
      organizationId: before.entity.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes: Object.keys(customChanges).length ? { ...changes, custom: customChanges } : changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies CompanyUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CompanyUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let entity = await em.findOne(CustomerEntity, { id: before.entity.id })
    if (!entity) {
      entity = em.create(CustomerEntity, {
        id: before.entity.id,
        organizationId: before.entity.organizationId,
        tenantId: before.entity.tenantId,
        kind: 'company',
        displayName: before.entity.displayName,
        description: before.entity.description,
        ownerUserId: before.entity.ownerUserId,
        primaryEmail: before.entity.primaryEmail,
        primaryPhone: before.entity.primaryPhone,
        status: before.entity.status,
        lifecycleStage: before.entity.lifecycleStage,
        source: before.entity.source,
        nextInteractionAt: before.entity.nextInteractionAt,
        nextInteractionName: before.entity.nextInteractionName,
        nextInteractionRefId: before.entity.nextInteractionRefId,
        nextInteractionIcon: before.entity.nextInteractionIcon,
        nextInteractionColor: before.entity.nextInteractionColor,
        isActive: before.entity.isActive,
      })
      em.persist(entity)
    } else {
      entity.displayName = before.entity.displayName
      entity.description = before.entity.description
      entity.ownerUserId = before.entity.ownerUserId
      entity.primaryEmail = before.entity.primaryEmail
      entity.primaryPhone = before.entity.primaryPhone
      entity.status = before.entity.status
      entity.lifecycleStage = before.entity.lifecycleStage
      entity.source = before.entity.source
      entity.nextInteractionAt = before.entity.nextInteractionAt
      entity.nextInteractionName = before.entity.nextInteractionName
      entity.nextInteractionRefId = before.entity.nextInteractionRefId
      entity.nextInteractionIcon = before.entity.nextInteractionIcon
      entity.nextInteractionColor = before.entity.nextInteractionColor
      entity.isActive = before.entity.isActive
    }

    let profile = await em.findOne(CustomerCompanyProfile, { entity })
    if (!profile) {
      profile = em.create(CustomerCompanyProfile, {
        id: before.profile.id,
        organizationId: before.entity.organizationId,
        tenantId: before.entity.tenantId,
        entity,
        legalName: before.profile.legalName,
        brandName: before.profile.brandName,
        domain: before.profile.domain,
        websiteUrl: before.profile.websiteUrl,
        industry: before.profile.industry,
        sizeBucket: before.profile.sizeBucket,
        annualRevenue: before.profile.annualRevenue,
      })
      em.persist(profile)
    } else {
      profile.legalName = before.profile.legalName
      profile.brandName = before.profile.brandName
      profile.domain = before.profile.domain
      profile.websiteUrl = before.profile.websiteUrl
      profile.industry = before.profile.industry
      profile.sizeBucket = before.profile.sizeBucket
      profile.annualRevenue = before.profile.annualRevenue
    }

    await em.flush()
    await syncEntityTags(em, entity, before.tagIds)
    await em.flush()

    await em.nativeDelete(CustomerDealCompanyLink, { company: entity })
    if (before.deals?.length) {
      const dealIds = before.deals.map((link) => link.dealId)
      const deals = await em.find(CustomerDeal, {
        id: { $in: dealIds },
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      })
      const dealMap = new Map(deals.map((deal) => [deal.id, deal]))
      for (const link of before.deals) {
        const deal = dealMap.get(link.dealId)
        if (!deal) continue
        const restoredLink = em.create(CustomerDealCompanyLink, {
          id: link.id,
          deal,
          company: entity,
          createdAt: link.createdAt,
        })
        em.persist(restoredLink)
      }
      await em.flush()
    }

    if (before.members?.length) {
      const memberIds = before.members.map((member) => member.profileId)
      const profiles = await em.find(CustomerPersonProfile, {
        id: { $in: memberIds },
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      })
      const profileMap = new Map(profiles.map((profile) => [profile.id, profile]))
      for (const member of before.members) {
        const profile = profileMap.get(member.profileId)
        if (!profile) continue
        profile.company = entity
      }
      await em.flush()
    }

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity,
      identifiers: {
        id: profile.id ?? entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
      indexer: companyCrudIndexer,
      events: companyCrudEvents,
    })

    const resetValues = buildCustomFieldResetMap(before.custom, payload?.after?.custom)
    if (Object.keys(resetValues).length) {
      await setCompanyCustomFields(ctx, profile.id, entity.organizationId, entity.tenantId, resetValues)
    }
  },
}

const deleteCompanyCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { entityId: string }> =
  {
    id: 'customers.companies.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Company id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadCompanySnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Company id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const snapshot = await loadCompanySnapshot(em, id)
      const entity = await em.findOne(CustomerEntity, { id, deletedAt: null })
      const record = assertRecordFound(entity, 'Company not found')
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      const profile = await em.findOne(CustomerCompanyProfile, { entity: record })
      await em.nativeUpdate(CustomerPersonProfile, { company: record }, { company: null })
      await em.nativeDelete(CustomerDealCompanyLink, { company: record })
      await em.nativeDelete(CustomerActivity, { entity: record })
      await em.nativeDelete(CustomerTodoLink, { entity: record })
      await em.nativeDelete(CustomerCompanyProfile, { entity: record })
      await em.nativeDelete(CustomerAddress, { entity: record })
      await em.nativeDelete(CustomerComment, { entity: record })
      await em.nativeDelete(CustomerTagAssignment, { entity: record })
      em.remove(record)
      await em.flush()

      const indexDeletes: QueryIndexEventEntry[] = []
      const memberUpserts: QueryIndexEventEntry[] = []
      const dealUpserts: QueryIndexEventEntry[] = []
      if (snapshot) {
        for (const activity of snapshot.activities ?? []) {
          indexDeletes.push({
            entityType: E.customers.customer_activity,
            recordId: activity.id,
            tenantId: record.tenantId,
            organizationId: record.organizationId,
          })
        }
        for (const comment of snapshot.comments ?? []) {
          indexDeletes.push({
            entityType: E.customers.customer_comment,
            recordId: comment.id,
            tenantId: record.tenantId,
            organizationId: record.organizationId,
          })
        }
        for (const address of snapshot.addresses ?? []) {
          indexDeletes.push({
            entityType: E.customers.customer_address,
            recordId: address.id,
            tenantId: record.tenantId,
            organizationId: record.organizationId,
          })
        }
        for (const todo of snapshot.todos ?? []) {
          indexDeletes.push({
            entityType: E.customers.customer_todo_link,
            recordId: todo.id,
            tenantId: record.tenantId,
            organizationId: record.organizationId,
          })
        }
        for (const member of snapshot.members ?? []) {
          if (member.profileId) {
            memberUpserts.push({
              entityType: E.customers.customer_person_profile,
              recordId: member.profileId,
              tenantId: record.tenantId,
              organizationId: record.organizationId,
            })
          }
        }
        for (const deal of snapshot.deals ?? []) {
          if (deal.dealId) {
            dealUpserts.push({
              entityType: E.customers.customer_deal,
              recordId: deal.dealId,
              tenantId: record.tenantId,
              organizationId: record.organizationId,
            })
          }
        }
      }

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: record,
        identifiers: {
          id: profile?.id ?? record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
        indexer: companyCrudIndexer,
        events: companyCrudEvents,
      })

      await emitQueryIndexDeleteEvents(ctx, indexDeletes)
      await emitQueryIndexUpsertEvents(ctx, memberUpserts)
      await emitQueryIndexUpsertEvents(ctx, dealUpserts)
      return { entityId: record.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as CompanySnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.companies.delete', 'Delete company'),
        resourceKind: 'customers.company',
        resourceId: before.entity.id,
        tenantId: before.entity.tenantId,
        organizationId: before.entity.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies CompanyUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<CompanyUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      let entity = await em.findOne(CustomerEntity, { id: before.entity.id })
      if (!entity) {
        entity = em.create(CustomerEntity, {
          id: before.entity.id,
          organizationId: before.entity.organizationId,
          tenantId: before.entity.tenantId,
          kind: 'company',
          displayName: before.entity.displayName,
          description: before.entity.description,
          ownerUserId: before.entity.ownerUserId,
          primaryEmail: before.entity.primaryEmail,
          primaryPhone: before.entity.primaryPhone,
          status: before.entity.status,
          lifecycleStage: before.entity.lifecycleStage,
          source: before.entity.source,
          nextInteractionAt: before.entity.nextInteractionAt,
          nextInteractionName: before.entity.nextInteractionName,
          nextInteractionRefId: before.entity.nextInteractionRefId,
          nextInteractionIcon: before.entity.nextInteractionIcon,
          nextInteractionColor: before.entity.nextInteractionColor,
          isActive: before.entity.isActive,
        })
        em.persist(entity)
      }

      entity.displayName = before.entity.displayName
      entity.description = before.entity.description
      entity.ownerUserId = before.entity.ownerUserId
      entity.primaryEmail = before.entity.primaryEmail
      entity.primaryPhone = before.entity.primaryPhone
      entity.status = before.entity.status
      entity.lifecycleStage = before.entity.lifecycleStage
      entity.source = before.entity.source
      entity.nextInteractionAt = before.entity.nextInteractionAt
      entity.nextInteractionName = before.entity.nextInteractionName
      entity.nextInteractionRefId = before.entity.nextInteractionRefId
      entity.nextInteractionIcon = before.entity.nextInteractionIcon
      entity.nextInteractionColor = before.entity.nextInteractionColor
      entity.isActive = before.entity.isActive

      let profile = await em.findOne(CustomerCompanyProfile, { entity })
      if (!profile) {
        profile = em.create(CustomerCompanyProfile, {
          id: before.profile.id,
          organizationId: before.entity.organizationId,
          tenantId: before.entity.tenantId,
          entity,
          legalName: before.profile.legalName,
          brandName: before.profile.brandName,
          domain: before.profile.domain,
          websiteUrl: before.profile.websiteUrl,
          industry: before.profile.industry,
          sizeBucket: before.profile.sizeBucket,
          annualRevenue: before.profile.annualRevenue,
        })
        em.persist(profile)
      } else {
        profile.legalName = before.profile.legalName
        profile.brandName = before.profile.brandName
        profile.domain = before.profile.domain
        profile.websiteUrl = before.profile.websiteUrl
        profile.industry = before.profile.industry
        profile.sizeBucket = before.profile.sizeBucket
        profile.annualRevenue = before.profile.annualRevenue
      }

      await em.flush()
      await syncEntityTags(em, entity, before.tagIds)
      await em.flush()

      const beforeDeals = before.deals ?? []
      const beforeMembers = before.members ?? []
      const beforeActivities = (before as { activities?: CompanyActivitySnapshot[] }).activities ?? []
      const beforeComments = (before as { comments?: CompanyCommentSnapshot[] }).comments ?? []
      const beforeAddresses = (before as { addresses?: CompanyAddressSnapshot[] }).addresses ?? []
      const beforeTodos = (before as { todos?: CompanyTodoSnapshot[] }).todos ?? []

      const relatedDealIds = new Set<string>()
      for (const link of beforeDeals) relatedDealIds.add(link.dealId)
      for (const activity of beforeActivities) {
        if (activity.dealId) relatedDealIds.add(activity.dealId)
      }
      for (const comment of beforeComments) {
        if (comment.dealId) relatedDealIds.add(comment.dealId)
      }
      let dealMap = new Map<string, CustomerDeal>()
      if (relatedDealIds.size) {
        const deals = await em.find(CustomerDeal, {
          id: { $in: Array.from(relatedDealIds) },
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
        })
        dealMap = new Map(deals.map((deal) => [deal.id, deal]))
      }

      await em.nativeDelete(CustomerDealCompanyLink, { company: entity })
      for (const link of beforeDeals) {
        const deal = dealMap.get(link.dealId)
        if (!deal) continue
        const restoredLink = em.create(CustomerDealCompanyLink, {
          id: link.id,
          deal,
          company: entity,
          createdAt: link.createdAt,
        })
        em.persist(restoredLink)
      }
      await em.flush()

      if (beforeMembers.length) {
        const memberIds = beforeMembers.map((member) => member.profileId)
        const profiles = await em.find(CustomerPersonProfile, {
          id: { $in: memberIds },
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
        })
        const profileMap = new Map(profiles.map((profile) => [profile.id, profile]))
        for (const member of beforeMembers) {
          const memberProfile = profileMap.get(member.profileId)
          if (!memberProfile) continue
          memberProfile.company = entity
        }
        await em.flush()
      }

      await em.nativeDelete(CustomerActivity, { entity })
      for (const activity of beforeActivities) {
        const restoredActivity = em.create(CustomerActivity, {
          id: activity.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          entity,
          activityType: activity.activityType,
          subject: activity.subject,
          body: activity.body,
          occurredAt: activity.occurredAt,
          authorUserId: activity.authorUserId,
          appearanceIcon: activity.appearanceIcon,
          appearanceColor: activity.appearanceColor,
          deal: activity.dealId ? dealMap.get(activity.dealId) ?? null : null,
          createdAt: activity.createdAt,
          updatedAt: activity.updatedAt,
        })
        em.persist(restoredActivity)
      }
      await em.flush()

      await em.nativeDelete(CustomerComment, { entity })
      for (const comment of beforeComments) {
        const restoredComment = em.create(CustomerComment, {
          id: comment.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          entity,
          body: comment.body,
          authorUserId: comment.authorUserId,
          appearanceIcon: comment.appearanceIcon,
          appearanceColor: comment.appearanceColor,
          deal: comment.dealId ? dealMap.get(comment.dealId) ?? null : null,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          deletedAt: comment.deletedAt,
        })
        em.persist(restoredComment)
      }
      await em.flush()

      await em.nativeDelete(CustomerAddress, { entity })
      for (const address of beforeAddresses) {
        const restoredAddress = em.create(CustomerAddress, {
          id: address.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          entity,
          name: address.name,
          purpose: address.purpose,
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2,
          city: address.city,
          region: address.region,
          postalCode: address.postalCode,
          country: address.country,
          latitude: address.latitude,
          longitude: address.longitude,
          isPrimary: address.isPrimary,
        })
        em.persist(restoredAddress)
      }
      await em.flush()

      await em.nativeDelete(CustomerTodoLink, { entity })
      for (const todo of beforeTodos) {
        const restoredTodo = em.create(CustomerTodoLink, {
          id: todo.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          entity,
          todoId: todo.todoId,
          todoSource: todo.todoSource,
          createdAt: todo.createdAt,
          createdByUserId: todo.createdByUserId,
        })
        em.persist(restoredTodo)
      }
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity,
        identifiers: {
          id: profile.id ?? entity.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
        },
        indexer: companyCrudIndexer,
        events: companyCrudEvents,
      })

      const childUpserts: QueryIndexEventEntry[] = []
      for (const activity of beforeActivities ?? []) {
        childUpserts.push({
          entityType: E.customers.customer_activity,
          recordId: activity.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      for (const comment of beforeComments ?? []) {
        childUpserts.push({
          entityType: E.customers.customer_comment,
          recordId: comment.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      for (const address of beforeAddresses ?? []) {
        childUpserts.push({
          entityType: E.customers.customer_address,
          recordId: address.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      for (const todo of beforeTodos ?? []) {
        childUpserts.push({
          entityType: E.customers.customer_todo_link,
          recordId: todo.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      const memberUpserts: QueryIndexEventEntry[] = []
      for (const member of beforeMembers ?? []) {
        if (member.profileId) {
          memberUpserts.push({
            entityType: E.customers.customer_person_profile,
            recordId: member.profileId,
            tenantId: entity.tenantId,
            organizationId: entity.organizationId,
          })
        }
      }
      const dealUpserts: QueryIndexEventEntry[] = []
      for (const deal of beforeDeals ?? []) {
        if (deal.dealId) {
          dealUpserts.push({
            entityType: E.customers.customer_deal,
            recordId: deal.dealId,
            tenantId: entity.tenantId,
            organizationId: entity.organizationId,
          })
        }
      }

      const resetValues = buildCustomFieldResetMap(before.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCompanyCustomFields(ctx, profile.id, entity.organizationId, entity.tenantId, resetValues)
      }
      await emitQueryIndexUpsertEvents(ctx, childUpserts)
      await emitQueryIndexUpsertEvents(ctx, memberUpserts)
      await emitQueryIndexUpsertEvents(ctx, dealUpserts)
    },
  }

registerCommand(createCompanyCommand)
registerCommand(updateCompanyCommand)
registerCommand(deleteCompanyCommand)
