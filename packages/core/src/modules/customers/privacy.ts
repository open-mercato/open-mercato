import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type {
  PrivacyDataClassHandler,
  PrivacyEnvironmentSanitizationInput,
  PrivacySubjectInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import {
  CustomerActivity,
  CustomerAddress,
  CustomerComment,
  CustomerEntity,
  CustomerInteraction,
  CustomerPersonProfile,
} from './data/entities'
import { CUSTOMER_ENTITY_ID, PERSON_ENTITY_ID } from './lib/customFieldRouting'
import { emitCustomersEvent } from './events'
import { emitQueryIndexUpsertEvents } from './commands/shared'

export const CUSTOMER_PEOPLE_DATA_CLASS_ID = 'customers.people'

registerPrivacyDataClass({
  id: CUSTOMER_PEOPLE_DATA_CLASS_ID,
  module: 'customers',
  title: 'Customer people',
  description: 'Customer person profiles and directly attached personal records.',
  handlerService: 'customerPeoplePrivacyHandler',
  subjectKinds: ['customers:person'],
  subjectActions: ['discover', 'export', 'erase', 'anonymize'],
  environmentSanitization: { categories: ['personal_data'] },
})

export class CustomerPeoplePrivacyHandler implements PrivacyDataClassHandler {
  constructor(
    private readonly em: EntityManager,
    private readonly commandBus: CommandBus,
  ) {}

  async discoverSubject(input: PrivacySubjectInput) {
    const entity = await this.findEntity(input)
    return { found: entity !== null, recordCount: entity ? 1 : 0 }
  }

  async exportSubject(input: PrivacySubjectInput) {
    const entity = await this.findEntity(input)
    if (!entity) return { recordCount: 0, data: null }
    const [profile, addresses, activities, comments, interactions] = await Promise.all([
      findOneWithDecryption(this.em, CustomerPersonProfile, {
        entity: entity.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      }, {}, input.scope),
      findWithDecryption(this.em, CustomerAddress, this.scopedRelationFilter(entity.id, input), {}, input.scope),
      findWithDecryption(this.em, CustomerActivity, this.scopedRelationFilter(entity.id, input), {}, input.scope),
      findWithDecryption(this.em, CustomerComment, this.scopedRelationFilter(entity.id, input), {}, input.scope),
      findWithDecryption(this.em, CustomerInteraction, {
        ...this.scopedRelationFilter(entity.id, input),
        deletedAt: null,
      }, {}, input.scope),
    ])

    return {
      recordCount: 1 + (profile ? 1 : 0) + addresses.length + activities.length + comments.length + interactions.length,
      data: {
        person: {
          id: entity.id,
          displayName: entity.displayName,
          description: entity.description ?? null,
          primaryEmail: entity.primaryEmail ?? null,
          primaryPhone: entity.primaryPhone ?? null,
          createdAt: entity.createdAt.toISOString(),
        },
        profile: profile ? {
          firstName: profile.firstName ?? null,
          lastName: profile.lastName ?? null,
          preferredName: profile.preferredName ?? null,
          jobTitle: profile.jobTitle ?? null,
          department: profile.department ?? null,
          seniority: profile.seniority ?? null,
          timezone: profile.timezone ?? null,
          linkedInUrl: profile.linkedInUrl ?? null,
          twitterUrl: profile.twitterUrl ?? null,
        } : null,
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
        })),
        activities: activities.map((activity) => ({
          id: activity.id,
          type: activity.activityType,
          subject: activity.subject ?? null,
          body: activity.body ?? null,
          occurredAt: activity.occurredAt?.toISOString() ?? null,
        })),
        comments: comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
        })),
        interactions: interactions.map((interaction) => ({
          id: interaction.id,
          type: interaction.interactionType,
          title: interaction.title ?? null,
          body: interaction.body ?? null,
          participants: interaction.participants ?? null,
          scheduledAt: interaction.scheduledAt?.toISOString() ?? null,
          occurredAt: interaction.occurredAt?.toISOString() ?? null,
        })),
      },
    }
  }

  async eraseSubject(input: PrivacySubjectInput) {
    const entity = await this.findEntity(input)
    if (!entity) return { affected: 0 }
    if (input.dryRun) return { affected: 1 }
    const commandContext = requireCommandContext(input)
    await this.commandBus.execute('customers.people.delete', {
      input: { body: { id: entity.id } },
      ctx: commandContext,
      metadata: { skipLog: true },
    })
    return { affected: 1 }
  }

  async anonymizeSubject(input: PrivacySubjectInput) {
    const entity = await this.findEntity(input)
    if (!entity) return { affected: 0 }
    if (input.dryRun) return { affected: 1 }
    const commandContext = requireCommandContext(input)

    await this.em.transactional(async (transactionalEm) => {
      const managedEntity = await findOneWithDecryption(
        transactionalEm,
        CustomerEntity,
        {
          id: entity.id,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
          kind: 'person',
          deletedAt: null,
        },
        {},
        input.scope,
      )
      if (!managedEntity) return
      const profile = await findOneWithDecryption(
        transactionalEm,
        CustomerPersonProfile,
        {
          entity: managedEntity.id,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
        },
        {},
        input.scope,
      )

      managedEntity.displayName = `Anonymized ${managedEntity.id.slice(0, 8)}`
      managedEntity.description = null
      managedEntity.primaryEmail = null
      managedEntity.primaryPhone = null
      if (profile) {
        profile.firstName = null
        profile.lastName = null
        profile.preferredName = null
        profile.jobTitle = null
        profile.department = null
        profile.seniority = null
        profile.timezone = null
        profile.linkedInUrl = null
        profile.twitterUrl = null
      }
      await transactionalEm.nativeDelete(CustomerAddress, this.scopedRelationFilter(managedEntity.id, input))
      await transactionalEm.nativeDelete(CustomerActivity, this.scopedRelationFilter(managedEntity.id, input))
      await transactionalEm.nativeDelete(CustomerComment, this.scopedRelationFilter(managedEntity.id, input))
      await transactionalEm.nativeDelete(CustomerInteraction, this.scopedRelationFilter(managedEntity.id, input))
      await transactionalEm.nativeDelete(CustomFieldValue, {
        entityId: CUSTOMER_ENTITY_ID,
        recordId: managedEntity.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      })
      if (profile) {
        await transactionalEm.nativeDelete(CustomFieldValue, {
          entityId: PERSON_ENTITY_ID,
          recordId: profile.id,
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
        })
      }
      transactionalEm.persist(managedEntity)
      if (profile) transactionalEm.persist(profile)
      await transactionalEm.flush()
    })

    await emitCustomersEvent('customers.person.updated', {
      id: entity.id,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    })
    await emitQueryIndexUpsertEvents(commandContext, [{
      entityType: 'customers:customer_entity',
      recordId: entity.id,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    }])
    return { affected: 1 }
  }

  async sanitizeEnvironment(input: PrivacyEnvironmentSanitizationInput) {
    const people = await this.findScopedPeople(input)
    const relationCounts = await this.countScopedPersonalRelations(input)
    const matched = people.length + relationCounts
    if (input.dryRun || matched === 0) return { matched, affected: 0 }

    await this.em.transactional(async (transactionalEm) => {
      const managedPeople = await findWithDecryption(
        transactionalEm,
        CustomerEntity,
        {
          tenantId: input.scope.tenantId,
          organizationId: input.scope.organizationId,
          kind: 'person',
          deletedAt: null,
        },
        {},
        input.scope,
      )
      for (const person of managedPeople) {
        person.displayName = `Anonymized ${person.id.slice(0, 8)}`
        person.description = null
        person.primaryEmail = null
        person.primaryPhone = null
        transactionalEm.persist(person)
      }
      await transactionalEm.nativeUpdate(CustomerPersonProfile, {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      }, {
        firstName: null,
        lastName: null,
        preferredName: null,
        jobTitle: null,
        department: null,
        seniority: null,
        timezone: null,
        linkedInUrl: null,
        twitterUrl: null,
      })
      const scope = {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      }
      await transactionalEm.nativeDelete(CustomerAddress, scope)
      await transactionalEm.nativeDelete(CustomerActivity, scope)
      await transactionalEm.nativeDelete(CustomerComment, scope)
      await transactionalEm.nativeDelete(CustomerInteraction, scope)
      await transactionalEm.nativeDelete(CustomFieldValue, {
        ...scope,
        entityId: { $in: [CUSTOMER_ENTITY_ID, PERSON_ENTITY_ID] },
      })
      await transactionalEm.flush()
    })

    return { matched, affected: matched }
  }

  async verifyEnvironmentSanitization(input: PrivacyEnvironmentSanitizationInput) {
    const people = await this.findScopedPeople(input)
    const unsafePeople = people.filter((person) => (
      person.description
      || person.primaryEmail
      || person.primaryPhone
      || !person.displayName.startsWith('Anonymized ')
    )).length
    const profiles = await findWithDecryption(
      this.em,
      CustomerPersonProfile,
      {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
      },
      {},
      input.scope,
    )
    const unsafeProfiles = profiles.filter((profile) => [
      profile.firstName,
      profile.lastName,
      profile.preferredName,
      profile.jobTitle,
      profile.department,
      profile.seniority,
      profile.timezone,
      profile.linkedInUrl,
      profile.twitterUrl,
    ].some(Boolean)).length
    const relatedRecords = await this.countScopedPersonalRelations(input)
    const findings = [
      { code: 'customers.people_not_sanitized', count: unsafePeople },
      { code: 'customers.profiles_not_sanitized', count: unsafeProfiles },
      { code: 'customers.personal_relations_present', count: relatedRecords },
    ].filter((finding) => finding.count > 0)
    return { passed: findings.length === 0, findings }
  }

  private findEntity(input: PrivacySubjectInput): Promise<CustomerEntity | null> {
    return findOneWithDecryption(
      this.em,
      CustomerEntity,
      {
        id: input.subject.id,
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        kind: 'person',
        deletedAt: null,
      },
      {},
      input.scope,
    )
  }

  private findScopedPeople(input: PrivacyEnvironmentSanitizationInput): Promise<CustomerEntity[]> {
    return findWithDecryption(
      this.em,
      CustomerEntity,
      {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        kind: 'person',
        deletedAt: null,
      },
      {},
      input.scope,
    )
  }

  private async countScopedPersonalRelations(input: PrivacyEnvironmentSanitizationInput): Promise<number> {
    const scope = {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    }
    const [addresses, activities, comments, interactions, customFields] = await Promise.all([
      this.em.count(CustomerAddress, scope),
      this.em.count(CustomerActivity, scope),
      this.em.count(CustomerComment, scope),
      this.em.count(CustomerInteraction, scope),
      this.em.count(CustomFieldValue, {
        ...scope,
        entityId: { $in: [CUSTOMER_ENTITY_ID, PERSON_ENTITY_ID] },
      }),
    ])
    return addresses + activities + comments + interactions + customFields
  }

  private scopedRelationFilter(entityId: string, input: PrivacySubjectInput) {
    return {
      entity: entityId,
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    }
  }
}

function requireCommandContext(input: PrivacySubjectInput): CommandRuntimeContext {
  if (!input.commandContext) {
    throw new Error('[internal] Privacy subject mutation requires a command context')
  }
  return input.commandContext
}
