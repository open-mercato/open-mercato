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
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerAddress,
  CustomerComment,
  CustomerEntity,
  CustomerPersonProfile,
  CustomerTagAssignment,
} from '../data/entities'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import {
  personCreateSchema,
  personUpdateSchema,
  type PersonCreateInput,
  type PersonUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  assertRecordFound,
  syncEntityTags,
  loadEntityTagIds,
  ensureDictionaryEntry,
} from './shared'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  loadCustomFieldSnapshot,
  diffCustomFieldChanges,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'

const PERSON_ENTITY_ID = 'customers:customer_person_profile'
const CUSTOMER_ENTITY_ID = 'customers:customer_entity'

type PersonAddressSnapshot = {
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

type PersonCommentSnapshot = {
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

type PersonSnapshot = {
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
    firstName: string | null
    lastName: string | null
    preferredName: string | null
    jobTitle: string | null
    department: string | null
    seniority: string | null
    timezone: string | null
    linkedInUrl: string | null
    twitterUrl: string | null
    companyEntityId: string | null
  }
  tagIds: string[]
  addresses: PersonAddressSnapshot[]
  comments: PersonCommentSnapshot[]
  custom?: Record<string, unknown>
}

type PersonUndoPayload = {
  before?: PersonSnapshot | null
  after?: PersonSnapshot | null
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

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value)
  return normalized ? normalized.toLowerCase() : null
}

function serializePersonSnapshot(
  entity: CustomerEntity,
  profile: CustomerPersonProfile,
  tagIds: string[],
  addresses: CustomerAddress[],
  comments: CustomerComment[],
  custom?: Record<string, unknown>
): PersonSnapshot {
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
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      preferredName: profile.preferredName ?? null,
      jobTitle: profile.jobTitle ?? null,
      department: profile.department ?? null,
      seniority: profile.seniority ?? null,
      timezone: profile.timezone ?? null,
      linkedInUrl: profile.linkedInUrl ?? null,
      twitterUrl: profile.twitterUrl ?? null,
      companyEntityId: profile.company
        ? typeof profile.company === 'string'
          ? profile.company
          : profile.company.id
        : null,
    },
    tagIds,
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
    custom,
  }
}

async function loadPersonSnapshot(em: EntityManager, entityId: string): Promise<PersonSnapshot | null> {
  const entity = await em.findOne(CustomerEntity, { id: entityId, deletedAt: null })
  if (!entity || entity.kind !== 'person') return null
  const profile = await em.findOne(CustomerPersonProfile, { entity: entity }, { populate: ['company'] })
  if (!profile) return null
  const tagIds = await loadEntityTagIds(em, entity)
  const addresses = await em.find(CustomerAddress, { entity }, { orderBy: { createdAt: 'asc' } })
  const comments = await em.find(CustomerComment, { entity }, { orderBy: { createdAt: 'asc' }, populate: ['deal'] })
  const entityCustom = await loadCustomFieldSnapshot(em, {
    entityId: CUSTOMER_ENTITY_ID,
    recordId: entity.id,
    tenantId: entity.tenantId,
    organizationId: entity.organizationId,
  })
  const profileCustom = await loadCustomFieldSnapshot(em, {
    entityId: PERSON_ENTITY_ID,
    recordId: profile.id,
    tenantId: entity.tenantId,
    organizationId: entity.organizationId,
  })
  const custom = { ...entityCustom, ...profileCustom }
  return serializePersonSnapshot(entity, profile, tagIds, addresses, comments, custom)
}

async function resolveCompanyReference(
  em: EntityManager,
  companyId: string | null | undefined,
  organizationId: string,
  tenantId: string
): Promise<CustomerEntity | null> {
  if (!companyId) return null
  const company = await em.findOne(CustomerEntity, { id: companyId, kind: 'company', deletedAt: null })
  if (!company) {
    throw new CrudHttpError(400, { error: 'Company not found' })
  }
  if (company.organizationId !== organizationId || company.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cannot link person to company outside current scope' })
  }
  return company
}

type DefinitionScore = { base: number; penalty: number; entityIndex: number }

function normalizeCustomFieldConfig(raw: unknown): Record<string, any> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object') {
    return { ...(raw as Record<string, any>) }
  }
  return {}
}

function scoreDefinition(kind: string, cfg: Record<string, any>, entityIndex: number): DefinitionScore {
  const listVisibleScore = cfg.listVisible === false ? 0 : 1
  const formEditableScore = cfg.formEditable === false ? 0 : 1
  const filterableScore = cfg.filterable ? 1 : 0
  const kindScore = (() => {
    switch (kind) {
      case 'dictionary':
        return 8
      case 'relation':
        return 6
      case 'select':
        return 4
      case 'multiline':
        return 3
      case 'boolean':
      case 'integer':
      case 'float':
        return 2
      default:
        return 1
    }
  })()
  const optionsBonus = Array.isArray(cfg.options) && cfg.options.length ? 2 : 0
  const dictionaryBonus =
    typeof cfg.dictionaryId === 'string' && cfg.dictionaryId.trim().length ? 5 : 0
  const base = (listVisibleScore * 16) + (formEditableScore * 8) + (filterableScore * 4) + kindScore + optionsBonus + dictionaryBonus
  const penalty = typeof cfg.priority === 'number' ? cfg.priority : 0
  return { base, penalty, entityIndex }
}

async function resolvePersonCustomFieldRouting(
  em: EntityManager,
  tenantId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<Map<string, string>> {
  const entityIds = [CUSTOMER_ENTITY_ID, PERSON_ENTITY_ID]
  const scopeClauses: any[] = []
  if (tenantId) scopeClauses.push({ $or: [{ tenantId }, { tenantId: null }] })
  else scopeClauses.push({ tenantId: null })
  if (organizationId) scopeClauses.push({ $or: [{ organizationId }, { organizationId: null }] })
  const where: Record<string, any> = {
    entityId: { $in: entityIds as any },
    deletedAt: null,
    isActive: true,
  }
  if (scopeClauses.length) where.$and = scopeClauses

  const defs = await em.find(CustomFieldDef, where as any)
  const order = new Map<string, number>()
  entityIds.forEach((id, index) => order.set(id, index))

  const bestByKey = new Map<string, { entityId: string; metrics: DefinitionScore }>()
  for (const def of defs) {
    const cfg = normalizeCustomFieldConfig((def as any).configJson)
    const metrics = scoreDefinition(def.kind, cfg, order.get(def.entityId) ?? Number.MAX_SAFE_INTEGER)
    const existing = bestByKey.get(def.key)
    const better = !existing ||
      metrics.base > existing.metrics.base ||
      (metrics.base === existing.metrics.base && (
        metrics.penalty < existing.metrics.penalty ||
        (metrics.penalty === existing.metrics.penalty && metrics.entityIndex < existing.metrics.entityIndex)
      ))
    if (better) {
      bestByKey.set(def.key, { entityId: def.entityId, metrics })
    }
  }

  const routing = new Map<string, string>()
  for (const [key, entry] of bestByKey.entries()) {
    routing.set(key, entry.entityId)
  }
  return routing
}

async function setCustomFieldsForPerson(
  ctx: CommandRuntimeContext,
  entityId: string,
  profileId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>
): Promise<void> {
  if (!values || !Object.keys(values).length) return
  const em = ctx.container.resolve<EntityManager>('em')
  const routing = await resolvePersonCustomFieldRouting(em, tenantId, organizationId)
  const entityScoped: Record<string, unknown> = {}
  const profileScoped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const target = routing.get(key) ?? PERSON_ENTITY_ID
    if (target === CUSTOMER_ENTITY_ID) entityScoped[key] = value
    else profileScoped[key] = value
  }

  const de = ctx.container.resolve<DataEngine>('dataEngine')
  if (Object.keys(entityScoped).length) {
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: CUSTOMER_ENTITY_ID,
      recordId: entityId,
      organizationId,
      tenantId,
      values: entityScoped,
      notify: true,
    })
  }
  if (Object.keys(profileScoped).length) {
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: PERSON_ENTITY_ID,
      recordId: profileId,
      organizationId,
      tenantId,
      values: profileScoped,
      notify: true,
    })
  }
}

const createPersonCommand: CommandHandler<PersonCreateInput, { entityId: string; personId: string }> = {
  id: 'customers.people.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(personCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const firstName = parsed.firstName.trim()
    const lastName = parsed.lastName.trim()
    const description = normalizeOptionalString(parsed.description)
    const primaryEmail = normalizeEmail(parsed.primaryEmail)
    const primaryPhone = normalizeOptionalString(parsed.primaryPhone)
    const status = normalizeOptionalString(parsed.status)
    const lifecycleStage = normalizeOptionalString(parsed.lifecycleStage)
    const source = normalizeOptionalString(parsed.source)
    const preferredName = normalizeOptionalString(parsed.preferredName)
    const jobTitle = normalizeOptionalString(parsed.jobTitle)
    const department = normalizeOptionalString(parsed.department)
    const seniority = normalizeOptionalString(parsed.seniority)
    const timezone = normalizeOptionalString(parsed.timezone)
    const linkedInUrl = normalizeOptionalString(parsed.linkedInUrl)
    const twitterUrl = normalizeOptionalString(parsed.twitterUrl)
    const displayName = parsed.displayName.trim()
    const nextInteractionName = parsed.nextInteraction?.name ? parsed.nextInteraction.name.trim() : null
    const nextInteractionRefId = normalizeOptionalString(parsed.nextInteraction?.refId)
    const nextInteractionIcon = normalizeOptionalString(parsed.nextInteraction?.icon)
    const nextInteractionColor = normalizeHexColor(parsed.nextInteraction?.color)
    if (!displayName) {
      throw new CrudHttpError(400, { error: 'Display name is required' })
    }

    const entity = em.create(CustomerEntity, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      kind: 'person',
      displayName,
      description,
      ownerUserId: parsed.ownerUserId ?? null,
      primaryEmail,
      primaryPhone,
      status,
      lifecycleStage,
      source,
      nextInteractionAt: parsed.nextInteraction?.at ?? null,
      nextInteractionName,
      nextInteractionRefId,
      nextInteractionIcon,
      nextInteractionColor,
      isActive: parsed.isActive ?? true,
    })

    const company = await resolveCompanyReference(em, parsed.companyEntityId ?? null, parsed.organizationId, parsed.tenantId)

    const profile = em.create(CustomerPersonProfile, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      entity,
      firstName,
      lastName,
      preferredName,
      jobTitle,
      department,
      seniority,
      timezone,
      linkedInUrl,
      twitterUrl,
      company,
    })

    em.persist(entity)
    em.persist(profile)
    if (status) {
      await ensureDictionaryEntry(em, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        kind: 'status',
        value: status,
      })
    }
    if (source) {
      await ensureDictionaryEntry(em, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        kind: 'source',
        value: source,
      })
    }
    await em.flush()

    const tenantId = entity.tenantId
    const organizationId = entity.organizationId
    await syncEntityTags(em, entity, parsed.tags)
    await em.flush()
    await setCustomFieldsForPerson(ctx, entity.id, profile.id, organizationId, tenantId, custom)

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity,
      identifiers: {
        id: entity.id,
        tenantId,
        organizationId,
      },
    })

    return { entityId: entity.id, personId: profile.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return await loadPersonSnapshot(em, result.entityId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadPersonSnapshot(em, result.entityId)
    return {
      actionLabel: translate('customers.audit.people.create', 'Create person'),
      resourceKind: 'customers.person',
      resourceId: result.entityId,
      tenantId: snapshot?.entity.tenantId ?? null,
      organizationId: snapshot?.entity.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonUndoPayload>(logEntry) ?? null
    const entityId = logEntry?.resourceId ?? payload?.after?.entity.id ?? null
    if (!entityId) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const entity = await em.findOne(CustomerEntity, { id: entityId })
    if (!entity) return
    const profile = await em.findOne(CustomerPersonProfile, { entity })
    await em.nativeDelete(CustomerTagAssignment, { entity })
    if (profile) {
      await em.remove(profile).flush()
    }
    await em.remove(entity).flush()
  },
}

const updatePersonCommand: CommandHandler<PersonUpdateInput, { entityId: string }> = {
  id: 'customers.people.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(personUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadPersonSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(personUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const entity = await em.findOne(CustomerEntity, { id: parsed.id, deletedAt: null })
    const record = assertRecordFound(entity, 'Person not found')
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const profile = await em.findOne(CustomerPersonProfile, { entity: record })
    if (!profile) throw new CrudHttpError(404, { error: 'Person profile not found' })

    if (parsed.description !== undefined) record.description = normalizeOptionalString(parsed.description)
    if (parsed.ownerUserId !== undefined) record.ownerUserId = parsed.ownerUserId ?? null
    if (parsed.primaryEmail !== undefined) record.primaryEmail = normalizeEmail(parsed.primaryEmail)
    if (parsed.primaryPhone !== undefined) record.primaryPhone = normalizeOptionalString(parsed.primaryPhone)
    if (parsed.status !== undefined) {
      const normalizedStatus = normalizeOptionalString(parsed.status)
      record.status = normalizedStatus
      if (normalizedStatus) {
        await ensureDictionaryEntry(em, {
          tenantId: record.tenantId,
          organizationId: record.organizationId,
          kind: 'status',
          value: normalizedStatus,
        })
      }
    }
    if (parsed.lifecycleStage !== undefined) record.lifecycleStage = normalizeOptionalString(parsed.lifecycleStage)
    if (parsed.source !== undefined) {
      const normalizedSource = normalizeOptionalString(parsed.source)
      record.source = normalizedSource
      if (normalizedSource) {
        await ensureDictionaryEntry(em, {
          tenantId: record.tenantId,
          organizationId: record.organizationId,
          kind: 'source',
          value: normalizedSource,
        })
      }
    }
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

    if (parsed.firstName !== undefined) profile.firstName = normalizeOptionalString(parsed.firstName)
    if (parsed.lastName !== undefined) profile.lastName = normalizeOptionalString(parsed.lastName)
    if (parsed.preferredName !== undefined) profile.preferredName = normalizeOptionalString(parsed.preferredName)
    if (parsed.jobTitle !== undefined) profile.jobTitle = normalizeOptionalString(parsed.jobTitle)
    if (parsed.department !== undefined) profile.department = normalizeOptionalString(parsed.department)
    if (parsed.seniority !== undefined) profile.seniority = normalizeOptionalString(parsed.seniority)
    if (parsed.timezone !== undefined) profile.timezone = normalizeOptionalString(parsed.timezone)
    if (parsed.linkedInUrl !== undefined) profile.linkedInUrl = normalizeOptionalString(parsed.linkedInUrl)
    if (parsed.twitterUrl !== undefined) profile.twitterUrl = normalizeOptionalString(parsed.twitterUrl)

    if (parsed.companyEntityId !== undefined) {
      profile.company = await resolveCompanyReference(em, parsed.companyEntityId, record.organizationId, record.tenantId)
    }

    if (parsed.displayName !== undefined) {
      const nextDisplayName = parsed.displayName.trim()
      if (!nextDisplayName) {
        throw new CrudHttpError(400, { error: 'Display name is required' })
      }
      record.displayName = nextDisplayName
    }

    await syncEntityTags(em, record, parsed.tags)
    await em.flush()

    await setCustomFieldsForPerson(ctx, record.id, profile.id, record.organizationId, record.tenantId, custom)

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
      },
    })

    return { entityId: record.id }
  },
  buildLog: async ({ ctx, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PersonSnapshot | undefined
    if (!before) return null
    const em = ctx.container.resolve<EntityManager>('em')
    const afterSnapshot = await loadPersonSnapshot(em, before.entity.id)
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
      actionLabel: translate('customers.audit.people.update', 'Update person'),
      resourceKind: 'customers.person',
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
        } satisfies PersonUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const entity = await em.findOne(CustomerEntity, { id: before.entity.id })
    if (!entity) {
      const newEntity = em.create(CustomerEntity, {
        id: before.entity.id,
        organizationId: before.entity.organizationId,
        tenantId: before.entity.tenantId,
        kind: 'person',
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
      em.persist(newEntity)
      const profile = em.create(CustomerPersonProfile, {
        id: before.profile.id,
        organizationId: before.entity.organizationId,
        tenantId: before.entity.tenantId,
        entity: newEntity,
        firstName: before.profile.firstName,
        lastName: before.profile.lastName,
        preferredName: before.profile.preferredName,
        jobTitle: before.profile.jobTitle,
        department: before.profile.department,
        seniority: before.profile.seniority,
        timezone: before.profile.timezone,
        linkedInUrl: before.profile.linkedInUrl,
        twitterUrl: before.profile.twitterUrl,
      })
      em.persist(profile)
      if (before.profile.companyEntityId) {
        profile.company = await resolveCompanyReference(
          em,
          before.profile.companyEntityId,
          before.entity.organizationId,
          before.entity.tenantId
        )
      }
      await em.flush()
      await syncEntityTags(em, newEntity, before.tagIds)
      await em.flush()
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
      const profile = await em.findOne(CustomerPersonProfile, { entity })
      if (profile) {
        profile.firstName = before.profile.firstName
        profile.lastName = before.profile.lastName
        profile.preferredName = before.profile.preferredName
        profile.jobTitle = before.profile.jobTitle
        profile.department = before.profile.department
        profile.seniority = before.profile.seniority
        profile.timezone = before.profile.timezone
        profile.linkedInUrl = before.profile.linkedInUrl
        profile.twitterUrl = before.profile.twitterUrl
        profile.company = before.profile.companyEntityId
          ? await resolveCompanyReference(
              em,
              before.profile.companyEntityId,
              before.entity.organizationId,
              before.entity.tenantId
            )
          : null
      }
      await syncEntityTags(em, entity, before.tagIds)
      await em.flush()
    }

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: await em.findOne(CustomerEntity, { id: before.entity.id }),
      identifiers: {
        id: before.entity.id,
        organizationId: before.entity.organizationId,
        tenantId: before.entity.tenantId,
      },
    })

    const resetValues = buildCustomFieldResetMap(before.custom, payload?.after?.custom)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsForPerson(ctx, before.entity.id, before.profile.id, before.entity.organizationId, before.entity.tenantId, resetValues)
    }
  },
}

const deletePersonCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { entityId: string }> =
  {
    id: 'customers.people.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Person id required')
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadPersonSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Person id required')
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const entity = await em.findOne(CustomerEntity, { id, deletedAt: null })
      const record = assertRecordFound(entity, 'Person not found')
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      const profile = await em.findOne(CustomerPersonProfile, { entity: record })
      if (profile) em.remove(profile)
      await em.nativeDelete(CustomerAddress, { entity: record })
      await em.nativeDelete(CustomerComment, { entity: record })
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
      })
      return { entityId: record.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as PersonSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.people.delete', 'Delete person'),
        resourceKind: 'customers.person',
        resourceId: before.entity.id,
        tenantId: before.entity.tenantId,
        organizationId: before.entity.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies PersonUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<PersonUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      let entity = await em.findOne(CustomerEntity, { id: before.entity.id })
      if (!entity) {
        entity = em.create(CustomerEntity, {
          id: before.entity.id,
          organizationId: before.entity.organizationId,
          tenantId: before.entity.tenantId,
          kind: 'person',
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

      let profile = await em.findOne(CustomerPersonProfile, { entity })
      if (!profile) {
        profile = em.create(CustomerPersonProfile, {
          id: before.profile.id,
          organizationId: before.entity.organizationId,
          tenantId: before.entity.tenantId,
          entity,
          firstName: before.profile.firstName,
          lastName: before.profile.lastName,
          preferredName: before.profile.preferredName,
          jobTitle: before.profile.jobTitle,
          department: before.profile.department,
          seniority: before.profile.seniority,
          timezone: before.profile.timezone,
          linkedInUrl: before.profile.linkedInUrl,
          twitterUrl: before.profile.twitterUrl,
        })
      } else {
        profile.firstName = before.profile.firstName
        profile.lastName = before.profile.lastName
        profile.preferredName = before.profile.preferredName
        profile.jobTitle = before.profile.jobTitle
        profile.department = before.profile.department
        profile.seniority = before.profile.seniority
        profile.timezone = before.profile.timezone
        profile.linkedInUrl = before.profile.linkedInUrl
        profile.twitterUrl = before.profile.twitterUrl
      }

      if (before.profile.companyEntityId) {
        profile.company = await resolveCompanyReference(
          em,
          before.profile.companyEntityId,
          before.entity.organizationId,
          before.entity.tenantId
        )
      } else {
        profile.company = null
      }

      await em.flush()
      await syncEntityTags(em, entity, before.tagIds)
      await em.flush()

      await em.nativeDelete(CustomerComment, { entity })
      for (const comment of before.comments) {
        const restoredComment = em.create(CustomerComment, {
          id: comment.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          entity,
          body: comment.body,
          authorUserId: comment.authorUserId,
          deal: comment.dealId ?? null,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          deletedAt: comment.deletedAt,
        })
        em.persist(restoredComment)
      }
      await em.flush()

      await em.nativeDelete(CustomerAddress, { entity })
      for (const address of before.addresses) {
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
        await setCustomFieldsForPerson(ctx, entity.id, profile.id, entity.organizationId, entity.tenantId, resetValues)
      }
    },
  }

registerCommand(createPersonCommand)
registerCommand(updatePersonCommand)
registerCommand(deletePersonCommand)
