import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '../data/entities'
import {
  personCompanyLinkCreateSchema,
  personCompanyLinkDeleteSchema,
  personCompanyLinkUpdateSchema,
  type PersonCompanyLinkCreateInput,
  type PersonCompanyLinkDeleteInput,
  type PersonCompanyLinkUpdateInput,
} from '../data/validators'
import {
  findDeletedPersonCompanyLink,
  loadPersonCompanyLinks,
  promoteFallbackPrimaryLink,
} from '../lib/personCompanies'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'

type PersonCompanyLinkSnapshot = {
  id: string
  personEntityId: string
  companyEntityId: string
  isPrimary: boolean
  tenantId: string
  organizationId: string
  deletedAt: string | null
}

type PersonCompanyLinkUndoPayload = {
  before?: PersonCompanyLinkSnapshot | null
  after?: PersonCompanyLinkSnapshot | null
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
    throw new CrudHttpError(404, { error: 'Person not found' })
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
    throw new CrudHttpError(404, { error: 'Company not found' })
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
    { entity: person },
    { populate: ['company'] },
    { tenantId: person.tenantId, organizationId: person.organizationId },
  )
  if (!profile) {
    throw new CrudHttpError(404, { error: 'Person profile not found' })
  }
  return profile
}

async function clearPrimaryFlagsForPerson(em: EntityManager, person: CustomerEntity): Promise<void> {
  await em.nativeUpdate(
    CustomerPersonCompanyLink,
    { person, organizationId: person.organizationId, tenantId: person.tenantId, isPrimary: true },
    { isPrimary: false },
  )
}

const createPersonCompanyLinkCommand: CommandHandler<PersonCompanyLinkCreateInput, { linkId: string; created: boolean; undeleted: boolean }> = {
  id: 'customers.personCompanyLinks.create',
  async execute(rawInput, ctx) {
    const parsed = personCompanyLinkCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const person = await requirePersonEntity(em, parsed.personEntityId, parsed.tenantId, parsed.organizationId)
    const company = await requireCompanyEntity(em, parsed.companyEntityId, parsed.tenantId, parsed.organizationId)
    const profile = await requirePersonProfile(em, person)

    const existingLinks = await loadPersonCompanyLinks(em, person)
    const makePrimary = Boolean(parsed.isPrimary) || existingLinks.length === 0
    const existingLive =
      existingLinks.find((link) => (typeof link.company === 'string' ? link.company : link.company.id) === company.id) ?? null

    if (existingLive) {
      if (makePrimary && !existingLive.isPrimary) {
        await withAtomicFlush(em, [
          () => clearPrimaryFlagsForPerson(em, person),
          () => {
            existingLive.isPrimary = true
            profile.company = company
          },
        ], { transaction: true })
      }
      return { linkId: existingLive.id, created: false, undeleted: false }
    }

    let link!: CustomerPersonCompanyLink
    let undeleted = false
    await withAtomicFlush(em, [
      async () => {
        const deletedLink = await findDeletedPersonCompanyLink(em, person, company)
        if (makePrimary) {
          await clearPrimaryFlagsForPerson(em, person)
        }
        if (deletedLink) {
          deletedLink.deletedAt = null
          deletedLink.isPrimary = makePrimary
          em.persist(deletedLink)
          link = deletedLink
          undeleted = true
        } else {
          link = em.create(CustomerPersonCompanyLink, {
            organizationId: parsed.organizationId,
            tenantId: parsed.tenantId,
            person,
            company,
            isPrimary: makePrimary,
          })
          em.persist(link)
        }
      },
      () => {
        if (makePrimary) {
          profile.company = company
        } else if (!profile.company && existingLinks.length === 0) {
          profile.company = company
          link.isPrimary = true
        }
      },
    ], { transaction: true })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: undeleted ? 'updated' : 'created',
      entity: link,
      identifiers: getLinkIdentifiers(link),
      syncOrigin: ctx.syncOrigin,
      events: personCompanyLinkCrudEvents,
      indexer: { entityType: 'customers:customer_person_company_link' },
    })

    return { linkId: link.id, created: !undeleted, undeleted }
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
    const after = snapshots.after as PersonCompanyLinkSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.personCompanyLinks.create', 'Link company to person'),
      resourceKind: 'customers.personCompanyLink',
      resourceId: result.linkId,
      parentResourceKind: 'customers.person',
      parentResourceId: after?.personEntityId ?? null,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          after: after ?? null,
          ...(result.undeleted ? { before: null } : {}),
        } satisfies PersonCompanyLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonCompanyLinkUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await findOneWithDecryption(
      em,
      CustomerPersonCompanyLink,
      { id: after.id },
      undefined,
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    if (!link) return

    link.isPrimary = false
    link.deletedAt = new Date()
    await em.flush()

    const person = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: after.personEntityId, kind: 'person', tenantId: after.tenantId, organizationId: after.organizationId, deletedAt: null },
      undefined,
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    if (person) {
      const profile = await findOneWithDecryption(
        em,
        CustomerPersonProfile,
        { entity: person },
        { populate: ['company'] },
        { tenantId: person.tenantId, organizationId: person.organizationId },
      )
      if (profile) {
        const remainingLinks = await loadPersonCompanyLinks(em, person)
        if (after.isPrimary) {
          await promoteFallbackPrimaryLink(em, person, profile, remainingLinks, after.companyEntityId)
        } else if (profile.company && typeof profile.company !== 'string' && profile.company.id === after.companyEntityId) {
          profile.company = null
        }
        await em.flush()
      }
    }

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
}

const updatePersonCompanyLinkCommand: CommandHandler<PersonCompanyLinkUpdateInput, { linkId: string }> = {
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
    const link = await findOneWithDecryption(
      em,
      CustomerPersonCompanyLink,
      {
        id: parsed.linkId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!link) {
      throw new CrudHttpError(404, { error: 'Company link not found' })
    }

    const personId = typeof link.person === 'string' ? link.person : link.person.id
    const companyId = typeof link.company === 'string' ? link.company : link.company.id
    const person = await requirePersonEntity(em, personId, parsed.tenantId, parsed.organizationId)
    const profile = await requirePersonProfile(em, person)
    const linkedCompany = await requireCompanyEntity(em, companyId, parsed.tenantId, parsed.organizationId)

    if (parsed.isPrimary) {
      await clearPrimaryFlagsForPerson(em, person)
      link.isPrimary = true
      profile.company = linkedCompany
    } else if (!parsed.isPrimary) {
      const linkWasPrimary = link.isPrimary
      link.isPrimary = false
      if (linkWasPrimary) {
        const remainingLinks = (await loadPersonCompanyLinks(em, person)).filter((entry) => entry.id !== link.id)
        await promoteFallbackPrimaryLink(em, person, profile, remainingLinks, companyId)
      } else if (profile.company && typeof profile.company !== 'string' && profile.company.id === companyId) {
        profile.company = null
      }
    }
    await em.flush()

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

    return { linkId: link.id }
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
        } satisfies PersonCompanyLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonCompanyLinkUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await findOneWithDecryption(
      em,
      CustomerPersonCompanyLink,
      { id: before.id },
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (!link) return

    const person = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: before.personEntityId, kind: 'person', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (person) {
      const profile = await findOneWithDecryption(
        em,
        CustomerPersonProfile,
        { entity: person },
        { populate: ['company'] },
        { tenantId: person.tenantId, organizationId: person.organizationId },
      )
      if (profile) {
        if (before.isPrimary) {
          await clearPrimaryFlagsForPerson(em, person)
          link.isPrimary = true
          const company = await findOneWithDecryption(
            em,
            CustomerEntity,
            { id: before.companyEntityId, kind: 'company', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
            undefined,
            { tenantId: before.tenantId, organizationId: before.organizationId },
          )
          if (company) profile.company = company
        } else {
          link.isPrimary = false
        }
      }
    }
    await em.flush()

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

const deletePersonCompanyLinkCommand: CommandHandler<PersonCompanyLinkDeleteInput, { linkId: string }> = {
  id: 'customers.personCompanyLinks.delete',
  async prepare(rawInput, ctx) {
    const parsed = personCompanyLinkDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadPersonCompanyLinkSnapshot(em, parsed.linkId, {
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
    const link = await findOneWithDecryption(
      em,
      CustomerPersonCompanyLink,
      {
        id: parsed.linkId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        deletedAt: null,
      },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!link) {
      throw new CrudHttpError(404, { error: 'Company link not found' })
    }

    const personId = typeof link.person === 'string' ? link.person : link.person.id
    const companyId = typeof link.company === 'string' ? link.company : link.company.id
    const person = await requirePersonEntity(em, personId, parsed.tenantId, parsed.organizationId)
    const profile = await requirePersonProfile(em, person)
    const linkWasPrimary = link.isPrimary

    await withAtomicFlush(em, [
      () => {
        link.isPrimary = false
        link.deletedAt = new Date()
      },
      async () => {
        const existingLinks = await loadPersonCompanyLinks(em, person)
        const remainingLinks = existingLinks.filter((entry) => entry.id !== link.id)
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

    return { linkId: link.id }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as PersonCompanyLinkSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.personCompanyLinks.delete', 'Remove company link'),
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
        } satisfies PersonCompanyLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<PersonCompanyLinkUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await findOneWithDecryption(
      em,
      CustomerPersonCompanyLink,
      { id: before.id },
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (!link) return

    link.deletedAt = null
    link.isPrimary = before.isPrimary

    const person = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: before.personEntityId, kind: 'person', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (person && before.isPrimary) {
      await clearPrimaryFlagsForPerson(em, person)
      link.isPrimary = true
      const profile = await findOneWithDecryption(
        em,
        CustomerPersonProfile,
        { entity: person },
        { populate: ['company'] },
        { tenantId: person.tenantId, organizationId: person.organizationId },
      )
      if (profile) {
        const company = await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: before.companyEntityId, kind: 'company', tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
          undefined,
          { tenantId: before.tenantId, organizationId: before.organizationId },
        )
        if (company) profile.company = company
      }
    }

    await em.flush()

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

registerCommand(createPersonCompanyLinkCommand)
registerCommand(updatePersonCompanyLinkCommand)
registerCommand(deletePersonCompanyLinkCommand)
