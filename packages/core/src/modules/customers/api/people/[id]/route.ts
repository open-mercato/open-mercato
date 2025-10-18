import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerEntity,
  CustomerPersonProfile,
  CustomerAddress,
  CustomerComment,
  CustomerActivity,
  CustomerTagAssignment,
  CustomerTag,
  CustomerDealPersonLink,
  CustomerDeal,
  CustomerTodoLink,
} from '../../../data/entities'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
}

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 })
}

function serializeTags(assignments: CustomerTagAssignment[]): Array<{ id: string; label: string; color?: string | null }> {
  return assignments
    .map((assignment) => {
      const tag = assignment.tag as CustomerTag | string | null
      if (!tag || typeof tag === 'string') return null
      return {
        id: tag.id,
        label: tag.label,
        color: tag.color ?? null,
      }
    })
    .filter((tag): tag is { id: string; label: string; color?: string | null } => !!tag)
}

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid person id' }, { status: 400 })

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: _req })
  const em = container.resolve<EntityManager>('em')

  const person = await em.findOne(
    CustomerEntity,
    { id: parse.data.id, kind: 'person', deletedAt: null },
    {
      populate: [
        'personProfile',
        'personProfile.company',
        'personProfile.company.companyProfile',
      ],
    }
  )
  if (!person) return notFound('Person not found')

  if (auth.tenantId && person.tenantId !== auth.tenantId) return notFound('Person not found')
  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size && person.organizationId && !allowedOrgIds.has(person.organizationId)) {
    return forbidden('Access denied')
  }

  const profile = await em.findOne(CustomerPersonProfile, { entity: person })
  const addresses = await em.find(CustomerAddress, { entity: person.id }, { orderBy: { isPrimary: 'desc', createdAt: 'desc' } })
  const comments = await em.find(CustomerComment, { entity: person.id }, { orderBy: { createdAt: 'desc' }, limit: 50 })
  const activities = await em.find(CustomerActivity, { entity: person.id }, { orderBy: { occurredAt: 'desc', createdAt: 'desc' }, limit: 50 })
  const tagAssignments = await em.find(CustomerTagAssignment, { entity: person.id }, { populate: ['tag'] })
  const todoLinks = await em.find(CustomerTodoLink, { entity: person.id }, { orderBy: { createdAt: 'desc' }, limit: 50 })

  const dealLinks = await em.find(CustomerDealPersonLink, { person: person.id }, { populate: ['deal'] })
  const deals: CustomerDeal[] = []
  for (const link of dealLinks) {
    const deal = (link.deal as CustomerDeal | string | null) ?? null
    if (deal && typeof deal !== 'string') deals.push(deal)
  }

  const customFieldValues = await loadCustomFieldValues({
    em,
    entityId: E.customers.customer_entity,
    recordIds: [person.id],
    tenantIdByRecord: { [person.id]: person.tenantId ?? null },
    organizationIdByRecord: { [person.id]: person.organizationId ?? null },
    tenantFallbacks: [person.tenantId ?? auth.tenantId ?? null].filter((v): v is string => !!v),
  })

  return NextResponse.json({
    person: {
      id: person.id,
      displayName: person.displayName,
      description: person.description,
      ownerUserId: person.ownerUserId,
      primaryEmail: person.primaryEmail,
      primaryPhone: person.primaryPhone,
      status: person.status,
      lifecycleStage: person.lifecycleStage,
      source: person.source,
      nextInteractionAt: person.nextInteractionAt ? person.nextInteractionAt.toISOString() : null,
      nextInteractionName: person.nextInteractionName,
      nextInteractionRefId: person.nextInteractionRefId,
      organizationId: person.organizationId,
      tenantId: person.tenantId,
      isActive: person.isActive,
      createdAt: person.createdAt.toISOString(),
      updatedAt: person.updatedAt.toISOString(),
    },
    profile: profile
      ? {
          id: profile.id,
          firstName: profile.firstName,
          lastName: profile.lastName,
          preferredName: profile.preferredName,
          jobTitle: profile.jobTitle,
          department: profile.department,
          seniority: profile.seniority,
          timezone: profile.timezone,
          linkedInUrl: profile.linkedInUrl,
          twitterUrl: profile.twitterUrl,
          companyEntityId: profile.company ? (typeof profile.company === 'string' ? profile.company : profile.company.id) : null,
        }
      : null,
    customFields: customFieldValues?.[person.id] ?? {},
    tags: serializeTags(tagAssignments),
    addresses: addresses.map((address) => ({
      id: address.id,
      name: address.name,
      purpose: address.purpose,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      buildingNumber: address.buildingNumber,
      flatNumber: address.flatNumber,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
      latitude: address.latitude,
      longitude: address.longitude,
      isPrimary: address.isPrimary,
      createdAt: address.createdAt.toISOString(),
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorUserId: comment.authorUserId,
      dealId: comment.deal ? (typeof comment.deal === 'string' ? comment.deal : comment.deal.id) : null,
      createdAt: comment.createdAt.toISOString(),
    })),
    activities: activities.map((activity) => ({
      id: activity.id,
      activityType: activity.activityType,
      subject: activity.subject,
      body: activity.body,
      occurredAt: activity.occurredAt ? activity.occurredAt.toISOString() : null,
      dealId: activity.deal ? (typeof activity.deal === 'string' ? activity.deal : activity.deal.id) : null,
      authorUserId: activity.authorUserId,
      createdAt: activity.createdAt.toISOString(),
    })),
    deals: deals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      status: deal.status,
      pipelineStage: deal.pipelineStage,
      valueAmount: deal.valueAmount,
      valueCurrency: deal.valueCurrency,
      probability: deal.probability,
      expectedCloseAt: deal.expectedCloseAt ? deal.expectedCloseAt.toISOString() : null,
      ownerUserId: deal.ownerUserId,
      source: deal.source,
      createdAt: deal.createdAt.toISOString(),
      updatedAt: deal.updatedAt.toISOString(),
    })),
    todos: todoLinks.map((link) => ({
      id: link.id,
      todoId: link.todoId,
      todoSource: link.todoSource,
      createdAt: link.createdAt.toISOString(),
      createdByUserId: link.createdByUserId,
    })),
  })
}
