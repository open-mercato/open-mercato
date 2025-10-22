import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
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
import { CustomerCompanyProfile, CustomerEntity, CustomerTagAssignment } from '../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
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
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  loadCustomFieldSnapshot,
  diffCustomFieldChanges,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'

const COMPANY_ENTITY_ID = 'customers:customer_company_profile'

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
}

type CompanyUndoPayload = {
  before?: CompanySnapshot | null
  after?: CompanySnapshot | null
}

const customerEntityIndexer: CrudIndexerConfig<CustomerEntity> = {
  entityType: E.customers.customer_entity,
  buildUpsertPayload: (ctx) => ({
    entityType: E.customers.customer_entity,
    recordId: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
  buildDeletePayload: (ctx) => ({
    entityType: E.customers.customer_entity,
    recordId: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

async function loadCompanySnapshot(em: EntityManager, id: string): Promise<CompanySnapshot | null> {
  const entity = await em.findOne(CustomerEntity, { id, deletedAt: null })
  if (!entity || entity.kind !== 'company') return null
  const profile = await em.findOne(CustomerCompanyProfile, { entity })
  if (!profile) return null
  const tagIds = await loadEntityTagIds(em, entity)
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
  const de = ctx.container.resolve<DataEngine>('dataEngine')
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

    const em = ctx.container.resolve<EntityManager>('em').fork()
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

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity,
      identifiers: {
        id: entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
      indexer: customerEntityIndexer,
    })

    return { entityId: entity.id, companyId: profile.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return await loadCompanySnapshot(em, result.entityId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em')
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
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
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadCompanySnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(companyUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
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

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: customerEntityIndexer,
    })

    return { entityId: record.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as CompanySnapshot | undefined
    if (!before) return null
    const em = ctx.container.resolve<EntityManager>('em')
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
    const em = ctx.container.resolve<EntityManager>('em').fork()
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

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity,
      identifiers: {
        id: entity.id,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      },
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
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadCompanySnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Company id required')
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const entity = await em.findOne(CustomerEntity, { id, deletedAt: null })
      const record = assertRecordFound(entity, 'Company not found')
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      await em.nativeDelete(CustomerCompanyProfile, { entity: record })
      await em.nativeDelete(CustomerTagAssignment, { entity: record })
      em.remove(record)
      await em.flush()

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
        indexer: customerEntityIndexer,
      })
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
      const em = ctx.container.resolve<EntityManager>('em').fork()
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

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity,
        identifiers: {
          id: entity.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
        },
      })

      const resetValues = buildCustomFieldResetMap(before.custom, null)
      if (Object.keys(resetValues).length) {
        await setCompanyCustomFields(ctx, profile.id, entity.organizationId, entity.tenantId, resetValues)
      }
    },
  }

registerCommand(createCompanyCommand)
registerCommand(updateCompanyCommand)
registerCommand(deleteCompanyCommand)
