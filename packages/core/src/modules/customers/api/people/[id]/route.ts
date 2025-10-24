import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
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
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { mergePersonCustomFieldValues, resolvePersonCustomFieldRouting } from '../../../lib/customFieldRouting'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@/modules/entities'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

function parseIncludeParams(request: Request): Set<string> {
  const url = new URL(request.url)
  const raw = url.searchParams.getAll('include')
  const tokens = new Set<string>()
  raw.forEach((entry) => {
    if (!entry) return
    entry
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0)
      .forEach((part) => tokens.add(part))
  })
  return tokens
}

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

type TodoDetail = {
  title: string | null
  isDone: boolean | null
  priority: number | null
  dueAt: string | null
  organizationId: string | null
}

function extractTodoTitle(record: Record<string, unknown>): string | null {
  const candidates = ['title', 'subject', 'name', 'summary', 'text', 'description']
  for (const key of candidates) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function parseDateValue(value: unknown): string | null {
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isNaN(ts) ? null : value.toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const candidate = new Date(trimmed)
    if (!Number.isNaN(candidate.getTime())) return candidate.toISOString()
  }
  return null
}

function readCustomField(record: Record<string, unknown>, key: string): unknown {
  const custom = record.custom ?? record.customFields ?? record.cf
  if (custom && typeof custom === 'object') {
    const bucket = custom as Record<string, unknown>
    if (key in bucket) return bucket[key]
  }
  return undefined
}

async function resolveTodoDetails(
  queryEngine: QueryEngine,
  links: CustomerTodoLink[],
  tenantId: string | null,
  organizationIds: Array<string | null>,
): Promise<Map<string, TodoDetail>> {
  const details = new Map<string, TodoDetail>()
  if (!links.length || !tenantId) return details

  const scopedOrgIds = organizationIds
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  const idsBySource = new Map<string, Set<string>>()
  for (const link of links) {
    const source = typeof link.todoSource === 'string' && link.todoSource.trim().length > 0 ? link.todoSource : 'example:todo'
    const id = typeof link.todoId === 'string' && link.todoId.trim().length > 0 ? link.todoId : String(link.todoId ?? '')
    if (!id) continue
    if (!idsBySource.has(source)) idsBySource.set(source, new Set<string>())
    idsBySource.get(source)!.add(id)
  }

  for (const [source, idSet] of idsBySource.entries()) {
    const ids = Array.from(idSet)
    if (!ids.length) continue
    try {
      const result = await queryEngine.query<Record<string, unknown>>(source as EntityId, {
        tenantId,
        organizationIds: scopedOrgIds.length > 0 ? scopedOrgIds : undefined,
        filters: { id: { $in: ids } },
        fields: ['id', 'title', 'subject', 'name', 'summary', 'text', 'description', 'is_done', 'organization_id', 'due_at', 'cf:priority', 'cf:due_at'],
        includeCustomFields: ['priority', 'due_at'],
        page: { page: 1, pageSize: Math.max(ids.length, 1) },
      })
      for (const item of result.items ?? []) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const rawId = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : String(record.id ?? '')
        if (!rawId) continue
        const title = extractTodoTitle(record)
        const isDone = (() => {
          const direct = parseBoolean(record.is_done)
          if (direct !== null) return direct
          const custom = parseBoolean(readCustomField(record, 'is_done'))
          if (custom !== null) return custom
          const generic = parseBoolean(record.isDone)
          if (generic !== null) return generic
          return parseBoolean(readCustomField(record, 'isDone'))
        })()
        const priority = (() => {
          const candidates = [
            record['cf:priority'],
            record['cf_priority'],
            record.priority,
            readCustomField(record, 'priority'),
          ]
          for (const candidate of candidates) {
            const parsed = parseNumber(candidate)
            if (parsed !== null) return parsed
          }
          return null
        })()
        const dueAt = (() => {
          const candidates = [
            record.due_at,
            record.dueAt,
            record['cf:due_at'],
            record['cf_due_at'],
            readCustomField(record, 'due_at'),
            readCustomField(record, 'dueAt'),
          ]
          for (const candidate of candidates) {
            const parsed = parseDateValue(candidate)
            if (parsed) return parsed
          }
          return null
        })()
        const organizationId = typeof record.organization_id === 'string' && record.organization_id.trim().length > 0
          ? record.organization_id
          : (typeof record.organizationId === 'string' && record.organizationId.trim().length > 0 ? record.organizationId : null)

        details.set(`${source}:${rawId}`, {
          title,
          isDone,
          priority,
          dueAt,
          organizationId,
        })
      }
    } catch (err) {
      console.warn(`customers.people.detail: failed to resolve todos for source ${source}`, err)
    }
  }

  return details
}

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid person id' }, { status: 400 })

  const includeTokens = parseIncludeParams(_req)
  const includeActivities = includeTokens.has('activities')
  const includeAddresses = includeTokens.has('addresses')
  const includeComments = includeTokens.has('comments') || includeTokens.has('notes')
  const includeDeals = includeTokens.has('deals')
  const includeTodos = includeTokens.has('todos') || includeTokens.has('tasks')

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
  const addresses = includeAddresses
    ? await em.find(CustomerAddress, { entity: person.id }, { orderBy: { isPrimary: 'desc', createdAt: 'desc' } })
    : []
  const tagAssignments = await em.find(CustomerTagAssignment, { entity: person.id }, { populate: ['tag'] })

  const comments = includeComments
    ? await em.find(CustomerComment, { entity: person.id }, { orderBy: { createdAt: 'desc' }, limit: 50 })
    : []
  const activities = includeActivities
    ? await em.find(CustomerActivity, { entity: person.id }, { orderBy: { occurredAt: 'desc', createdAt: 'desc' }, limit: 50 })
    : []
  const todoLinks = includeTodos
    ? await em.find(CustomerTodoLink, { entity: person.id }, { orderBy: { createdAt: 'desc' }, limit: 50 })
    : []

  let todoDetails = new Map<string, TodoDetail>()
  if (includeTodos && todoLinks.length) {
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    try {
      todoDetails = await resolveTodoDetails(
        queryEngine,
        todoLinks,
        person.tenantId ?? auth.tenantId ?? null,
        [person.organizationId ?? null, ...(scope?.filterIds ?? [])],
      )
    } catch (err) {
      console.warn('customers.people.detail: failed to enrich todo links', err)
    }
  }

  const authorIds = new Set<string>()
  if (includeActivities) {
    for (const activity of activities) {
      if (activity.authorUserId) authorIds.add(activity.authorUserId)
    }
  }
  if (includeComments) {
    for (const comment of comments) {
      if (comment.authorUserId) authorIds.add(comment.authorUserId)
    }
  }
  const viewerUserId = auth.isApiKey ? null : auth.sub ?? null
  if (viewerUserId) authorIds.add(viewerUserId)

  let userMap = new Map<string, { name: string | null; email: string | null }>()
  if (authorIds.size) {
    const authorIdList = Array.from(authorIds)
    const users = await em.find(User, { id: { $in: authorIdList } })
    userMap = new Map(
      users.map((user) => [
        user.id,
        {
          name: user.name ?? null,
          email: user.email ?? null,
        },
      ])
    )
  }

  let deals: CustomerDeal[] = []
  if (includeDeals) {
    const dealLinks = await em.find(CustomerDealPersonLink, { person: person.id }, { populate: ['deal'] })
    deals = dealLinks
      .map((link) => (link.deal as CustomerDeal | string | null) ?? null)
      .filter((deal): deal is CustomerDeal => !!deal && typeof deal !== 'string')
  }

  const entityCustomFieldValues = await loadCustomFieldValues({
    em,
    entityId: E.customers.customer_entity,
    recordIds: [person.id],
    tenantIdByRecord: { [person.id]: person.tenantId ?? null },
    organizationIdByRecord: { [person.id]: person.organizationId ?? null },
    tenantFallbacks: [
      person.tenantId ?? auth.tenantId ?? null,
    ].filter((v): v is string => !!v),
  })
  let profileCustomFieldValues: Record<string, Record<string, unknown>> = {}
  const profileId = profile?.id ?? null
  if (profileId) {
    profileCustomFieldValues = await loadCustomFieldValues({
      em,
      entityId: E.customers.customer_person_profile,
      recordIds: [profileId],
      tenantIdByRecord: { [profileId]: profile?.tenantId ?? null },
      organizationIdByRecord: { [profileId]: profile?.organizationId ?? null },
      tenantFallbacks: [
        profile?.tenantId ?? person.tenantId ?? auth.tenantId ?? null,
      ].filter((v): v is string => !!v),
    })
  }

  const routing = await resolvePersonCustomFieldRouting(em, person.tenantId ?? null, person.organizationId ?? null)
  const customFields = mergePersonCustomFieldValues(
    routing,
    entityCustomFieldValues?.[person.id] ?? {},
    profileId ? profileCustomFieldValues?.[profileId] ?? {} : {},
  )

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
      nextInteractionIcon: person.nextInteractionIcon,
      nextInteractionColor: person.nextInteractionColor,
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
    customFields,
    tags: serializeTags(tagAssignments),
    addresses: includeAddresses
      ? addresses.map((address) => ({
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
        }))
      : [],
    comments: includeComments
      ? comments.map((comment) => {
          const authorInfo = comment.authorUserId ? userMap.get(comment.authorUserId) : null
          return {
            id: comment.id,
            body: comment.body,
            authorUserId: comment.authorUserId,
            authorName: authorInfo?.name ?? null,
            authorEmail: authorInfo?.email ?? null,
            dealId: comment.deal ? (typeof comment.deal === 'string' ? comment.deal : comment.deal.id) : null,
            createdAt: comment.createdAt.toISOString(),
            appearanceIcon: comment.appearanceIcon ?? null,
            appearanceColor: comment.appearanceColor ?? null,
          }
        })
      : [],
    activities: includeActivities
      ? activities.map((activity) => ({
          id: activity.id,
          activityType: activity.activityType,
          subject: activity.subject,
          body: activity.body,
          occurredAt: activity.occurredAt ? activity.occurredAt.toISOString() : null,
          dealId: activity.deal ? (typeof activity.deal === 'string' ? activity.deal : activity.deal.id) : null,
          authorUserId: activity.authorUserId,
          authorName: activity.authorUserId ? userMap.get(activity.authorUserId)?.name ?? null : null,
          authorEmail: activity.authorUserId ? userMap.get(activity.authorUserId)?.email ?? null : null,
          createdAt: activity.createdAt.toISOString(),
          appearanceIcon: activity.appearanceIcon ?? null,
          appearanceColor: activity.appearanceColor ?? null,
        }))
      : [],
    deals: includeDeals
      ? deals.map((deal) => ({
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
        }))
      : [],
    todos: includeTodos
      ? todoLinks.map((link) => {
          const source = typeof link.todoSource === 'string' && link.todoSource.trim().length > 0 ? link.todoSource : 'example:todo'
          const key = `${source}:${link.todoId}`
          const detail = todoDetails.get(key)
          return {
            id: link.id,
            todoId: link.todoId,
            todoSource: source,
            createdAt: link.createdAt.toISOString(),
            createdByUserId: link.createdByUserId,
            title: detail?.title ?? null,
            isDone: detail?.isDone ?? null,
            priority: detail?.priority ?? null,
            dueAt: detail?.dueAt ?? null,
            todoOrganizationId: detail?.organizationId ?? null,
          }
        })
      : [],
    viewer: {
      userId: viewerUserId,
      name: viewerUserId ? userMap.get(viewerUserId)?.name ?? null : null,
      email: viewerUserId ? userMap.get(viewerUserId)?.email ?? auth.email ?? null : auth.email ?? null,
    },
  })
}
