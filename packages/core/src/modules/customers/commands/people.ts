import { redactRestoredNextInteractionName } from '../lib/interactionProjection'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
  snapshotsEqual,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import {
  CustomerAddress,
  CustomerComment,
  CustomerActivity,
  CustomerInteraction,
  CustomerEmailConversationShare,
  CustomerDeal,
  CustomerDealPersonLink,
  CustomerPersonCompanyLink,
  CustomerTodoLink,
  CustomerEntity,
  CustomerPersonProfile,
  CustomerTagAssignment,
} from '../data/entities'
import {
  captureInteractionRestoreDetails,
  omitInteractionRestoreDetails,
  restoreInteractionRestoreDetails,
  type InteractionRestoreDetails,
} from './interactionRestoreDetails'
import {
  labelAssignmentIndexEntries,
  removeEntityLabelAssignments,
  restoreEntityLabelAssignments,
  type LabelAssignmentRestoreSnapshot,
} from './entityLabelAssignments'
import {
  removeCustomerDeleteDependencies,
  restoreCustomerDeleteDependencies,
  type CustomerDeleteDependenciesSnapshot,
} from './entityDeleteDependencies'
import { resolvePersonCustomFieldRouting, CUSTOMER_ENTITY_ID, PERSON_ENTITY_ID } from '../lib/customFieldRouting'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import {
  personCreateSchema,
  personUpdateSchema,
  type PersonCreateInput,
  type PersonUpdateInput,
} from '../data/validators'
import {
  findScopedCustomerCommandRecord,
  findScopedCustomerCommandTarget,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  CUSTOMER_ENTITY_UNDO_DATE_OPTIONS,
  assertFound,
  syncEntityTags,
  loadEntityTagIds,
  shouldBumpOptimisticLockVersion,
  ensureDictionaryEntry,
  invalidateDictionaryKindCaches,
  emitQueryIndexDeleteEvents,
  emitQueryIndexUpsertEvents,
  type QueryIndexEventEntry,
} from './shared'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { CrudHttpError, conflict, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { deriveDisplayName, isDerivedDisplayName } from '../lib/displayName'
import {
  loadPersonCompanyLinks,
  summarizePersonCompanies,
  syncLegacyPrimaryCompanyLink,
} from '../lib/personCompanies'
import { filterActivePersonCompanyLinks } from '../lib/personCompanyLinkTable'

const INTERACTION_ENTITY_ID = 'customers:customer_interaction'
const EMPLOYMENT_CHANGED = 'customers.errors.person_company_employment_changed'

type PersonAddressSnapshot = {
  id: string
  name: string | null
  purpose: string | null
  companyName?: string | null
  addressLine1: string
  addressLine2: string | null
  buildingNumber?: string | null
  flatNumber?: string | null
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

type PersonActivitySnapshot = {
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

type PersonTodoSnapshot = {
  id: string
  todoId: string
  todoSource: string
  createdAt: Date
  createdByUserId: string | null
}

type PersonInteractionSnapshot = {
  id: string
  interactionType: string
  title: string | null
  body: string | null
  status: string
  scheduledAt: Date | null
  timezone?: string | null
  occurredAt: Date | null
  priority: number | null
  authorUserId: string | null
  ownerUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  source: string | null
  dealId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  custom?: Record<string, unknown>
} & InteractionRestoreDetails

type PersonEmailConversationShareSnapshot = {
  id: string
  ownerUserId: string
  sharedByUserId: string
  createdAt: Date
  updatedAt: Date | null
  deletedAt: Date | null
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
  companies: Array<{
    linkId: string | null
    companyId: string
    displayName: string
    isPrimary: boolean
  }>
  companyEmploymentLinks?: Array<{
    id: string
    companyId: string
    employmentStatus: CustomerPersonCompanyLink['employmentStatus']
    employmentEndedOn: string
    createdAt: string
    updatedAt: string
  }>
  tagIds: string[]
  addresses: PersonAddressSnapshot[]
  comments: PersonCommentSnapshot[]
  custom?: Record<string, unknown>
  deals: Array<{
    id: string
    dealId: string
    participantRole: string | null
    isPrimary?: boolean
    createdAt: Date
  }>
  activities: PersonActivitySnapshot[]
  todos: PersonTodoSnapshot[]
  interactions: PersonInteractionSnapshot[]
  emailConversationShares?: PersonEmailConversationShareSnapshot[]
}

type PersonUndoPayload = {
  before?: PersonSnapshot | null
  after?: PersonSnapshot | null
  labelAssignments?: LabelAssignmentRestoreSnapshot[]
  dependencies?: CustomerDeleteDependenciesSnapshot
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
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }),
}

function personEntityIndexEntry(entity: CustomerEntity): QueryIndexEventEntry {
  return {
    entityType: E.customers.customer_entity,
    recordId: entity.id,
    tenantId: entity.tenantId,
    organizationId: entity.organizationId,
  }
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

type PersonDeleteBlockerCounts = {
  dealLinks: number
}

function buildPersonHasDependentsError(
  translate: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
  counts: PersonDeleteBlockerCounts,
): CrudHttpError {
  const blockers: string[] = []
  if (counts.dealLinks > 0) {
    blockers.push(
      translate('customers.people.delete.blockers.deals', 'linked deals ({{count}})', { count: counts.dealLinks }),
    )
  }
  const summary = blockers.join(', ')
  const message = translate(
    'customers.people.delete.blocked',
    'Cannot delete person: {{blockers}}. Please unlink or reassign first.',
    { blockers: summary },
  )
  return new CrudHttpError(422, { error: message, code: 'PERSON_HAS_DEPENDENTS' })
}

function serializePersonSnapshot(
  entity: CustomerEntity,
  profile: CustomerPersonProfile,
  tagIds: string[],
  addresses: CustomerAddress[],
  comments: CustomerComment[],
  deals: CustomerDealPersonLink[],
  activities: CustomerActivity[],
  todoLinks: CustomerTodoLink[],
  interactions: Array<PersonInteractionSnapshot>,
  custom?: Record<string, unknown>
): PersonSnapshot {
  const companies = summarizePersonCompanies(profile, [])
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
    companies,
    tagIds,
    addresses: addresses.map((address) => ({
      id: address.id,
      name: address.name ?? null,
      purpose: address.purpose ?? null,
      companyName: address.companyName ?? null,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      buildingNumber: address.buildingNumber ?? null,
      flatNumber: address.flatNumber ?? null,
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
    deals: deals
      .filter((link) => link.deal)
      .map((link) => ({
        id: link.id,
        dealId: link.deal.id,
        participantRole: link.participantRole ?? null,
        isPrimary: link.isPrimary === true,
        createdAt: link.createdAt,
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
    interactions,
    custom,
  }
}

async function lockPersonRow(em: EntityManager, entity: CustomerEntity): Promise<void> {
  await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: entity.id, tenantId: entity.tenantId, organizationId: entity.organizationId },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    { tenantId: entity.tenantId, organizationId: entity.organizationId },
  )
}

async function loadPersonSnapshot(
  em: EntityManager,
  entityId: string,
  ctx: CommandRuntimeContext,
  options: { includeInteractionRestoreDetails?: boolean } = {},
): Promise<PersonSnapshot | null> {
  const entity = await findScopedCustomerCommandTarget(
    em,
    CustomerEntity,
    { id: entityId, deletedAt: null },
    undefined,
    ctx,
  )
  if (!entity || entity.kind !== 'person') return null
  ensureTenantScope(ctx, entity.tenantId)
  ensureOrganizationScope(ctx, entity.organizationId)
  const scope = { tenantId: entity.tenantId, organizationId: entity.organizationId }
  const profile = await findOneWithDecryption(
    em,
    CustomerPersonProfile,
    { entity, ...scope },
    { populate: ['company'] },
    scope,
  )
  if (!profile) return null
  const companyLinks = await loadPersonCompanyLinks(em, entity, { includeEnded: true })
  const tagIds = await loadEntityTagIds(em, entity)
  const addresses = await findWithDecryption(
    em,
    CustomerAddress,
    { entity, ...scope },
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
  const comments = await findWithDecryption(
    em,
    CustomerComment,
    { entity, ...scope },
    { orderBy: { createdAt: 'asc' }, populate: ['deal'] },
    scope,
  )
  const deals = await findWithDecryption(
    em,
    CustomerDealPersonLink,
    { person: entity, deal: scope },
    { orderBy: { createdAt: 'asc' }, populate: ['deal'] },
    scope,
  )
  const activities = await findWithDecryption(
    em,
    CustomerActivity,
    { entity, ...scope },
    { orderBy: { createdAt: 'asc' }, populate: ['deal'] },
    scope,
  )
  const todoLinks = await em.find(CustomerTodoLink, { entity, ...scope }, { orderBy: { createdAt: 'asc' } })
  const interactions = await findWithDecryption(
    em,
    CustomerInteraction,
    { entity, ...scope },
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
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
  const routing = await resolvePersonCustomFieldRouting(em, entity.tenantId, entity.organizationId)
  const custom: Record<string, unknown> = { ...entityCustom }
  for (const [key, value] of Object.entries(profileCustom)) {
    const target = routing.get(key)
    if (target === CUSTOMER_ENTITY_ID && Object.prototype.hasOwnProperty.call(custom, key)) continue
    custom[key] = value
  }
  const interactionSnapshots = await Promise.all(
    interactions.map(async (interaction) => ({
      id: interaction.id,
      interactionType: interaction.interactionType,
      title: interaction.title ?? null,
      body: interaction.body ?? null,
      status: interaction.status,
      scheduledAt: interaction.scheduledAt ?? null,
      timezone: interaction.timezone ?? null,
      occurredAt: interaction.occurredAt ?? null,
      priority: interaction.priority ?? null,
      authorUserId: interaction.authorUserId ?? null,
      ownerUserId: interaction.ownerUserId ?? null,
      appearanceIcon: interaction.appearanceIcon ?? null,
      appearanceColor: interaction.appearanceColor ?? null,
      source: interaction.source ?? null,
      dealId: interaction.dealId ?? null,
      createdAt: interaction.createdAt,
      updatedAt: interaction.updatedAt,
      deletedAt: interaction.deletedAt ?? null,
      ...(options.includeInteractionRestoreDetails ? captureInteractionRestoreDetails(interaction) : {}),
      custom: await loadCustomFieldSnapshot(em, {
        entityId: INTERACTION_ENTITY_ID,
        recordId: interaction.id,
        tenantId: entity.tenantId,
        organizationId: entity.organizationId,
      }),
    })),
  )
  const snapshot = serializePersonSnapshot(entity, profile, tagIds, addresses, comments, deals, activities, todoLinks, interactionSnapshots, custom)
  return { ...snapshot, ...capturePersonCompanyAssignments(profile, companyLinks) }
}

function capturePersonCompanyAssignments(
  profile: CustomerPersonProfile,
  companyLinks: CustomerPersonCompanyLink[],
): Pick<PersonSnapshot, 'companies' | 'companyEmploymentLinks'> {
  const companies = summarizePersonCompanies(profile, filterActivePersonCompanyLinks(companyLinks))
  const employmentLinks = companyLinks.flatMap((link) => {
    if (!link.employmentEndedOn) return []
    return [{
      id: link.id,
      companyId: typeof link.company === 'string' ? link.company : link.company.id,
      employmentStatus: link.employmentStatus,
      employmentEndedOn: link.employmentEndedOn,
      createdAt: link.createdAt.toISOString(),
      updatedAt: link.updatedAt.toISOString(),
    }]
  })
  return { companies, companyEmploymentLinks: employmentLinks.length ? employmentLinks : undefined }
}

async function restoreEndedPersonCompanyLinks(
  em: EntityManager,
  person: CustomerEntity,
  snapshots: PersonSnapshot['companyEmploymentLinks'],
): Promise<void> {
  const ended = snapshots?.filter((link) => link.employmentStatus === 'ended') ?? []
  if (ended.length === 0) return
  const scope = { tenantId: person.tenantId, organizationId: person.organizationId }
  const companies = await findWithDecryption(
    em,
    CustomerEntity,
    { id: { $in: ended.map((link) => link.companyId) }, kind: 'company', deletedAt: null, ...scope },
    undefined,
    scope,
  )
  const companiesById = new Map(companies.map((company) => [company.id, company]))
  for (const link of ended) {
    const company = companiesById.get(link.companyId)
    if (!company) continue
    em.persist(em.create(CustomerPersonCompanyLink, {
      id: link.id,
      person,
      company,
      ...scope,
      isPrimary: false,
      employmentStatus: 'ended',
      employmentEndedOn: link.employmentEndedOn,
      createdAt: new Date(link.createdAt),
    }))
  }
}

function resolvePersonCompanyUpdate(before: PersonSnapshot, after: PersonSnapshot | null | undefined, input: unknown) {
  const commandInput = input && typeof input === 'object' && '__redoInput' in input ? input.__redoInput : input
  const originalInput = commandInput && typeof commandInput === 'object' && 'id' in commandInput ? commandInput : undefined
  const requestedCompanyId = originalInput && 'companyEntityId' in originalInput ? originalInput.companyEntityId : undefined
  if (originalInput && requestedCompanyId === undefined) return null

  const beforeId = before.profile.companyEntityId ?? null
  const savedCompanyId = after?.profile?.companyEntityId
  if (beforeId === savedCompanyId) return null
  const afterId = requestedCompanyId === undefined ? savedCompanyId : requestedCompanyId
  if ((afterId !== null && typeof afterId !== 'string') || afterId === beforeId) return null
  return { beforeId, afterId }
}

type PersonCompanyReplay = {
  previousCompanyId?: string | null
  reactivation?: NonNullable<PersonSnapshot['companyEmploymentLinks']>[number]
  undoneAt?: number
}

async function guardPersonCompanyReplay(
  em: EntityManager,
  person: CustomerEntity,
  companyIds: (string | null | undefined)[],
  replay?: PersonCompanyReplay,
): Promise<void> {
  const affectedIds = companyIds.filter((id): id is string => typeof id === 'string')
  if (!affectedIds.length) return
  const scope = { tenantId: person.tenantId, organizationId: person.organizationId }
  const lockedPerson = await findOneWithDecryption(em, CustomerEntity, {
    ...scope, id: person.id, kind: 'person', deletedAt: null,
  }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
  if (!lockedPerson) throw conflict(EMPLOYMENT_CHANGED)

  const endedLinks = await findWithDecryption(em, CustomerPersonCompanyLink, {
    ...scope, person, company: { $in: affectedIds }, deletedAt: null, employmentStatus: 'ended',
  }, { refresh: true }, scope)
  for (const link of endedLinks) {
    const priorEnd = replay?.reactivation
    const undoneAt = replay?.undoneAt
    if (!priorEnd || link.id !== priorEnd.id || link.employmentEndedOn !== priorEnd.employmentEndedOn
      || undoneAt === undefined || !(link.updatedAt.getTime() <= undoneAt)) {
      throw conflict(EMPLOYMENT_CHANGED)
    }
  }
}

async function resolveCompanyReference(
  em: EntityManager,
  companyId: string | null | undefined,
  organizationId: string,
  tenantId: string
): Promise<CustomerEntity | null> {
  if (!companyId) return null
  const company = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: companyId, kind: 'company', deletedAt: null, tenantId, organizationId },
    undefined,
    { tenantId, organizationId },
  )
  if (!company) {
    throw new CrudHttpError(400, { error: 'Company not found' })
  }
  if (company.organizationId !== organizationId || company.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cannot link person to company outside current scope' })
  }
  return company
}

async function setCustomFieldsForPerson(
  ctx: CommandRuntimeContext,
  entityId: string,
  profileId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>,
  transactionalEm?: EntityManager,
): Promise<void> {
  if (!values || !Object.keys(values).length) return
  const em = transactionalEm ?? (ctx.container.resolve('em') as EntityManager)
  const routing = await resolvePersonCustomFieldRouting(em, tenantId, organizationId)
  const entityScoped: Record<string, unknown> = {}
  const profileScoped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const target = routing.get(key) ?? PERSON_ENTITY_ID
    if (target === CUSTOMER_ENTITY_ID) entityScoped[key] = value
    else profileScoped[key] = value
  }

  const de = (ctx.container.resolve('dataEngine') as DataEngine)
  if (Object.keys(entityScoped).length) {
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: CUSTOMER_ENTITY_ID,
      recordId: entityId,
      organizationId,
      tenantId,
      values: entityScoped,
      transactionalEm,
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
      transactionalEm,
      notify: true,
    })
  }
}

type PersonGraphValues = {
  entityId?: string
  profileId?: string
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
  firstName: string | null
  lastName: string | null
  preferredName: string | null
  jobTitle: string | null
  department: string | null
  seniority: string | null
  timezone: string | null
  linkedInUrl: string | null
  twitterUrl: string | null
}

// Single source of truth for the person entity+profile row mapping, shared by
// `execute` (values from validated input) and `redo` (values from the after-
// snapshot, carrying the original ids). Keeps create and id-preserving redo from
// drifting field-by-field. Caller owns the surrounding flush, dictionary upserts,
// tag/company-link sync, and custom-field restore.
function buildPersonGraph(
  em: EntityManager,
  values: PersonGraphValues,
): { entity: CustomerEntity; profile: CustomerPersonProfile } {
  const entity = em.create(CustomerEntity, {
    ...(values.entityId ? { id: values.entityId } : {}),
    organizationId: values.organizationId,
    tenantId: values.tenantId,
    kind: 'person',
    displayName: values.displayName,
    description: values.description,
    ownerUserId: values.ownerUserId,
    primaryEmail: values.primaryEmail,
    primaryPhone: values.primaryPhone,
    status: values.status,
    lifecycleStage: values.lifecycleStage,
    source: values.source,
    nextInteractionAt: values.nextInteractionAt,
    nextInteractionName: values.nextInteractionName,
    nextInteractionRefId: values.nextInteractionRefId,
    nextInteractionIcon: values.nextInteractionIcon,
    nextInteractionColor: values.nextInteractionColor,
    isActive: values.isActive,
  })
  const profile = em.create(CustomerPersonProfile, {
    ...(values.profileId ? { id: values.profileId } : {}),
    organizationId: values.organizationId,
    tenantId: values.tenantId,
    entity,
    firstName: values.firstName,
    lastName: values.lastName,
    preferredName: values.preferredName,
    jobTitle: values.jobTitle,
    department: values.department,
    seniority: values.seniority,
    timezone: values.timezone,
    linkedInUrl: values.linkedInUrl,
    twitterUrl: values.twitterUrl,
    company: null,
  })
  em.persist(entity)
  em.persist(profile)
  return { entity, profile }
}

const createPersonCommand: CommandHandler<PersonCreateInput, { entityId: string; personId: string }> = {
  id: 'customers.people.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(personCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const firstName = parsed.firstName?.trim() ?? ''
    const lastName = parsed.lastName?.trim() ?? ''
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
    const displayNameInput = parsed.displayName?.trim() ?? ''
    const displayName = displayNameInput.length > 0
      ? displayNameInput
      : deriveDisplayName(firstName, lastName)
    const nextInteractionName = parsed.nextInteraction?.name ? parsed.nextInteraction.name.trim() : null
    const nextInteractionRefId = normalizeOptionalString(parsed.nextInteraction?.refId)
    const nextInteractionIcon = normalizeOptionalString(parsed.nextInteraction?.icon)
    const nextInteractionColor = normalizeHexColor(parsed.nextInteraction?.color)
    if (!firstName || !lastName) {
      throw new CrudHttpError(400, { error: 'First and last name are required' })
    }
    if (!displayName) {
      throw new CrudHttpError(400, { error: 'Display name is required' })
    }

    let entity!: CustomerEntity
    let profile!: CustomerPersonProfile
    const createdDictionaryKinds = new Set<string>()
    await withAtomicFlush(em, [
      () => {
        const graph = buildPersonGraph(em, {
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
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
          firstName,
          lastName,
          preferredName,
          jobTitle,
          department,
          seniority,
          timezone,
          linkedInUrl,
          twitterUrl,
        })
        entity = graph.entity
        profile = graph.profile
      },
      async () => {
        if (status) {
          await ensureDictionaryEntry(em, {
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
            kind: 'status',
            value: status,
          }, createdDictionaryKinds)
        }
        if (jobTitle) {
          await ensureDictionaryEntry(em, {
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
            kind: 'job_title',
            value: jobTitle,
          }, createdDictionaryKinds)
        }
        if (source) {
          await ensureDictionaryEntry(em, {
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
            kind: 'source',
            value: source,
          }, createdDictionaryKinds)
        }
      },
      () => syncLegacyPrimaryCompanyLink(em, entity, profile, parsed.companyEntityId ?? null),
      () => syncEntityTags(em, entity, parsed.tags),
      () => setCustomFieldsForPerson(ctx, entity.id, profile.id, entity.organizationId, entity.tenantId, custom, em),
    ], { transaction: true })

    const tenantId = entity.tenantId
    const organizationId = entity.organizationId
    await invalidateDictionaryKindCaches(ctx, { tenantId, organizationId }, createdDictionaryKinds)

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity,
      identifiers: {
        id: profile.id ?? entity.id,
        tenantId,
        organizationId,
      },
      syncOrigin: ctx.syncOrigin,
      actorUserId: ctx.auth?.sub ?? null,
      indexer: personCrudIndexer,
      events: personCrudEvents,
    })
    await emitQueryIndexUpsertEvents(ctx, [personEntityIndexEntry(entity)])

    return { entityId: entity.id, personId: profile.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadPersonSnapshot(em, result.entityId, ctx)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as PersonSnapshot | undefined
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await findScopedCustomerCommandRecord(em, CustomerEntity, { id: entityId }, undefined, ctx)
    if (!entity) return
    const profile = await findOneWithDecryption(
      em,
      CustomerPersonProfile,
      { entity, tenantId: entity.tenantId, organizationId: entity.organizationId },
      undefined,
      { tenantId: entity.tenantId, organizationId: entity.organizationId },
    )
    const identifiers = {
      id: payload?.after?.profile.id ?? profile?.id ?? entity.id,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
    }
    await withAtomicFlush(em, [
      () => em.nativeDelete(CustomerEmailConversationShare, { personEntity: entity, organizationId: entity.organizationId, tenantId: entity.tenantId }),
      () => em.nativeDelete(CustomerTagAssignment, { entity, organizationId: entity.organizationId, tenantId: entity.tenantId }),
      () => {
        if (profile) em.remove(profile)
      },
      () => em.remove(entity),
    ], { transaction: true })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity,
      identifiers,
      syncOrigin: ctx.syncOrigin,
      actorUserId: ctx.auth?.sub ?? null,
      indexer: personCrudIndexer,
      events: personCrudEvents,
    })
    await emitQueryIndexDeleteEvents(ctx, [personEntityIndexEntry(entity)])
  },
  redo: async ({ logEntry, ctx }) => {
    const after = resolveRedoSnapshot<PersonSnapshot>(logEntry)
    if (!after) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for person create' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await redactRestoredNextInteractionName(em, after.entity)
    let entity = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: after.entity.id, tenantId: after.entity.tenantId, organizationId: after.entity.organizationId },
      undefined,
      { tenantId: after.entity.tenantId, organizationId: after.entity.organizationId },
    )
    let profile!: CustomerPersonProfile
    if (!entity) {
      let newEntity!: CustomerEntity
      let newProfile!: CustomerPersonProfile
      await withAtomicFlush(em, [
        () => {
          const graph = buildPersonGraph(em, {
            entityId: after.entity.id,
            profileId: after.profile.id,
            organizationId: after.entity.organizationId,
            tenantId: after.entity.tenantId,
            displayName: after.entity.displayName,
            description: after.entity.description,
            ownerUserId: after.entity.ownerUserId,
            primaryEmail: after.entity.primaryEmail,
            primaryPhone: after.entity.primaryPhone,
            status: after.entity.status,
            lifecycleStage: after.entity.lifecycleStage,
            source: after.entity.source,
            nextInteractionAt: after.entity.nextInteractionAt,
            nextInteractionName: after.entity.nextInteractionName,
            nextInteractionRefId: after.entity.nextInteractionRefId,
            nextInteractionIcon: after.entity.nextInteractionIcon,
            nextInteractionColor: after.entity.nextInteractionColor,
            isActive: after.entity.isActive,
            firstName: after.profile.firstName,
            lastName: after.profile.lastName,
            preferredName: after.profile.preferredName,
            jobTitle: after.profile.jobTitle,
            department: after.profile.department,
            seniority: after.profile.seniority,
            timezone: after.profile.timezone,
            linkedInUrl: after.profile.linkedInUrl,
            twitterUrl: after.profile.twitterUrl,
          })
          newEntity = graph.entity
          newProfile = graph.profile
        },
        () => syncLegacyPrimaryCompanyLink(em, newEntity, newProfile, after.profile.companyEntityId),
        () => syncEntityTags(em, newEntity, after.tagIds, { ignoreMissing: true }),
      ], { transaction: true })
      entity = newEntity
      profile = newProfile
    } else {
      const existingProfile = await findOneWithDecryption(
        em,
        CustomerPersonProfile,
        { entity, tenantId: after.entity.tenantId, organizationId: after.entity.organizationId },
        undefined,
        { tenantId: after.entity.tenantId, organizationId: after.entity.organizationId },
      )
      if (!existingProfile) throw notFound('Person profile not found')
      profile = existingProfile
      const survivingEntity = entity
      await withAtomicFlush(em, [
        () => lockPersonRow(em, survivingEntity),
        () => {
          survivingEntity.deletedAt = null
          survivingEntity.displayName = after.entity.displayName
          survivingEntity.description = after.entity.description
          survivingEntity.ownerUserId = after.entity.ownerUserId
          survivingEntity.primaryEmail = after.entity.primaryEmail
          survivingEntity.primaryPhone = after.entity.primaryPhone
          survivingEntity.status = after.entity.status
          survivingEntity.lifecycleStage = after.entity.lifecycleStage
          survivingEntity.source = after.entity.source
          survivingEntity.nextInteractionAt = after.entity.nextInteractionAt
          survivingEntity.nextInteractionName = after.entity.nextInteractionName
          survivingEntity.nextInteractionRefId = after.entity.nextInteractionRefId
          survivingEntity.nextInteractionIcon = after.entity.nextInteractionIcon
          survivingEntity.nextInteractionColor = after.entity.nextInteractionColor
          survivingEntity.isActive = after.entity.isActive
          profile.firstName = after.profile.firstName
          profile.lastName = after.profile.lastName
          profile.preferredName = after.profile.preferredName
          profile.jobTitle = after.profile.jobTitle
          profile.department = after.profile.department
          profile.seniority = after.profile.seniority
          profile.timezone = after.profile.timezone
          profile.linkedInUrl = after.profile.linkedInUrl
          profile.twitterUrl = after.profile.twitterUrl
        },
        () => syncLegacyPrimaryCompanyLink(em, survivingEntity, profile, after.profile.companyEntityId),
        () => syncEntityTags(em, survivingEntity, after.tagIds, { ignoreMissing: true }),
      ], { transaction: true })
    }

    const restoredEntity = entity
    const restoreValues = buildCustomFieldResetMap(after.custom, undefined)
    if (Object.keys(restoreValues).length) {
      await setCustomFieldsForPerson(ctx, restoredEntity.id, profile.id, restoredEntity.organizationId, restoredEntity.tenantId, restoreValues)
    }

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: restoredEntity,
      identifiers: {
        id: profile.id ?? restoredEntity.id,
        tenantId: restoredEntity.tenantId,
        organizationId: restoredEntity.organizationId,
      },
      syncOrigin: ctx.syncOrigin,
      actorUserId: ctx.auth?.sub ?? null,
      indexer: personCrudIndexer,
      events: personCrudEvents,
    })
    await emitQueryIndexUpsertEvents(ctx, [personEntityIndexEntry(restoredEntity)])

    return { entityId: restoredEntity.id, personId: profile.id }
  },
}

const updatePersonCommand = {
  id: 'customers.people.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(personUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadPersonSnapshot(em, parsed.id, ctx)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(
    rawInput: PersonUpdateInput,
    ctx: CommandRuntimeContext,
    replay?: PersonCompanyReplay,
  ): Promise<{ entityId: string; updatedAt: Date }> {
    const { parsed, custom } = parseWithCustomFields(personUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await findScopedCustomerCommandTarget(
      em,
      CustomerEntity,
      { id: parsed.id, deletedAt: null },
      undefined,
      ctx,
    )
    const record = assertFound(entity, 'Person not found')
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const profile = await findOneWithDecryption(em, CustomerPersonProfile, { entity: record, tenantId: record.tenantId, organizationId: record.organizationId }, undefined, {
      tenantId: record.tenantId,
      organizationId: record.organizationId,
    })
    if (!profile) throw notFound('Person profile not found')

    if (parsed.displayName !== undefined) {
      const nextDisplayName = parsed.displayName.trim()
      if (!nextDisplayName) {
        throw new CrudHttpError(400, { error: 'Display name is required' })
      }
    }

    if (
      parsed.displayName === undefined
      && (parsed.firstName !== undefined || parsed.lastName !== undefined)
      && isDerivedDisplayName(record.displayName, profile.firstName, profile.lastName)
    ) {
      const nextFirst = parsed.firstName !== undefined ? parsed.firstName : profile.firstName
      const nextLast = parsed.lastName !== undefined ? parsed.lastName : profile.lastName
      const derived = deriveDisplayName(nextFirst, nextLast)
      if (derived.length > 0) parsed.displayName = derived
    }

    const createdDictionaryKinds = new Set<string>()
    await withAtomicFlush(em, [
      async () => {
        if (replay && parsed.companyEntityId !== undefined) {
          await guardPersonCompanyReplay(em, record, [replay.previousCompanyId, parsed.companyEntityId], replay)
        }
        if (parsed.description !== undefined) record.description = normalizeOptionalString(parsed.description)
        if (parsed.ownerUserId !== undefined) record.ownerUserId = parsed.ownerUserId ?? null
        if (parsed.primaryEmail !== undefined) record.primaryEmail = normalizeEmail(parsed.primaryEmail)
        if (parsed.primaryPhone !== undefined) record.primaryPhone = normalizeOptionalString(parsed.primaryPhone)
        if (parsed.status !== undefined) {
          record.status = normalizeOptionalString(parsed.status)
        }
        if (parsed.lifecycleStage !== undefined) record.lifecycleStage = normalizeOptionalString(parsed.lifecycleStage)
        if (parsed.source !== undefined) {
          record.source = normalizeOptionalString(parsed.source)
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
        if (parsed.jobTitle !== undefined) {
          profile.jobTitle = normalizeOptionalString(parsed.jobTitle)
        }
        if (parsed.department !== undefined) profile.department = normalizeOptionalString(parsed.department)
        if (parsed.seniority !== undefined) profile.seniority = normalizeOptionalString(parsed.seniority)
        if (parsed.timezone !== undefined) profile.timezone = normalizeOptionalString(parsed.timezone)
        if (parsed.linkedInUrl !== undefined) profile.linkedInUrl = normalizeOptionalString(parsed.linkedInUrl)
        if (parsed.twitterUrl !== undefined) profile.twitterUrl = normalizeOptionalString(parsed.twitterUrl)

        const profileFieldsUpdated = [
          parsed.firstName, parsed.lastName, parsed.preferredName, parsed.jobTitle,
          parsed.department, parsed.seniority, parsed.timezone, parsed.linkedInUrl,
          parsed.twitterUrl, parsed.companyEntityId,
        ].some((v) => v !== undefined)
        if (shouldBumpOptimisticLockVersion(profileFieldsUpdated, custom, parsed.tags)) {
          record.updatedAt = new Date()
        }

        if (parsed.displayName !== undefined) {
          record.displayName = parsed.displayName.trim()
        }
      },
      async () => {
        if (parsed.status !== undefined) {
          const normalizedStatus = normalizeOptionalString(parsed.status)
          if (normalizedStatus) {
            await ensureDictionaryEntry(em, {
              tenantId: record.tenantId,
              organizationId: record.organizationId,
              kind: 'status',
              value: normalizedStatus,
            }, createdDictionaryKinds)
          }
        }
        if (parsed.source !== undefined) {
          const normalizedSource = normalizeOptionalString(parsed.source)
          if (normalizedSource) {
            await ensureDictionaryEntry(em, {
              tenantId: record.tenantId,
              organizationId: record.organizationId,
              kind: 'source',
              value: normalizedSource,
            }, createdDictionaryKinds)
          }
        }
        if (parsed.jobTitle !== undefined) {
          const normalizedJobTitle = normalizeOptionalString(parsed.jobTitle)
          if (normalizedJobTitle) {
            await ensureDictionaryEntry(em, {
              tenantId: record.tenantId,
              organizationId: record.organizationId,
              kind: 'job_title',
              value: normalizedJobTitle,
            }, createdDictionaryKinds)
          }
        }
      },
      async () => {
        if (parsed.companyEntityId !== undefined) {
          await syncLegacyPrimaryCompanyLink(em, record, profile, parsed.companyEntityId)
        }
      },
      () => syncEntityTags(em, record, parsed.tags, { ignoreMissing: replay !== undefined }),
      () => setCustomFieldsForPerson(ctx, record.id, profile.id, record.organizationId, record.tenantId, custom, em),
    ], { transaction: true })

    await invalidateDictionaryKindCaches(ctx, record, createdDictionaryKinds)

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: profile.id ?? record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
      },
      syncOrigin: ctx.syncOrigin,
      actorUserId: ctx.auth?.sub ?? null,
      indexer: personCrudIndexer,
      events: personCrudEvents,
    })
    await emitQueryIndexUpsertEvents(ctx, [personEntityIndexEntry(record)])

    // Expose the freshly-bumped updatedAt for inline-edit sequential-save lock refresh (#2055).
    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadPersonSnapshot(em, result.entityId, ctx)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PersonSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as PersonSnapshot | undefined
    if (afterSnapshot && snapshotsEqual(before, afterSnapshot)) {
      return { skipLog: true }
    }
    return {
      actionLabel: translate('customers.audit.people.update', 'Update person'),
      resourceKind: 'customers.person',
      resourceId: before.entity.id,
      tenantId: before.entity.tenantId,
      organizationId: before.entity.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies PersonUndoPayload,
      },
    }
  },
  undo: async ({ input, logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonUndoPayload>(logEntry, CUSTOMER_ENTITY_UNDO_DATE_OPTIONS)
    const before = payload?.before
    if (!before) return
    const companyChange = resolvePersonCompanyUpdate(before, payload.after, input ?? logEntry.commandPayload)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await redactRestoredNextInteractionName(em, before.entity)
    const entity = await findOneWithDecryption(em, CustomerEntity, { id: before.entity.id, tenantId: before.entity.tenantId, organizationId: before.entity.organizationId }, undefined, {
      tenantId: before.entity.tenantId,
      organizationId: before.entity.organizationId,
    })
    if (!entity) {
      let newEntity!: CustomerEntity
      let newProfile!: CustomerPersonProfile
      await withAtomicFlush(em, [
        () => {
          newEntity = em.create(CustomerEntity, {
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
          newProfile = em.create(CustomerPersonProfile, {
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
          em.persist(newProfile)
        },
        () => syncLegacyPrimaryCompanyLink(em, newEntity, newProfile, before.profile.companyEntityId),
        () => restoreEndedPersonCompanyLinks(em, newEntity, before.companyEmploymentLinks),
        () => syncEntityTags(em, newEntity, before.tagIds, { ignoreMissing: true }),
      ], { transaction: true })
    } else {
      await withAtomicFlush(em, [
        async () => {
          if (companyChange) {
            await guardPersonCompanyReplay(em, entity, [companyChange.beforeId, companyChange.afterId])
            const reactivated = payload.after?.companyEmploymentLinks?.find((link) =>
              link.employmentStatus === 'active' && link.companyId === companyChange.afterId
              && before.companyEmploymentLinks?.some((previous) => previous.id === link.id && previous.employmentStatus === 'ended'),
            )
            if (reactivated) {
              const scope = { tenantId: entity.tenantId, organizationId: entity.organizationId }
              const link = await findOneWithDecryption(em, CustomerPersonCompanyLink, {
                id: reactivated.id, person: entity, ...scope, deletedAt: null, employmentStatus: 'active',
              }, { refresh: true }, scope)
              if (link?.updatedAt.toISOString() !== reactivated.updatedAt) throw conflict(EMPLOYMENT_CHANGED)
              link.employmentStatus = 'ended'
              link.isPrimary = false
            }
          } else {
            await lockPersonRow(em, entity)
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
          entity.updatedAt = new Date()
        },
        async () => {
          const profile = await findOneWithDecryption(
            em,
            CustomerPersonProfile,
            { entity, tenantId: before.entity.tenantId, organizationId: before.entity.organizationId },
            undefined,
            { tenantId: before.entity.tenantId, organizationId: before.entity.organizationId },
          )
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
            if (companyChange) await syncLegacyPrimaryCompanyLink(em, entity, profile, companyChange.beforeId)
          }
        },
        () => syncEntityTags(em, entity, before.tagIds, { ignoreMissing: true }),
      ], { transaction: true })
    }

    const indexedEntity = await findOneWithDecryption(em, CustomerEntity, { id: before.entity.id, tenantId: before.entity.tenantId, organizationId: before.entity.organizationId }, undefined, {
      tenantId: before.entity.tenantId,
      organizationId: before.entity.organizationId,
    })
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: indexedEntity,
      identifiers: {
        id: before.profile.id ?? before.entity.id,
        organizationId: before.entity.organizationId,
        tenantId: before.entity.tenantId,
      },
      syncOrigin: ctx.syncOrigin,
      actorUserId: ctx.auth?.sub ?? null,
      indexer: personCrudIndexer,
      events: personCrudEvents,
    })
    if (indexedEntity) {
      await emitQueryIndexUpsertEvents(ctx, [personEntityIndexEntry(indexedEntity)])
    }

    const resetValues = buildCustomFieldResetMap(before.custom, payload?.after?.custom)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsForPerson(ctx, before.entity.id, before.profile.id, before.entity.organizationId, before.entity.tenantId, resetValues)
    }
  },
  redo({ input, ctx, logEntry }): Promise<{ entityId: string }> {
    const payload = extractUndoPayload<PersonUndoPayload>(logEntry)
    const before = payload?.before
    const companyChange = before ? resolvePersonCompanyUpdate(before, payload.after, input) : null
    const redoInput = before && !companyChange ? { ...input, companyEntityId: undefined } : input
    const reactivation = companyChange ? before?.companyEmploymentLinks?.find((link) =>
      link.companyId === companyChange.afterId && link.employmentStatus === 'ended'
      && payload?.after?.companyEmploymentLinks?.some((later) => later.id === link.id && later.employmentStatus === 'active'),
    ) : undefined
    return updatePersonCommand.execute(redoInput, ctx, {
      previousCompanyId: companyChange?.beforeId,
      reactivation,
      undoneAt: logEntry.updatedAt === undefined ? undefined : new Date(logEntry.updatedAt).getTime(),
    })
  },
} satisfies CommandHandler<PersonUpdateInput, { entityId: string }>

type PersonDeleteCompanyAssignments = ReturnType<typeof capturePersonCompanyAssignments> & {
  companyEntityId: string | null
}

const deletePersonCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  {
    entityId: string
    labelAssignments?: LabelAssignmentRestoreSnapshot[]
    dependencies?: CustomerDeleteDependenciesSnapshot
    companyAssignments?: PersonDeleteCompanyAssignments
  }
> =
  {
    id: 'customers.people.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Person id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const snapshot = await loadPersonSnapshot(em, id, ctx, { includeInteractionRestoreDetails: true })
      if (!snapshot) return {}
      ensureTenantScope(ctx, snapshot.entity.tenantId)
      ensureOrganizationScope(ctx, snapshot.entity.organizationId)
      const shares = await findWithDecryption(
        em,
        CustomerEmailConversationShare,
        { personEntity: snapshot.entity.id, tenantId: snapshot.entity.tenantId, organizationId: snapshot.entity.organizationId },
        { orderBy: { createdAt: 'asc' } },
        { tenantId: snapshot.entity.tenantId, organizationId: snapshot.entity.organizationId },
      )
      snapshot.emailConversationShares = shares.map((share) => ({
        id: share.id,
        ownerUserId: share.ownerUserId,
        sharedByUserId: share.sharedByUserId,
        createdAt: share.createdAt,
        updatedAt: share.updatedAt ?? null,
        deletedAt: share.deletedAt ?? null,
      }))
      return { before: snapshot }
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Person id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const snapshot = await loadPersonSnapshot(em, id, ctx)

      let record!: CustomerEntity
      const profileHolder: { value: CustomerPersonProfile | null } = { value: null }
      const labelAssignmentsHolder: { value: LabelAssignmentRestoreSnapshot[] } = { value: [] }
      let companyAssignments: PersonDeleteCompanyAssignments | undefined
      let dependencies: CustomerDeleteDependenciesSnapshot | undefined

      await withAtomicFlush(em, [
        async () => {
          // Lock the entity row first, before any child read or cleanup, so a
          // concurrent insert of a child row (e.g. a label assignment) serializes
          // behind this transaction instead of racing the final delete with a
          // 409 FOREIGN_KEY_VIOLATION. See issue #7613.
          const entity = await findScopedCustomerCommandTarget(
            em,
            CustomerEntity,
            { id, deletedAt: null },
            { lockMode: LockMode.PESSIMISTIC_WRITE },
            ctx,
          )
          record = assertFound(entity, 'Person not found')
          ensureTenantScope(ctx, record.tenantId)
          ensureOrganizationScope(ctx, record.organizationId)

          const dealLinks = await em.count(CustomerDealPersonLink, { person: record })
          if (dealLinks > 0) {
            const { translate } = await resolveTranslations()
            throw buildPersonHasDependentsError(translate, { dealLinks })
          }

          const profile = await findOneWithDecryption(em, CustomerPersonProfile, { entity: record, tenantId: record.tenantId, organizationId: record.organizationId }, { populate: ['company'], refresh: true }, {
            tenantId: record.tenantId,
            organizationId: record.organizationId,
          })
          if (profile) {
            const links = await loadPersonCompanyLinks(em, record, { includeEnded: true, refresh: true })
            companyAssignments = {
              ...capturePersonCompanyAssignments(profile, links),
              companyEntityId: typeof profile.company === 'string' ? profile.company : profile.company?.id ?? null,
            }
          }
          profileHolder.value = profile
          labelAssignmentsHolder.value = await removeEntityLabelAssignments(em, record)
          dependencies = await removeCustomerDeleteDependencies(em, record)
          await em.nativeDelete(CustomerEmailConversationShare, { personEntity: record, organizationId: record.organizationId, tenantId: record.tenantId })
          if (profile) em.remove(profile)
          await em.nativeDelete(CustomerAddress, { entity: record, organizationId: record.organizationId, tenantId: record.tenantId })
          await em.nativeDelete(CustomerComment, { entity: record, organizationId: record.organizationId, tenantId: record.tenantId })
          await em.nativeDelete(CustomerActivity, { entity: record, organizationId: record.organizationId, tenantId: record.tenantId })
          await em.nativeDelete(CustomerInteraction, { entity: record, organizationId: record.organizationId, tenantId: record.tenantId })
          await em.nativeDelete(CustomerTodoLink, { entity: record, organizationId: record.organizationId, tenantId: record.tenantId })
          await em.nativeDelete(CustomerTagAssignment, { entity: record, organizationId: record.organizationId, tenantId: record.tenantId })
          await em.nativeDelete(CustomerDealPersonLink, { person: record })
          await em.nativeDelete(CustomerPersonCompanyLink, { person: record })
          if (profile) {
            await em.nativeDelete(CustomFieldValue, { entityId: PERSON_ENTITY_ID, recordId: profile.id })
          }
          await em.nativeDelete(CustomFieldValue, { entityId: CUSTOMER_ENTITY_ID, recordId: record.id })
          em.remove(record)
        },
      ], { transaction: true })
      const profile = profileHolder.value
      const labelAssignments = labelAssignmentsHolder.value

      const indexDeletes: QueryIndexEventEntry[] = []
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
        for (const interaction of snapshot.interactions ?? []) {
          indexDeletes.push({
            entityType: E.customers.customer_interaction,
            recordId: interaction.id,
            tenantId: record.tenantId,
            organizationId: record.organizationId,
          })
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
        syncOrigin: ctx.syncOrigin,
        actorUserId: ctx.auth?.sub ?? null,
        indexer: personCrudIndexer,
        events: personCrudEvents,
      })

      await emitQueryIndexDeleteEvents(ctx, [personEntityIndexEntry(record)])
      await emitQueryIndexDeleteEvents(ctx, indexDeletes)
      await emitQueryIndexDeleteEvents(ctx, labelAssignmentIndexEntries(record, labelAssignments))
      await emitQueryIndexUpsertEvents(ctx, dealUpserts)
      return {
        entityId: record.id,
        labelAssignments,
        ...(companyAssignments ? { companyAssignments } : {}),
        ...(dependencies ? { dependencies } : {}),
      }
    },
    buildLog: async ({ result, snapshots }) => {
      const prepared = snapshots.before as PersonSnapshot | undefined
      if (!prepared) return null
      const companyAssignments = result?.companyAssignments
      const before = companyAssignments ? {
        ...prepared,
        companies: companyAssignments.companies,
        companyEmploymentLinks: companyAssignments.companyEmploymentLinks,
        profile: { ...prepared.profile, companyEntityId: companyAssignments.companyEntityId },
      } : prepared
      const { translate } = await resolveTranslations()
      const snapshotBefore = { ...before }
      delete snapshotBefore.emailConversationShares
      return {
        actionLabel: translate('customers.audit.people.delete', 'Delete person'),
        resourceKind: 'customers.person',
        resourceId: before.entity.id,
        tenantId: before.entity.tenantId,
        organizationId: before.entity.organizationId,
        snapshotBefore: omitInteractionRestoreDetails(snapshotBefore),
        payload: {
          undo: {
            before,
            labelAssignments: result?.labelAssignments,
            dependencies: result?.dependencies,
          } satisfies PersonUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<PersonUndoPayload>(logEntry, {
        ...CUSTOMER_ENTITY_UNDO_DATE_OPTIONS,
        datePaths: [
          ...CUSTOMER_ENTITY_UNDO_DATE_OPTIONS.datePaths,
          'before.emailConversationShares.createdAt',
          'before.emailConversationShares.updatedAt',
          'before.emailConversationShares.deletedAt',
        ],
      })
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      await redactRestoredNextInteractionName(em, before.entity)
      const de = (ctx.container.resolve('dataEngine') as DataEngine)

      const decryptionScope = {
        tenantId: before.entity.tenantId ?? null,
        organizationId: before.entity.organizationId ?? null,
      }
      // Bind the outer EntityManager to an explicit transaction so every
      // `em.flush()` below participates in the same unit of work. Using
      // `em.transactional(cb)` would pass a forked em into `cb` and the
      // surrounding closures would mutate the unwrapped em, escaping the
      // transaction (see SPEC-018 and H8 in the CRM details screens review).
      await em.begin()
      let txResult: {
        entity: CustomerEntity
        profile: CustomerPersonProfile
        beforeInteractions: PersonInteractionSnapshot[]
        beforeTodos: PersonTodoSnapshot[]
        restoredLabelAssignments: LabelAssignmentRestoreSnapshot[]
      }
      try {
        txResult = await (async () => {
        let entity = await findOneWithDecryption(
          em,
          CustomerEntity,
          {
            id: before.entity.id,
            tenantId: before.entity.tenantId,
            organizationId: before.entity.organizationId,
          },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          decryptionScope,
        )
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
      entity.deletedAt = null

      let profile = await findOneWithDecryption(
        em,
        CustomerPersonProfile,
        {
          entity,
          tenantId: before.entity.tenantId,
          organizationId: before.entity.organizationId,
        },
        {},
        decryptionScope,
      )
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

      await syncLegacyPrimaryCompanyLink(em, entity, profile, before.profile.companyEntityId)

      await em.flush()
      await em.nativeDelete(CustomerPersonCompanyLink, { person: entity })
      const datedLinksById = new Map(before.companyEmploymentLinks?.map((link) => [link.id, link]))
      for (const companyLink of before.companies ?? []) {
        const company = await resolveCompanyReference(
          em,
          companyLink.companyId,
          before.entity.organizationId,
          before.entity.tenantId,
        )
        if (!company) continue
        const employment = companyLink.linkId ? datedLinksById.get(companyLink.linkId) : undefined
        const restoredLink = em.create(CustomerPersonCompanyLink, {
          id: companyLink.linkId ?? undefined,
          organizationId: before.entity.organizationId,
          tenantId: before.entity.tenantId,
          person: entity,
          company,
          isPrimary: companyLink.isPrimary,
          ...(employment ? {
            employmentEndedOn: employment.employmentEndedOn,
            createdAt: new Date(employment.createdAt),
          } : {}),
        })
        em.persist(restoredLink)
        if (companyLink.isPrimary) {
          profile.company = company
        }
      }
      await em.flush()
      await withAtomicFlush(em, [
        () => restoreEndedPersonCompanyLinks(em, entity, before.companyEmploymentLinks),
        () => syncEntityTags(em, entity, before.tagIds, { ignoreMissing: true }),
      ])
      const restoredLabelAssignments = await restoreEntityLabelAssignments(em, entity, payload?.labelAssignments)
      await restoreCustomerDeleteDependencies(em, entity, payload?.dependencies)
      await em.flush()

      const beforeActivities = (before as { activities?: PersonActivitySnapshot[] }).activities ?? []
      const beforeTodos = (before as { todos?: PersonTodoSnapshot[] }).todos ?? []
      const beforeInteractions = (before as { interactions?: PersonInteractionSnapshot[] }).interactions ?? []

      const relatedDealIds = new Set<string>()
      for (const link of before.deals) relatedDealIds.add(link.dealId)
      for (const activity of beforeActivities) {
        if (activity.dealId) relatedDealIds.add(activity.dealId)
      }
      for (const comment of before.comments) {
        if (comment.dealId) relatedDealIds.add(comment.dealId)
      }
      let dealMap = new Map<string, CustomerDeal>()
      if (relatedDealIds.size) {
        const deals = await findWithDecryption(
          em,
          CustomerDeal,
          {
            id: { $in: Array.from(relatedDealIds) },
            organizationId: entity.organizationId,
            tenantId: entity.tenantId,
          },
          undefined,
          { tenantId: entity.tenantId, organizationId: entity.organizationId },
        )
        dealMap = new Map(deals.map((deal) => [deal.id, deal]))
      }

      await em.nativeDelete(CustomerDealPersonLink, { person: entity })
      for (const link of before.deals) {
        const deal = dealMap.get(link.dealId)
        if (!deal) continue
        const restoredLink = em.create(CustomerDealPersonLink, {
          id: link.id,
          deal,
          person: entity,
          participantRole: link.participantRole,
          isPrimary: link.isPrimary === true,
          createdAt: link.createdAt,
        })
        em.persist(restoredLink)
      }
      await em.flush()

      await em.nativeDelete(CustomerActivity, { entity, organizationId: entity.organizationId, tenantId: entity.tenantId })
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

      await em.nativeDelete(CustomerComment, { entity, organizationId: entity.organizationId, tenantId: entity.tenantId })
      for (const comment of before.comments) {
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

      await em.nativeDelete(CustomerAddress, { entity, organizationId: entity.organizationId, tenantId: entity.tenantId })
      for (const address of before.addresses) {
        const restoredAddress = em.create(CustomerAddress, {
          id: address.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          entity,
          name: address.name,
          purpose: address.purpose,
          companyName: address.companyName ?? null,
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2,
          buildingNumber: address.buildingNumber ?? null,
          flatNumber: address.flatNumber ?? null,
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

      await em.nativeDelete(CustomerTodoLink, { entity, organizationId: entity.organizationId, tenantId: entity.tenantId })
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

      await em.nativeDelete(CustomerInteraction, { entity, organizationId: entity.organizationId, tenantId: entity.tenantId })
      for (const interaction of beforeInteractions) {
        const restoredInteraction = em.create(CustomerInteraction, {
          id: interaction.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          entity,
          interactionType: interaction.interactionType,
          title: interaction.title,
          body: interaction.body,
          status: interaction.status,
          scheduledAt: interaction.scheduledAt,
          timezone: interaction.timezone ?? null,
          occurredAt: interaction.occurredAt,
          priority: interaction.priority,
          authorUserId: interaction.authorUserId,
          ownerUserId: interaction.ownerUserId,
          dealId: interaction.dealId,
          source: interaction.source,
          appearanceIcon: interaction.appearanceIcon,
          appearanceColor: interaction.appearanceColor,
          ...restoreInteractionRestoreDetails(interaction),
          createdAt: interaction.createdAt,
          updatedAt: interaction.updatedAt,
          deletedAt: interaction.deletedAt,
        })
        em.persist(restoredInteraction)
      }
      await em.flush()

      await em.nativeDelete(CustomerEmailConversationShare, { personEntity: entity, organizationId: entity.organizationId, tenantId: entity.tenantId })
      for (const share of before.emailConversationShares ?? []) {
        const restoredShare = em.create(CustomerEmailConversationShare, {
          id: share.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
          personEntity: entity,
          ownerUserId: share.ownerUserId,
          sharedByUserId: share.sharedByUserId,
          createdAt: share.createdAt,
          updatedAt: share.updatedAt,
          deletedAt: share.deletedAt,
        })
        em.persist(restoredShare)
      }
      await em.flush()
      const shareIdsWithNullUpdatedAt = (before.emailConversationShares ?? [])
        .filter((share) => share.updatedAt === null)
        .map((share) => share.id)
      if (shareIdsWithNullUpdatedAt.length) {
        await em.nativeUpdate(CustomerEmailConversationShare, {
          id: { $in: shareIdsWithNullUpdatedAt },
          personEntity: entity,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
        }, { updatedAt: null })
      }

      return { entity, profile, beforeInteractions, beforeTodos, restoredLabelAssignments }
        })()
        await em.commit()
      } catch (err) {
        try {
          await em.rollback()
        } catch {
          // rollback failure should not mask the original error
        }
        throw err
      }

      for (const interaction of txResult.beforeInteractions) {
        if (!interaction.custom || !Object.keys(interaction.custom).length) continue
        await setCustomFieldsIfAny({
          dataEngine: de,
          entityId: INTERACTION_ENTITY_ID,
          recordId: interaction.id,
          organizationId: txResult.entity.organizationId,
          tenantId: txResult.entity.tenantId,
          values: interaction.custom,
          notify: false,
        })
      }

      const entity = txResult.entity
      const profile = txResult.profile

      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity,
        identifiers: {
          id: profile.id ?? entity.id,
          organizationId: entity.organizationId,
          tenantId: entity.tenantId,
        },
        syncOrigin: ctx.syncOrigin,
        actorUserId: ctx.auth?.sub ?? null,
        indexer: personCrudIndexer,
        events: personCrudEvents,
      })

      const upsertEntries: QueryIndexEventEntry[] = []
      for (const activity of before.activities ?? []) {
        upsertEntries.push({
          entityType: E.customers.customer_activity,
          recordId: activity.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      for (const comment of before.comments ?? []) {
        upsertEntries.push({
          entityType: E.customers.customer_comment,
          recordId: comment.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      for (const address of before.addresses ?? []) {
        upsertEntries.push({
          entityType: E.customers.customer_address,
          recordId: address.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      for (const todo of txResult.beforeTodos ?? []) {
        upsertEntries.push({
          entityType: E.customers.customer_todo_link,
          recordId: todo.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      for (const interaction of txResult.beforeInteractions ?? []) {
        upsertEntries.push({
          entityType: E.customers.customer_interaction,
          recordId: interaction.id,
          tenantId: entity.tenantId,
          organizationId: entity.organizationId,
        })
      }
      const dealUpserts: QueryIndexEventEntry[] = []
      for (const deal of before.deals ?? []) {
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
        await setCustomFieldsForPerson(ctx, entity.id, profile.id, entity.organizationId, entity.tenantId, resetValues)
      }
      await emitQueryIndexUpsertEvents(ctx, [personEntityIndexEntry(entity)])
      await emitQueryIndexUpsertEvents(ctx, upsertEntries)
      await emitQueryIndexUpsertEvents(ctx, labelAssignmentIndexEntries(entity, txResult.restoredLabelAssignments))
      await emitQueryIndexUpsertEvents(ctx, dealUpserts)
    },
  }

registerCommand(createPersonCommand)
registerCommand(updatePersonCommand)
registerCommand(deletePersonCommand)
