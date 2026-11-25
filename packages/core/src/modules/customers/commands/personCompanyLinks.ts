import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { emitCrudSideEffects, emitCrudUndoSideEffects, snapshotsEqual } from '@open-mercato/shared/lib/commands/helpers'
import { conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '../data/entities'
import {
  personCompanyLinkCreateSchema,
  personCompanyLinkDeleteSchema,
  personCompanyLinkUpdateSchema,
  personCompanyEmploymentEndCommandSchema,
  type PersonCompanyEmploymentEndInput,
  type PersonCompanyLinkCreateInput,
  type PersonCompanyLinkDeleteInput,
  type PersonCompanyLinkUpdateInput,
} from '../data/validators'
import {
  findDeletedPersonCompanyLink,
  findEndedPersonCompanyLink,
  loadPersonCompanyLinks,
  promoteFallbackPrimaryLink,
  removePersonCompanyLink,
} from '../lib/personCompanies'
import {
  emitQueryIndexUpsertEvents,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  type QueryIndexEventEntry,
} from './shared'
import type { CustomersEventId } from '../events'
import { E } from '#generated/entities.ids.generated'
import type { EventBus } from '@open-mercato/events'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'

const logger = createLogger('customers').child({ component: 'personCompanyLinks' })

// Typed against the module's declared event ids so removing or renaming the declaration in
// `events.ts` fails the build here rather than emitting an undeclared event at runtime.
const PROFILE_ONLY_DETACHED_EVENT: CustomersEventId = 'customers.person.company_assignment.detached'

type PersonCompanyLinkSnapshot = {
  id: string
  personEntityId: string
  companyEntityId: string
  isPrimary: boolean
  tenantId: string
  organizationId: string
  deletedAt: string | null
  employmentStatus?: CustomerPersonCompanyLink['employmentStatus']
  employmentEndedOn?: string | null
}

type PersonCompanyLinkUndoPayload = {
  before?: PersonCompanyLinkSnapshot | null
  after?: PersonCompanyLinkSnapshot | null
  createBefore?: PersonCompanyLinkCreateBefore
  reactivationVersion?: string
  promotionBefore?: PersonCompanyLinkPromotionBefore
}

type PersonCompanyLinkCreateBefore = {
  link: PersonCompanyLinkSnapshot | null
  primaryLinkIds: string[]
  profileCompanyId: string | null
}

type PersonCompanyLinkPromotionBefore = {
  primaryLinkIds: string[]
  profileCompanyId: string | null
  profileCompanyLinkId: string | null
}

type PersonCompanyLinkUpdateResult = {
  linkId: string
  promotionBefore?: PersonCompanyLinkPromotionBefore
}

type PersonCompanyLinkCreateResult = {
  linkId: string
  created: boolean
  undeleted: boolean
  changed: boolean
  createBefore: PersonCompanyLinkCreateBefore
  reactivationVersion?: string
}

/**
 * Snapshot of a legacy profile-only company assignment — `customer_person_profiles.company_id`
 * set with no backing link row (#5114). It carries no link id because none exists; `kind`
 * discriminates it from `PersonCompanyLinkSnapshot` in the delete command's undo payload.
 */
type PersonCompanyProfileAssignmentSnapshot = {
  kind: 'profile-only'
  personEntityId: string
  companyEntityId: string
  tenantId: string
  organizationId: string
}

type PersonCompanyLinkDeleteSnapshot = PersonCompanyLinkSnapshot | PersonCompanyProfileAssignmentSnapshot

type PersonCompanyLinkDeleteUndoPayload = {
  before?: PersonCompanyLinkDeleteSnapshot | null
}

type PersonCompanyLinkDeleteResult = {
  linkId: string | null
  personEntityId: string | null
  companyEntityId: string | null
}

function isProfileAssignmentSnapshot(
  snapshot: PersonCompanyLinkDeleteSnapshot | null | undefined,
): snapshot is PersonCompanyProfileAssignmentSnapshot {
  return Boolean(snapshot) && (snapshot as PersonCompanyProfileAssignmentSnapshot).kind === 'profile-only'
}

function resolveProfileOnlyTarget(
  parsed: PersonCompanyLinkDeleteInput,
): { personEntityId: string; companyEntityId: string } | null {
  if (parsed.linkId) return null
  if (!parsed.personEntityId || !parsed.companyEntityId) return null
  return { personEntityId: parsed.personEntityId, companyEntityId: parsed.companyEntityId }
}

function personQueryIndexEntries(
  person: CustomerEntity,
  profile: CustomerPersonProfile,
): QueryIndexEventEntry[] {
  return [
    {
      entityType: E.customers.customer_entity,
      recordId: person.id,
      tenantId: person.tenantId,
      organizationId: person.organizationId,
    },
    {
      entityType: E.customers.customer_person_profile,
      recordId: profile.id,
      tenantId: profile.tenantId,
      organizationId: profile.organizationId,
    },
  ]
}

const personCompanyLinkCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'person_company_link',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    ...(ctx.entity && typeof ctx.entity === 'object' && 'person' in (ctx.entity as Record<string, unknown>)
      ? {
          personEntityId:
            typeof (ctx.entity as CustomerPersonCompanyLink).person === 'string'
              ? (ctx.entity as any).person
              : (ctx.entity as CustomerPersonCompanyLink).person?.id ?? null,
          companyEntityId:
            typeof (ctx.entity as CustomerPersonCompanyLink).company === 'string'
              ? (ctx.entity as any).company
              : (ctx.entity as CustomerPersonCompanyLink).company?.id ?? null,
        }
      : {}),
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }),
}

function getLinkIdentifiers(link: CustomerPersonCompanyLink) {
  return {
    id: link.id,
    organizationId: link.organizationId,
    tenantId: link.tenantId,
  }
}

async function loadPersonCompanyLinkSnapshot(
  em: EntityManager,
  id: string,
  scope?: { tenantId?: string | null; organizationId?: string | null },
): Promise<PersonCompanyLinkSnapshot | null> {
  const filter: Record<string, unknown> = { id }
  if (scope?.tenantId) filter.tenantId = scope.tenantId
  if (scope?.organizationId) filter.organizationId = scope.organizationId
  const link = await findOneWithDecryption(
    em,
    CustomerPersonCompanyLink,
    filter,
    undefined,
    {
      tenantId: scope?.tenantId ?? null,
      organizationId: scope?.organizationId ?? null,
    },
  )
  if (!link) return null
  return snapshotPersonCompanyLink(link)
}

function snapshotPersonCompanyLink(link: CustomerPersonCompanyLink): PersonCompanyLinkSnapshot {
  const personId = typeof link.person === 'string' ? link.person : link.person.id
  const companyId = typeof link.company === 'string' ? link.company : link.company.id
  return {
    id: link.id,
    personEntityId: personId,
    companyEntityId: companyId,
    isPrimary: Boolean(link.isPrimary),
    tenantId: link.tenantId,
    organizationId: link.organizationId,
    deletedAt: link.deletedAt ? link.deletedAt.toISOString() : null,
    employmentStatus: link.employmentStatus ?? 'active',
    employmentEndedOn: link.employmentEndedOn ?? null,
  }
}

async function requirePersonEntity(
  em: EntityManager,
  entityId: string,
  tenantId: string,
  organizationId: string,
): Promise<CustomerEntity> {
  const person = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: entityId, kind: 'person', tenantId, organizationId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!person) {
    throw notFound('Person not found')
  }
  return person
}

async function requireCompanyEntity(
  em: EntityManager,
  entityId: string,
  tenantId: string,
  organizationId: string,
): Promise<CustomerEntity> {
  const company = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: entityId, kind: 'company', tenantId, organizationId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!company) {
    throw notFound('Company not found')
  }
  return company
}

async function requirePersonProfile(
  em: EntityManager,
  person: CustomerEntity,
): Promise<CustomerPersonProfile> {
  const profile = await findOneWithDecryption(
    em,
    CustomerPersonProfile,
    { entity: person, tenantId: person.tenantId, organizationId: person.organizationId },
    { populate: ['company'] },
    { tenantId: person.tenantId, organizationId: person.organizationId },
  )
  if (!profile) {
    throw notFound('Person profile not found')
  }
  return profile
}

async function clearPrimaryFlagsForPerson(em: EntityManager, person: CustomerEntity, keepLinkId?: string): Promise<void> {
  await em.nativeUpdate(
    CustomerPersonCompanyLink,
    {
      person, organizationId: person.organizationId, tenantId: person.tenantId,
      isPrimary: true, deletedAt: null, employmentStatus: 'active',
      ...(keepLinkId ? { id: { $ne: keepLinkId } } : {}),
    },
    { isPrimary: false, updatedAt: new Date() },
  )
}

async function restoreCreatePersonCompanyLink(
  ctx: CommandRuntimeContext,
  after: PersonCompanyLinkSnapshot,
  before: PersonCompanyLinkCreateBefore,
  reactivationVersion?: string,
): Promise<void> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
  const restored: { link?: CustomerPersonCompanyLink } = {}

  await withAtomicFlush(em, [
    async () => {
      if (!await lockPersonForCompanyLinkUpdate(em, after.personEntityId, scope)) return
      const person = await requirePersonEntity(em, after.personEntityId, after.tenantId, after.organizationId)
      const link = await findOneWithDecryption(em, CustomerPersonCompanyLink, {
        id: after.id, ...scope, person, company: after.companyEntityId,
      }, undefined, scope)
      if (!link) return
      if (link.employmentStatus === 'ended' || (reactivationVersion && link.updatedAt.toISOString() !== reactivationVersion)) {
        throw conflict('customers.errors.person_company_employment_changed')
      }
      const profile = await requirePersonProfile(em, person)
      const restorePrimaryAssignment = after.isPrimary && link.isPrimary && getProfileCompanyId(profile) === after.companyEntityId
      const company = restorePrimaryAssignment && before.profileCompanyId
        ? await requireCompanyEntity(em, before.profileCompanyId, scope.tenantId, scope.organizationId)
        : null
      const primaryLinkIds = before.primaryLinkIds.filter((id) => id !== link.id)
      const activeScope = { person, ...scope, deletedAt: null, employmentStatus: 'active' as const }
      if (restorePrimaryAssignment) {
        const previousLinks = primaryLinkIds.length ? await findWithDecryption(
          em, CustomerPersonCompanyLink, { ...activeScope, id: { $in: primaryLinkIds } }, {}, scope,
        ) : []
        if (previousLinks.length !== primaryLinkIds.length || (company && await findEndedPersonCompanyLink(em, person, company))) {
          throw conflict('customers.errors.person_company_employment_changed')
        }
        await em.nativeUpdate(
          CustomerPersonCompanyLink,
          { ...activeScope, id: { $ne: link.id }, isPrimary: true },
          { isPrimary: false, updatedAt: new Date() },
        )
        if (primaryLinkIds.length) {
          await em.nativeUpdate(
            CustomerPersonCompanyLink,
            { ...activeScope, id: { $in: primaryLinkIds }, isPrimary: false },
            { isPrimary: true, updatedAt: new Date() },
          )
        }
        profile.company = company
      }
      link.isPrimary = before.link?.isPrimary ?? false
      if (before.link?.employmentStatus === 'ended') {
        link.employmentStatus = 'ended'
        link.employmentEndedOn = before.link.employmentEndedOn ?? null
      }
      link.deletedAt = before.link
        ? before.link.deletedAt ? new Date(before.link.deletedAt) : null
        : new Date()
      restored.link = link
    },
  ], { transaction: true })

  const { link } = restored
  if (!link) return
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action: link.deletedAt ? 'deleted' : 'updated',
    entity: link,
    identifiers: getLinkIdentifiers(link),
    syncOrigin: ctx.syncOrigin,
    events: personCompanyLinkCrudEvents,
    indexer: { entityType: 'customers:customer_person_company_link' },
  })
}

const createPersonCompanyLinkCommand: CommandHandler<PersonCompanyLinkCreateInput, PersonCompanyLinkCreateResult> = {
  id: 'customers.personCompanyLinks.create',
  async prepare(rawInput, ctx) {
    const parsed = personCompanyLinkCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const person = await requirePersonEntity(em, parsed.personEntityId, parsed.tenantId, parsed.organizationId)
    const company = await requireCompanyEntity(em, parsed.companyEntityId, parsed.tenantId, parsed.organizationId)
    const profile = await requirePersonProfile(em, person)
    const links = await loadPersonCompanyLinks(em, person)
    const link = links.find((entry) =>
      (typeof entry.company === 'string' ? entry.company : entry.company.id) === company.id,
    ) ?? await findEndedPersonCompanyLink(em, person, company) ?? await findDeletedPersonCompanyLink(em, person, company)
    return {
      before: {
        link: link ? await loadPersonCompanyLinkSnapshot(em, link.id, parsed) : null,
        primaryLinkIds: links.filter((entry) => entry.isPrimary).map((entry) => entry.id),
        profileCompanyId: typeof profile.company === 'string' ? profile.company : profile.company?.id ?? null,
      } satisfies PersonCompanyLinkCreateBefore,
    }
  },
  async execute(rawInput, ctx) {
    const parsed = personCompanyLinkCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    let link!: CustomerPersonCompanyLink
    let createBefore!: PersonCompanyLinkCreateBefore
    let changed = false
    let existing = false
    let undeleted = false
    await withAtomicFlush(em, [
      async () => {
        if (!await lockPersonForCompanyLinkUpdate(em, parsed.personEntityId, scope)) throw notFound('Person not found')
        const person = await requirePersonEntity(em, parsed.personEntityId, parsed.tenantId, parsed.organizationId)
        const company = await requireCompanyEntity(em, parsed.companyEntityId, parsed.tenantId, parsed.organizationId)
        const profile = await requirePersonProfile(em, person)
        const existingLinks = await loadPersonCompanyLinks(em, person)
        const makePrimary = Boolean(parsed.isPrimary) || existingLinks.length === 0
        const activeLink = existingLinks.find((entry) =>
          (typeof entry.company === 'string' ? entry.company : entry.company.id) === company.id,
        )
        const reusableLink = activeLink ?? await findEndedPersonCompanyLink(em, person, company)
          ?? await findDeletedPersonCompanyLink(em, person, company)
        createBefore = {
          link: reusableLink ? snapshotPersonCompanyLink(reusableLink) : null,
          primaryLinkIds: existingLinks.filter((entry) => entry.isPrimary).map((entry) => entry.id),
          profileCompanyId: typeof profile.company === 'string' ? profile.company : profile.company?.id ?? null,
        }
        existing = Boolean(activeLink)
        changed = !activeLink || (makePrimary && !activeLink.isPrimary)
        if (activeLink && !changed) {
          link = activeLink
          return
        }
        if (makePrimary) {
          await clearPrimaryFlagsForPerson(em, person, activeLink?.id)
        }
        link = reusableLink ?? em.create(CustomerPersonCompanyLink, { ...scope, person, company })
        undeleted = Boolean(link.deletedAt)
        link.deletedAt = null
        link.employmentStatus = 'active'
        link.isPrimary = makePrimary
        em.persist(link)
        if (makePrimary) profile.company = company
      },
    ], { transaction: true })

    if (existing) return { linkId: link.id, created: false, undeleted: false, changed, createBefore }
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: createBefore.link ? 'updated' : 'created',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })

    return {
      linkId: link.id, created: !createBefore.link, undeleted, changed, createBefore,
      ...(createBefore.link?.employmentStatus === 'ended' ? { reactivationVersion: link.updatedAt.toISOString() } : {}),
    }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadPersonCompanyLinkSnapshot(em, result.linkId, {
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    })
  },
  buildLog: async ({ result, snapshots }) => {
    const before = result.createBefore
    const after = snapshots.after as PersonCompanyLinkSnapshot | undefined
    if (!result.changed) {
      return { skipLog: true }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.audit.personCompanyLinks.create', 'Link company to person'),
      resourceKind: 'customers.personCompanyLink',
      resourceId: result.linkId,
      parentResourceKind: 'customers.person',
      parentResourceId: after?.personEntityId ?? null,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotBefore: before?.link ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          after: after ?? null,
          ...(before ? { createBefore: before } : {}),
          ...(result.undeleted ? { before: null } : {}),
          ...(result.reactivationVersion ? { reactivationVersion: result.reactivationVersion } : {}),
        } satisfies PersonCompanyLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonCompanyLinkUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return

    if (payload.createBefore) {
      await restoreCreatePersonCompanyLink(ctx, after, payload.createBefore, payload.reactivationVersion)
      return
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    const restored: { link?: CustomerPersonCompanyLink } = {}
    let person: CustomerEntity | null = null
    let profile: CustomerPersonProfile | null = null
    let remainingLinks: CustomerPersonCompanyLink[] = []

    await withAtomicFlush(em, [
      async () => {
        if (!await lockPersonForCompanyLinkUpdate(em, after.personEntityId, scope)) return
        const link = await findOneWithDecryption(
          em, CustomerPersonCompanyLink,
          { id: after.id, person: after.personEntityId, company: after.companyEntityId, ...scope }, undefined, scope,
        )
        if (!link) return
        if (link.employmentStatus === 'ended') throw conflict('customers.errors.person_company_employment_changed')
        restored.link = link
        person = await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: after.personEntityId, kind: 'person', tenantId: after.tenantId, organizationId: after.organizationId, deletedAt: null },
          undefined,
          { tenantId: after.tenantId, organizationId: after.organizationId },
        )
        if (!person) return
        profile = await findOneWithDecryption(
          em,
          CustomerPersonProfile,
          { entity: person, ...scope },
          { populate: ['company'] },
          { tenantId: person.tenantId, organizationId: person.organizationId },
        )
        if (!profile) return
        remainingLinks = (await loadPersonCompanyLinks(em, person)).filter((entry) => entry.id !== link.id)
      },
      async () => {
        const { link } = restored
        if (!link) return
        link.isPrimary = false
        link.deletedAt = new Date()
        if (!person || !profile) return
        if (after.isPrimary) {
          await promoteFallbackPrimaryLink(em, person, profile, remainingLinks, after.companyEntityId)
        } else if (profile.company && typeof profile.company !== 'string' && profile.company.id === after.companyEntityId) {
          profile.company = null
        }
      },
    ], { transaction: true })

    const { link } = restored
    if (!link) return
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })
  },
  redo: async ({ logEntry, ctx }) => {
    const after = resolveRedoSnapshot<PersonCompanyLinkSnapshot>(logEntry)
    if (!after) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for person-company link create' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    const previous = extractUndoPayload<PersonCompanyLinkUndoPayload>(logEntry)?.createBefore?.link
    const undoneAt = logEntry.updatedAt === undefined ? undefined : new Date(logEntry.updatedAt).getTime()
    let link!: CustomerPersonCompanyLink
    let createBefore!: PersonCompanyLinkCreateBefore

    await withAtomicFlush(em, [
      async () => {
        if (!await lockPersonForCompanyLinkUpdate(em, after.personEntityId, scope)) throw notFound('Person not found')
        const person = await requirePersonEntity(em, after.personEntityId, scope.tenantId, scope.organizationId)
        const company = await requireCompanyEntity(em, after.companyEntityId, scope.tenantId, scope.organizationId)
        const profile = await requirePersonProfile(em, person)
        const current = await findOneWithDecryption(
          em, CustomerPersonCompanyLink, { ...scope, id: after.id, person, company }, undefined, scope,
        )
        if (previous?.employmentStatus === 'ended') {
          if (current?.employmentStatus !== 'ended' || current.deletedAt || current.employmentEndedOn !== previous.employmentEndedOn
            || hasChangedSinceUndo(current.updatedAt, undoneAt)) {
            throw conflict('customers.errors.person_company_employment_changed')
          }
        } else if (current?.employmentStatus === 'ended') {
          throw conflict('customers.errors.person_company_employment_changed')
        }
        const existingLinks = await loadPersonCompanyLinks(em, person)
        createBefore = {
          link: current ? snapshotPersonCompanyLink(current) : null,
          primaryLinkIds: existingLinks.filter((entry) => entry.isPrimary).map((entry) => entry.id),
          profileCompanyId: getProfileCompanyId(profile),
        }
        if (after.isPrimary) {
          await clearPrimaryFlagsForPerson(em, person, current?.id)
          profile.company = company
        }
        link = current ?? em.create(CustomerPersonCompanyLink, {
          ...scope, id: after.id, person, company, employmentEndedOn: after.employmentEndedOn ?? null,
        })
        link.deletedAt = null
        link.employmentStatus = 'active'
        link.isPrimary = after.isPrimary
        em.persist(link)
      },
    ], { transaction: true })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })

    return {
      linkId: link.id, created: true, undeleted: false, changed: true, createBefore,
      ...(previous?.employmentStatus === 'ended' ? { reactivationVersion: link.updatedAt.toISOString() } : {}),
    }
  },
}

type PersonCompanyLinkLockDatabase = {
  customer_entities: {
    id: string
    kind: string
    tenant_id: string
    organization_id: string
    deleted_at: Date | null
  }
}

async function lockPersonForCompanyLinkUpdate(
  em: EntityManager,
  personId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  const locked = await em.getKysely<PersonCompanyLinkLockDatabase>()
    .selectFrom('customer_entities')
    .select('id')
    .where('id', '=', personId)
    .where('kind', '=', 'person')
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .forNoKeyUpdate()
    .executeTakeFirst()
  return Boolean(locked)
}

const updatePersonCompanyLinkCommand: CommandHandler<PersonCompanyLinkUpdateInput, PersonCompanyLinkUpdateResult> = {
  id: 'customers.personCompanyLinks.update',
  async prepare(rawInput, ctx) {
    const parsed = personCompanyLinkUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadPersonCompanyLinkSnapshot(em, parsed.linkId, {
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    })
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = personCompanyLinkUpdateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const linkFilter = { id: parsed.linkId, ...scope, deletedAt: null, employmentStatus: 'active' as const }
    const link = await findOneWithDecryption(em, CustomerPersonCompanyLink, linkFilter, undefined, scope)
    if (!link) throw notFound('Company link not found')

    const personId = typeof link.person === 'string' ? link.person : link.person.id
    const companyId = typeof link.company === 'string' ? link.company : link.company.id
    let person!: CustomerEntity
    let profile!: CustomerPersonProfile
    let linkWasPrimary = false
    let promotionBefore: PersonCompanyLinkPromotionBefore | undefined

    await withAtomicFlush(em, [
      async () => {
        if (!await lockPersonForCompanyLinkUpdate(em, personId, scope)) throw notFound('Person not found')
        person = await requirePersonEntity(em, personId, scope.tenantId, scope.organizationId)
        const currentLink = await findOneWithDecryption(em, CustomerPersonCompanyLink, linkFilter, { refresh: true }, scope)
        if (!currentLink || currentLink.deletedAt || currentLink.employmentStatus === 'ended') throw notFound('Company link not found')

        profile = await requirePersonProfile(em, person)
        const linkedCompany = await requireCompanyEntity(em, companyId, parsed.tenantId, parsed.organizationId)
        linkWasPrimary = currentLink.isPrimary
        if (parsed.isPrimary) {
          if (!linkWasPrimary) {
            const links = await loadPersonCompanyLinks(em, person)
            const profileCompanyId = typeof profile.company === 'string' ? profile.company : profile.company?.id ?? null
            promotionBefore = {
              primaryLinkIds: links.filter((entry) => entry.isPrimary).map((entry) => entry.id),
              profileCompanyId,
              profileCompanyLinkId: links.find((entry) =>
                (typeof entry.company === 'string' ? entry.company : entry.company.id) === profileCompanyId,
              )?.id ?? null,
            }
          }
          await clearPrimaryFlagsForPerson(em, person, currentLink.id)
          currentLink.isPrimary = true
          profile.company = linkedCompany
        } else {
          currentLink.isPrimary = false
          if (!linkWasPrimary && profile.company && typeof profile.company !== 'string' && profile.company.id === companyId) {
            profile.company = null
          }
        }
      },
      async () => {
        if (!parsed.isPrimary && linkWasPrimary) {
          const remainingLinks = (await loadPersonCompanyLinks(em, person)).filter((entry) => entry.id !== link.id)
          await promoteFallbackPrimaryLink(em, person, profile, remainingLinks, companyId)
        }
      },
    ], { transaction: true })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })

    return { linkId: link.id, promotionBefore }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadPersonCompanyLinkSnapshot(em, result.linkId, {
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    })
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PersonCompanyLinkSnapshot | undefined
    const after = snapshots.after as PersonCompanyLinkSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.personCompanyLinks.update', 'Update company link'),
      resourceKind: 'customers.personCompanyLink',
      resourceId: result.linkId,
      parentResourceKind: 'customers.person',
      parentResourceId: after?.personEntityId ?? before?.personEntityId ?? null,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
          ...(result.promotionBefore ? { promotionBefore: result.promotionBefore } : {}),
        } satisfies PersonCompanyLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonCompanyLinkUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const promotionBefore = payload?.promotionBefore
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const state: { link?: CustomerPersonCompanyLink; restoredPromotion?: boolean } = {}
    let person: CustomerEntity | null = null
    let profile: CustomerPersonProfile | null = null
    let company: CustomerEntity | null = null

    await withAtomicFlush(em, [
      async () => {
        if (!await lockPersonForCompanyLinkUpdate(em, before.personEntityId, scope)) return
        person = await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: before.personEntityId, kind: 'person', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
          undefined,
          scope,
        )
        if (!person) return
        const link = await findOneWithDecryption(
          em,
          CustomerPersonCompanyLink,
          { id: before.id, person: before.personEntityId, ...scope },
          promotionBefore ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
          scope,
        )
        if (!link) return
        if (link.employmentStatus === 'ended') throw conflict('customers.errors.person_company_employment_changed')
        state.link = link
        profile = await findOneWithDecryption(
          em,
          CustomerPersonProfile,
          { entity: person },
          { populate: ['company'] },
          { tenantId: person.tenantId, organizationId: person.organizationId },
        )
        if (!profile || promotionBefore || !before.isPrimary) return
        company = await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: before.companyEntityId, kind: 'company', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
          undefined,
          { tenantId: before.tenantId, organizationId: before.organizationId },
        )
      },
      async () => {
        const { link } = state
        if (!person || !profile || !link) return
        if (promotionBefore) {
          const profileCompanyId = getProfileCompanyId(profile)
          if (link.deletedAt || !link.isPrimary || profileCompanyId !== before.companyEntityId) return

          const { primaryLinkIds, profileCompanyId: previousCompanyId, profileCompanyLinkId } = promotionBefore
          const previousLinkStillExists = !profileCompanyLinkId
            || (await loadPersonCompanyLinks(em, person)).some((entry) => entry.id === profileCompanyLinkId)
          const previousCompany = previousCompanyId && previousLinkStillExists
            ? await findOneWithDecryption(
                em,
                CustomerEntity,
                { id: previousCompanyId, kind: 'company', ...scope, deletedAt: null },
                undefined,
                scope,
              )
            : null
          const endedPrimary = primaryLinkIds.length ? await findOneWithDecryption(
            em, CustomerPersonCompanyLink,
            { ...scope, person, id: { $in: primaryLinkIds }, deletedAt: null, employmentStatus: 'ended' },
            undefined, scope,
          ) : null
          if (endedPrimary || (previousCompany && await findEndedPersonCompanyLink(em, person, previousCompany))) {
            throw conflict('customers.errors.person_company_employment_changed')
          }

          if (primaryLinkIds.length) {
            await em.nativeUpdate(
              CustomerPersonCompanyLink,
              { person, ...scope, id: { $in: primaryLinkIds }, deletedAt: null, employmentStatus: 'active', isPrimary: false },
              { isPrimary: true, updatedAt: new Date() },
            )
          }
          link.isPrimary = false
          profile.company = previousCompany
          state.restoredPromotion = true
        } else if (before.isPrimary) {
          await clearPrimaryFlagsForPerson(em, person, link.id)
          link.isPrimary = true
          if (company) profile.company = company
        } else {
          link.isPrimary = false
        }
      },
    ], { transaction: true })

    const { link, restoredPromotion } = state
    if (!link || (promotionBefore && !restoredPromotion)) return

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })
  },
}

/**
 * Detach a legacy profile-only company assignment: `customer_person_profiles.company_id`
 * points at the company but no `customer_person_company_links` row was ever created, so
 * there is no link row for the id-based branch to soft-delete (#5114). Running it as part
 * of the same command keeps the audit entry, the undo token and the CRUD cache
 * invalidation identical to a link-backed detach.
 */
async function detachProfileOnlyCompany(
  em: EntityManager,
  ctx: CommandRuntimeContext,
  parsed: PersonCompanyLinkDeleteInput,
  target: { personEntityId: string; companyEntityId: string },
): Promise<PersonCompanyLinkDeleteResult> {
  const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
  let person!: CustomerEntity
  let profile!: CustomerPersonProfile
  await withAtomicFlush(em, [
    async () => {
      if (!await lockPersonForCompanyLinkUpdate(em, target.personEntityId, scope)) throw notFound('Person not found')
      person = await requirePersonEntity(em, target.personEntityId, scope.tenantId, scope.organizationId)
      profile = await requirePersonProfile(em, person)
      if (getProfileCompanyId(profile) !== target.companyEntityId) throw notFound('Company link not found')
      await removePersonCompanyLink(em, person, profile, target.companyEntityId)
    },
  ], { transaction: true })

  // There is no link entity to hand to `emitCrudSideEffects`; what changed is the
  // person's own company assignment, so reindex the person and its profile instead.
  await emitQueryIndexUpsertEvents(ctx, personQueryIndexEntries(person, profile))
  await emitProfileOnlyDetachedEvent(ctx, person, target.companyEntityId)

  return { linkId: null, personEntityId: person.id, companyEntityId: target.companyEntityId }
}

/**
 * Live-refresh signal for the company People tab and the person Companies tab, which the
 * link-backed branch gets from `customers.person_company_link.deleted` via `emitCrudSideEffects`.
 * The profile-only branch has no link row to emit that for, so it publishes the sibling
 * `clientBroadcast` event instead (#5114). `tenantId` must travel in the payload: the event bus
 * only forwards a broadcast event cross-process when the payload carries a tenant scope. The
 * write is already committed, so a failed refresh signal must never fail the detach.
 */
async function emitProfileOnlyDetachedEvent(
  ctx: CommandRuntimeContext,
  person: CustomerEntity,
  companyEntityId: string,
): Promise<void> {
  try {
    const bus = ctx.container.resolve<EventBus>('eventBus')
    await bus.emitEvent(
      PROFILE_ONLY_DETACHED_EVENT,
      {
        linkId: null,
        personEntityId: person.id,
        companyEntityId,
        tenantId: person.tenantId,
        organizationId: person.organizationId,
      },
      { tenantId: person.tenantId, organizationId: person.organizationId },
    )
  } catch (err) {
    logger.warn('Profile-only company detach broadcast failed', {
      command: 'customers.personCompanyLinks.delete',
      personEntityId: person.id,
      companyEntityId,
      err,
    })
  }
}

/**
 * Undo counterpart of `detachProfileOnlyCompany`: re-point the person's legacy
 * `profile.company` at the company it was detached from. The lookups run in the first
 * flush phase and the assignment in the second so the encryption subscriber's
 * re-baseline on find cannot drop the pending change (#2507).
 */
async function restoreProfileOnlyCompany(
  ctx: CommandRuntimeContext,
  before: PersonCompanyProfileAssignmentSnapshot,
): Promise<void> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
  let person: CustomerEntity | null = null
  let profile: CustomerPersonProfile | null = null
  let company: CustomerEntity | null = null

  await withAtomicFlush(em, [
    async () => {
      if (!await lockPersonForCompanyLinkUpdate(em, before.personEntityId, scope)) return
      person = await findOneWithDecryption(
        em,
        CustomerEntity,
        { id: before.personEntityId, kind: 'person', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
        undefined,
        { tenantId: before.tenantId, organizationId: before.organizationId },
      )
      if (!person) return
      profile = await findOneWithDecryption(
        em,
        CustomerPersonProfile,
        { entity: person, ...scope },
        { populate: ['company'] },
        { tenantId: before.tenantId, organizationId: before.organizationId },
      )
      if (!profile) return
      company = await findOneWithDecryption(
        em,
        CustomerEntity,
        { id: before.companyEntityId, kind: 'company', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
        undefined,
        { tenantId: before.tenantId, organizationId: before.organizationId },
      )
      if (company && await findEndedPersonCompanyLink(em, person, company)) {
        throw conflict('customers.errors.person_company_employment_changed')
      }
    },
    () => {
      if (profile && company) profile.company = company
    },
  ], { transaction: true })

  if (person && profile) {
    await emitQueryIndexUpsertEvents(ctx, personQueryIndexEntries(person, profile))
  }
}

const deletePersonCompanyLinkCommand: CommandHandler<PersonCompanyLinkDeleteInput, PersonCompanyLinkDeleteResult> = {
  id: 'customers.personCompanyLinks.delete',
  async prepare(rawInput, ctx) {
    const parsed = personCompanyLinkDeleteSchema.parse(rawInput)
    const profileOnlyTarget = resolveProfileOnlyTarget(parsed)
    if (profileOnlyTarget) {
      return {
        before: {
          kind: 'profile-only',
          personEntityId: profileOnlyTarget.personEntityId,
          companyEntityId: profileOnlyTarget.companyEntityId,
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
        } satisfies PersonCompanyProfileAssignmentSnapshot,
      }
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadPersonCompanyLinkSnapshot(em, parsed.linkId as string, {
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    })
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = personCompanyLinkDeleteSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const profileOnlyTarget = resolveProfileOnlyTarget(parsed)
    if (profileOnlyTarget) {
      return await detachProfileOnlyCompany(em, ctx, parsed, profileOnlyTarget)
    }

    const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
    const linkWhere = { id: parsed.linkId, ...scope, deletedAt: null, employmentStatus: 'active' as const }
    const candidate = await findOneWithDecryption(em, CustomerPersonCompanyLink, linkWhere, undefined, scope)
    if (!candidate) throw notFound('Company link not found')
    const personId = typeof candidate.person === 'string' ? candidate.person : candidate.person.id
    const companyId = typeof candidate.company === 'string' ? candidate.company : candidate.company.id
    let person!: CustomerEntity
    let profile!: CustomerPersonProfile
    let link!: CustomerPersonCompanyLink
    let remainingLinks: CustomerPersonCompanyLink[] = []
    let linkWasPrimary = false
    await withAtomicFlush(em, [
      async () => {
        if (!await lockPersonForCompanyLinkUpdate(em, personId, scope)) throw notFound('Person not found')
        const currentLink = await findOneWithDecryption(em, CustomerPersonCompanyLink, linkWhere, { refresh: true }, scope)
        if (!currentLink || currentLink.deletedAt || currentLink.employmentStatus === 'ended') {
          throw notFound('Company link not found')
        }
        link = currentLink
        person = await requirePersonEntity(em, personId, scope.tenantId, scope.organizationId)
        profile = await requirePersonProfile(em, person)
        remainingLinks = (await loadPersonCompanyLinks(em, person)).filter((entry) => entry.id !== link.id)
        linkWasPrimary = link.isPrimary
        link.isPrimary = false
        link.deletedAt = new Date()
      },
      async () => {
        if (linkWasPrimary) {
          await promoteFallbackPrimaryLink(em, person, profile, remainingLinks, companyId)
        } else if (profile.company && typeof profile.company !== 'string' && profile.company.id === companyId) {
          const primary = remainingLinks.find((entry) => entry.isPrimary) ?? null
          const primaryCompany = primary && typeof primary.company !== 'string' ? primary.company : null
          if (primaryCompany) {
            profile.company = primaryCompany
          }
        }
      },
    ], { transaction: true })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })

    return { linkId: link.id, personEntityId: personId, companyEntityId: companyId }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PersonCompanyLinkDeleteSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.personCompanyLinks.delete', 'Remove company link'),
      // Kept as `customers.personCompanyLink` for the profile-only shape too: the company
      // detail cache tags this resource kind, so both detach shapes must invalidate it.
      resourceKind: 'customers.personCompanyLink',
      resourceId: result.linkId,
      parentResourceKind: 'customers.person',
      parentResourceId: before?.personEntityId ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: {
        undo: {
          before: before ?? null,
        } satisfies PersonCompanyLinkDeleteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonCompanyLinkDeleteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return

    if (isProfileAssignmentSnapshot(before)) {
      await restoreProfileOnlyCompany(ctx, before)
      return
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const restored: { link?: CustomerPersonCompanyLink } = {}
    let person: CustomerEntity | null = null
    let profile: CustomerPersonProfile | null = null
    let company: CustomerEntity | null = null

    await withAtomicFlush(em, [
      async () => {
        if (!await lockPersonForCompanyLinkUpdate(em, before.personEntityId, scope)) return
        const link = await findOneWithDecryption(
          em, CustomerPersonCompanyLink,
          { id: before.id, person: before.personEntityId, company: before.companyEntityId, ...scope }, undefined, scope,
        )
        if (!link) return
        if (link.employmentStatus === 'ended') throw conflict('customers.errors.person_company_employment_changed')
        restored.link = link
        person = await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: before.personEntityId, kind: 'person', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
          undefined,
          { tenantId: before.tenantId, organizationId: before.organizationId },
        )
        if (!person || !before.isPrimary) return
        profile = await findOneWithDecryption(
          em,
          CustomerPersonProfile,
          { entity: person, ...scope },
          { populate: ['company'] },
          { tenantId: person.tenantId, organizationId: person.organizationId },
        )
        if (!profile) return
        company = await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: before.companyEntityId, kind: 'company', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
          undefined,
          { tenantId: before.tenantId, organizationId: before.organizationId },
        )
      },
      async () => {
        const { link } = restored
        if (!link) return
        if (person && before.isPrimary) await clearPrimaryFlagsForPerson(em, person, link.id)
        link.deletedAt = null
        link.isPrimary = before.isPrimary
        if (before.isPrimary && profile && company) profile.company = company
      },
    ], { transaction: true })

    const { link } = restored
    if (!link) return
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })
  },
}

const employmentResourceKind = 'customers.personCompanyLink'

type EmploymentEndSnapshot = {
  before: PersonCompanyLinkSnapshot | null
  after: PersonCompanyLinkSnapshot
  linkVersion: string
  primaryAssignment: { companyId: string | null; version: string } | null
  promoted: { id: string; wasPrimary: boolean; version: string } | null
}

function getProfileCompanyId(profile: CustomerPersonProfile): string | null {
  return typeof profile.company === 'string' ? profile.company : profile.company?.id ?? null
}

function hasChangedSinceUndo(version: Date, undoneAt?: number): boolean {
  return undoneAt !== undefined && version.getTime() > undoneAt
}

async function endEmployment(
  input: PersonCompanyEmploymentEndInput,
  ctx: CommandRuntimeContext,
  replay?: EmploymentEndSnapshot,
  undoneAt?: number,
): Promise<{ linkId: string; snapshot: EmploymentEndSnapshot }> {
  const parsed = personCompanyEmploymentEndCommandSchema.parse(input)
  const scope = { tenantId: parsed.tenantId, organizationId: parsed.organizationId }
  ensureTenantScope(ctx, scope.tenantId)
  ensureOrganizationScope(ctx, scope.organizationId)

  const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
  let person!: CustomerEntity
  let profile!: CustomerPersonProfile
  let link!: CustomerPersonCompanyLink
  let before: PersonCompanyLinkSnapshot | null = null
  let profileCompanyId: string | null = null
  let fallbackLinks: CustomerPersonCompanyLink[] = []
  let fallbackWasPrimary = false
  let reconcilePrimary = false

  await withAtomicFlush(em, [
    async () => {
      if (!await lockPersonForCompanyLinkUpdate(em, parsed.personEntityId, scope)) {
        throw notFound('customers.errors.person_not_found')
      }
      person = await requirePersonEntity(em, parsed.personEntityId, scope.tenantId, scope.organizationId)
      const company = await requireCompanyEntity(em, parsed.companyEntityId, scope.tenantId, scope.organizationId)
      profile = await requirePersonProfile(em, person)
      profileCompanyId = getProfileCompanyId(profile)
      const where = { ...scope, person, company }
      const current = await findOneWithDecryption(
        em, CustomerPersonCompanyLink, { ...where, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope,
      )
      before = current ? snapshotPersonCompanyLink(current) : null
      if (replay && (!snapshotsEqual(before, replay.before)
        || (current && hasChangedSinceUndo(current.updatedAt, undoneAt))
        || (replay.primaryAssignment && (profileCompanyId !== replay.primaryAssignment.companyId
          || hasChangedSinceUndo(profile.updatedAt, undoneAt))))) {
        throw conflict('customers.errors.person_company_employment_changed')
      }
      if (!current && profileCompanyId !== company.id) {
        enforceRecordGoneIsConflict({ resourceKind: employmentResourceKind, resourceId: company.id, request: ctx.request })
        throw notFound('customers.errors.person_company_link_not_found')
      }
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: employmentResourceKind,
        resourceId: current?.id ?? profile.id,
        current: current?.updatedAt ?? profile.updatedAt,
        request: ctx.request,
      })
      if (current?.employmentStatus === 'ended') {
        throw notFound('customers.errors.person_company_link_not_found')
      }

      reconcilePrimary = Boolean(current?.isPrimary) || profileCompanyId === company.id
      if (reconcilePrimary) {
        fallbackLinks = (await loadPersonCompanyLinks(em, person)).filter((candidate) => candidate.id !== current?.id)
        fallbackWasPrimary = fallbackLinks[0]?.isPrimary ?? false
        if (replay && ((fallbackLinks[0]?.id ?? null) !== (replay.promoted?.id ?? null)
          || (replay.promoted && (fallbackWasPrimary !== replay.promoted.wasPrimary
            || hasChangedSinceUndo(fallbackLinks[0].updatedAt, undoneAt))))) {
          throw conflict('customers.errors.person_company_employment_changed')
        }
      }
      const replayLink = !current && replay
        ? await findOneWithDecryption(em, CustomerPersonCompanyLink, { ...where, id: replay.after.id, deletedAt: { $ne: null } }, undefined, scope)
        : null
      if (replay && !current && (!replayLink || hasChangedSinceUndo(replayLink.updatedAt, undoneAt))) {
        throw conflict('customers.errors.person_company_employment_changed')
      }
      link = current ?? replayLink ?? em.create(CustomerPersonCompanyLink, { ...where })
      link.deletedAt = null
      link.isPrimary = false
      link.employmentStatus = 'ended'
      link.employmentEndedOn = parsed.endedOn
      em.persist(link)
    },
    async () => {
      if (reconcilePrimary) await promoteFallbackPrimaryLink(em, person, profile, fallbackLinks, parsed.companyEntityId)
    },
  ], { transaction: true })

  const fallback = fallbackLinks[0]
  const snapshot: EmploymentEndSnapshot = {
    before,
    after: snapshotPersonCompanyLink(link),
    linkVersion: link.updatedAt.toISOString(),
    primaryAssignment: reconcilePrimary ? { companyId: profileCompanyId, version: profile.updatedAt.toISOString() } : null,
    promoted: fallback ? { id: fallback.id, wasPrimary: fallbackWasPrimary, version: fallback.updatedAt.toISOString() } : null,
  }
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action: 'updated',
    entity: link,
    identifiers: getLinkIdentifiers(link),
    syncOrigin: ctx.syncOrigin,
    events: personCompanyLinkCrudEvents,
    indexer: { entityType: 'customers:customer_person_company_link' },
  })
  return { linkId: link.id, snapshot }
}

const endEmploymentCommand: CommandHandler<
  PersonCompanyEmploymentEndInput,
  Awaited<ReturnType<typeof endEmployment>>
> = {
  id: 'customers.personCompanyLinks.endEmployment',
  atomicReplay: true,
  execute: (input, ctx) => endEmployment(input, ctx),
  async buildLog({ result }) {
    const { translate } = await resolveTranslations()
    const { before, after } = result.snapshot
    return {
      actionLabel: translate('customers.audit.personCompanyLinks.endEmployment', 'End employment'),
      resourceKind: employmentResourceKind,
      resourceId: result.linkId,
      parentResourceKind: 'customers.person',
      parentResourceId: after.personEntityId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: result.snapshot },
    }
  },
  async undo({ logEntry, ctx }) {
    const snapshot = extractUndoPayload<EmploymentEndSnapshot>(logEntry)
    if (!snapshot) return
    const { before, after, linkVersion, primaryAssignment, promoted } = snapshot
    const scope = { tenantId: after.tenantId, organizationId: after.organizationId }
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    let link!: CustomerPersonCompanyLink
    await withAtomicFlush(em, [async () => {
      if (!await lockPersonForCompanyLinkUpdate(em, after.personEntityId, scope)) {
        throw conflict('customers.errors.person_company_employment_changed')
      }
      const person = await requirePersonEntity(em, after.personEntityId, scope.tenantId, scope.organizationId)
      await requireCompanyEntity(em, after.companyEntityId, scope.tenantId, scope.organizationId)
      const found = await findOneWithDecryption(
        em, CustomerPersonCompanyLink,
        { ...scope, id: after.id, person, company: after.companyEntityId, deletedAt: null, employmentStatus: 'ended' },
        { lockMode: LockMode.PESSIMISTIC_WRITE }, scope,
      )
      if (!found || found.updatedAt.toISOString() !== linkVersion) {
        throw conflict('customers.errors.person_company_employment_changed')
      }
      link = found
      if (primaryAssignment) {
        const profile = await requirePersonProfile(em, person)
        const fallback = promoted ? await findOneWithDecryption(
          em, CustomerPersonCompanyLink,
          { ...scope, id: promoted.id, person, deletedAt: null, employmentStatus: 'active' },
          { lockMode: LockMode.PESSIMISTIC_WRITE }, scope,
        ) : null
        const priorCompany = primaryAssignment.companyId
          ? await requireCompanyEntity(em, primaryAssignment.companyId, scope.tenantId, scope.organizationId)
          : null
        if (profile.updatedAt.toISOString() !== primaryAssignment.version
          || (promoted && fallback?.updatedAt.toISOString() !== promoted.version)) {
          throw conflict('customers.errors.person_company_employment_changed')
        }
        profile.company = priorCompany
        if (fallback && promoted) fallback.isPrimary = promoted.wasPrimary
      }
      link.isPrimary = before?.isPrimary ?? false
      link.employmentStatus = before?.employmentStatus ?? 'active'
      link.employmentEndedOn = before?.employmentEndedOn ?? null
      if (!before) link.deletedAt = new Date()
    }], { transaction: true })
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
      action: 'updated',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })
  },
  async redo({ input, ctx, logEntry }) {
    const snapshot = extractUndoPayload<EmploymentEndSnapshot>(logEntry)
    if (!snapshot) throw conflict('customers.errors.person_company_employment_changed')
    const undoneAt = logEntry.updatedAt === undefined ? undefined : new Date(logEntry.updatedAt).getTime()
    return endEmployment(input, ctx, snapshot, undoneAt)
  },
}

registerCommand(createPersonCompanyLinkCommand)
registerCommand(updatePersonCompanyLinkCommand)
registerCommand(deletePersonCompanyLinkCommand)
registerCommand(endEmploymentCommand)
