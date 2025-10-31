import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CustomerEntity,
  CustomerCompanyProfile,
  CustomerAddress,
  CustomerComment,
  CustomerActivity,
  CustomerTagAssignment,
  CustomerTag,
  CustomerDealCompanyLink,
  CustomerDeal,
  CustomerTodoLink,
  CustomerPersonProfile,
} from '../../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  resolveCompanyCustomFieldRouting,
  mergeCompanyCustomFieldValues,
} from '../../../lib/customFieldRouting'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@/modules/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

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

function serializeTags(assignments: CustomerTagAssignment[]): Array<{ id: string; label: string; color: string | null }> {
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
    .filter((tag): tag is { id: string; label: string; color: string | null } => tag !== null)
}

type TodoDetail = {
  title: string | null
  isDone: boolean | null
  priority: number | null
  severity: string | null
  description: string | null
  dueAt: string | null
  organizationId: string | null
  customValues: Record<string, unknown> | null
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
        includeCustomFields: ['priority', 'due_at', 'severity', 'description'],
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
        const severity = (() => {
          const candidates = [
            record['cf:severity'],
            record['cf_severity'],
            record.severity,
            readCustomField(record, 'severity'),
          ]
          for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              return candidate.trim()
            }
          }
          return null
        })()
        const dueAt = (() => {
          const candidates = [
            record['cf:due_at'],
            record['cf_due_at'],
            record.due_at,
            readCustomField(record, 'due_at'),
            record.dueAt,
            readCustomField(record, 'dueAt'),
          ]
          for (const candidate of candidates) {
            const parsed = parseDateValue(candidate)
            if (parsed) return parsed
          }
          return null
        })()
        const organizationId = (() => {
          const candidates = [
            record.organization_id,
            record['cf:organization_id'],
            record['cf_organization_id'],
            record.organizationId,
            readCustomField(record, 'organization_id'),
            readCustomField(record, 'organizationId'),
          ]
          for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              return candidate.trim()
            }
          }
          return null
        })()
        const descriptionValue = (() => {
          const direct = typeof record.description === 'string' ? record.description : null
          if (direct) return direct
          const customDescription = readCustomField(record, 'description')
          if (typeof customDescription === 'string' && customDescription.trim().length > 0) {
            return customDescription.trim()
          }
          return null
        })()

        const customValues: Record<string, unknown> = {}
        const assignCustomValue = (key: string, value: unknown) => {
          const trimmedKey = key.trim()
          if (!trimmedKey.length) return
          customValues[trimmedKey] = value === undefined ? null : value
        }
        for (const [rawKey, rawValue] of Object.entries(record)) {
          if (rawKey.startsWith('cf:')) {
            assignCustomValue(rawKey.slice(3), rawValue)
          } else if (rawKey.startsWith('cf_')) {
            assignCustomValue(rawKey.slice(3), rawValue)
          }
        }
        const nestedCustom = record.custom ?? record.customFields ?? record.cf
        if (nestedCustom && typeof nestedCustom === 'object') {
          for (const [nestedKey, nestedValue] of Object.entries(nestedCustom as Record<string, unknown>)) {
            assignCustomValue(nestedKey, nestedValue)
          }
        }

        details.set(`${source}:${rawId}`, {
          title,
          isDone,
          priority,
          severity,
          description: descriptionValue,
          dueAt,
          organizationId,
          customValues: Object.keys(customValues).length ? customValues : null,
        })
      }
    } catch (err) {
      console.warn(`customers.companies.detail: failed to resolve todos for source ${source}`, err)
    }
  }

  return details
}

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const auth = await getAuthFromRequest(_req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parse = paramsSchema.safeParse({ id: ctx.params?.id })
  if (!parse.success) return NextResponse.json({ error: 'Invalid company id' }, { status: 400 })

  const includeTokens = parseIncludeParams(_req)
  const includeActivities = includeTokens.has('activities')
  const includeAddresses = includeTokens.has('addresses')
  const includeComments = includeTokens.has('comments') || includeTokens.has('notes')
  const includeDeals = includeTokens.has('deals')
  const includeTodos = includeTokens.has('todos') || includeTokens.has('tasks')
  const includePeople = includeTokens.has('people')

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: _req })
  const em = container.resolve<EntityManager>('em')

  const company = await em.findOne(
    CustomerEntity,
    { id: parse.data.id, kind: 'company', deletedAt: null },
    { populate: ['companyProfile'] },
  )
  if (!company) return notFound('Company not found')

  if (auth.tenantId && company.tenantId !== auth.tenantId) return notFound('Company not found')
  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)

  if (allowedOrgIds.size && company.organizationId && !allowedOrgIds.has(company.organizationId)) {
    return forbidden('Access denied')
  }

  const profile = company.companyProfile
    ? await em.findOne(CustomerCompanyProfile, { id: company.companyProfile.id })
    : await em.findOne(CustomerCompanyProfile, { entity: company })

  const addresses = includeAddresses
    ? await em.find(CustomerAddress, { entity: company.id }, { orderBy: { isPrimary: 'desc', createdAt: 'desc' } })
    : []
  const tagAssignments = await em.find(CustomerTagAssignment, { entity: company.id }, { populate: ['tag'] })

  const comments = includeComments
    ? await em.find(CustomerComment, { entity: company.id }, { orderBy: { createdAt: 'desc' }, limit: 50 })
    : []
  const activities = includeActivities
    ? await em.find(CustomerActivity, { entity: company.id }, { orderBy: { occurredAt: 'desc', createdAt: 'desc' }, limit: 50 })
    : []
  const todoLinks = includeTodos
    ? await em.find(CustomerTodoLink, { entity: company.id }, { orderBy: { createdAt: 'desc' }, limit: 50 })
    : []

  let todoDetails = new Map<string, TodoDetail>()
  if (includeTodos && todoLinks.length) {
    const queryEngine = container.resolve<QueryEngine>('queryEngine')
    try {
      todoDetails = await resolveTodoDetails(
        queryEngine,
        todoLinks,
        company.tenantId ?? auth.tenantId ?? null,
        [company.organizationId ?? null, ...(scope?.filterIds ?? [])],
      )
    } catch (err) {
      console.warn('customers.companies.detail: failed to enrich todo links', err)
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
    const dealLinks = await em.find(CustomerDealCompanyLink, { company: company.id }, { populate: ['deal'] })
    deals = dealLinks
      .map((link) => (link.deal as CustomerDeal | string | null) ?? null)
      .filter((deal): deal is CustomerDeal => !!deal && typeof deal !== 'string')
  }

  let relatedPeople: Array<{ entity: CustomerEntity; profile: CustomerPersonProfile | null }> = []
  if (includePeople) {
    const profiles = await em.find(
      CustomerPersonProfile,
      { company: company.id, entity: { deletedAt: null } },
      { populate: ['entity'] },
    )
    relatedPeople = profiles.reduce<Array<{ entity: CustomerEntity; profile: CustomerPersonProfile | null }>>(
      (acc, entry) => {
        const entity = entry.entity as CustomerEntity | null
        if (!entity || entity.kind !== 'person' || entity.deletedAt) return acc
        acc.push({ entity, profile: entry ?? null })
        return acc
      },
      [],
    )
  }

  const entityCustomFieldValues = await loadCustomFieldValues({
    em,
    entityId: E.customers.customer_entity,
    recordIds: [company.id],
    tenantIdByRecord: { [company.id]: company.tenantId ?? null },
    organizationIdByRecord: { [company.id]: company.organizationId ?? null },
    tenantFallbacks: [
      company.tenantId ?? auth.tenantId ?? null,
    ].filter((v): v is string => !!v),
  })
  let profileCustomFieldValues: Record<string, Record<string, unknown>> = {}
  const profileId = profile?.id ?? null
  if (profileId) {
    profileCustomFieldValues = await loadCustomFieldValues({
      em,
      entityId: E.customers.customer_company_profile,
      recordIds: [profileId],
      tenantIdByRecord: { [profileId]: profile?.tenantId ?? null },
      organizationIdByRecord: { [profileId]: profile?.organizationId ?? null },
      tenantFallbacks: [
        profile?.tenantId ?? company.tenantId ?? auth.tenantId ?? null,
      ].filter((v): v is string => !!v),
    })
  }

  const routing = await resolveCompanyCustomFieldRouting(em, company.tenantId ?? null, company.organizationId ?? null)
  const customFields = mergeCompanyCustomFieldValues(
    routing,
    entityCustomFieldValues?.[company.id] ?? {},
    profileId ? profileCustomFieldValues?.[profileId] ?? {} : {},
  )

  return NextResponse.json({
    company: {
      id: company.id,
      displayName: company.displayName,
      description: company.description,
      ownerUserId: company.ownerUserId,
      primaryEmail: company.primaryEmail,
      primaryPhone: company.primaryPhone,
      status: company.status,
      lifecycleStage: company.lifecycleStage,
      source: company.source,
      nextInteractionAt: company.nextInteractionAt ? company.nextInteractionAt.toISOString() : null,
      nextInteractionName: company.nextInteractionName,
      nextInteractionRefId: company.nextInteractionRefId,
      nextInteractionIcon: company.nextInteractionIcon,
      nextInteractionColor: company.nextInteractionColor,
      organizationId: company.organizationId,
      tenantId: company.tenantId,
      isActive: company.isActive,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
    },
    profile: profile
      ? {
          id: profile.id,
          legalName: profile.legalName,
          brandName: profile.brandName,
          domain: profile.domain,
          websiteUrl: profile.websiteUrl,
          industry: profile.industry,
          sizeBucket: profile.sizeBucket,
          annualRevenue: profile.annualRevenue,
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
            authorName: comment.authorUserId ? authorInfo?.name ?? null : null,
            authorEmail: comment.authorUserId ? authorInfo?.email ?? null : null,
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
            severity: detail?.severity ?? null,
            description: detail?.description ?? null,
            dueAt: detail?.dueAt ?? null,
            todoOrganizationId: detail?.organizationId ?? null,
            customValues: detail?.customValues ?? null,
          }
        })
      : [],
    people: includePeople
      ? relatedPeople.map(({ entity, profile: personProfile }) => ({
          id: entity.id,
          displayName: entity.displayName,
          primaryEmail: entity.primaryEmail ?? null,
          primaryPhone: entity.primaryPhone ?? null,
          status: entity.status ?? null,
          lifecycleStage: entity.lifecycleStage ?? null,
          jobTitle: personProfile?.jobTitle ?? null,
          department: personProfile?.department ?? null,
          createdAt: entity.createdAt.toISOString(),
          organizationId: entity.organizationId,
        }))
      : [],
    viewer: {
      userId: viewerUserId,
      name: viewerUserId ? userMap.get(viewerUserId)?.name ?? null : null,
      email: viewerUserId ? userMap.get(viewerUserId)?.email ?? auth.email ?? null : auth.email ?? null,
    },
  })
}

const companyDetailQuerySchema = z.object({
  include: z
    .string()
    .optional()
    .describe('Comma-separated list of relations to include (addresses, comments, activities, deals, todos, people).'),
}).passthrough()

const companyDetailResponseSchema = z.object({
  company: z.object({
    id: z.string().uuid(),
    displayName: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    ownerUserId: z.string().uuid().nullable().optional(),
    primaryEmail: z.string().nullable().optional(),
    primaryPhone: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    lifecycleStage: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    nextInteractionAt: z.string().nullable().optional(),
    nextInteractionName: z.string().nullable().optional(),
    nextInteractionRefId: z.string().nullable().optional(),
    nextInteractionIcon: z.string().nullable().optional(),
    nextInteractionColor: z.string().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  profile: z
    .object({
      id: z.string().uuid(),
      legalName: z.string().nullable().optional(),
      brandName: z.string().nullable().optional(),
      domain: z.string().nullable().optional(),
      websiteUrl: z.string().nullable().optional(),
      industry: z.string().nullable().optional(),
      sizeBucket: z.string().nullable().optional(),
      annualRevenue: z.number().nullable().optional(),
    })
    .nullable(),
  customFields: z.record(z.string(), z.unknown()),
  tags: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      color: z.string().nullable().optional(),
    }),
  ),
  addresses: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().nullable().optional(),
      purpose: z.string().nullable().optional(),
      addressLine1: z.string().nullable().optional(),
      addressLine2: z.string().nullable().optional(),
      buildingNumber: z.string().nullable().optional(),
      flatNumber: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      postalCode: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      isPrimary: z.boolean().nullable().optional(),
      createdAt: z.string(),
    }),
  ),
  comments: z.array(
    z.object({
      id: z.string().uuid(),
      body: z.string().nullable().optional(),
      authorUserId: z.string().uuid().nullable().optional(),
      authorName: z.string().nullable().optional(),
      authorEmail: z.string().nullable().optional(),
      dealId: z.string().uuid().nullable().optional(),
      createdAt: z.string(),
      appearanceIcon: z.string().nullable().optional(),
      appearanceColor: z.string().nullable().optional(),
    }),
  ),
  activities: z.array(
    z.object({
      id: z.string().uuid(),
      activityType: z.string(),
      subject: z.string().nullable().optional(),
      body: z.string().nullable().optional(),
      occurredAt: z.string().nullable().optional(),
      dealId: z.string().uuid().nullable().optional(),
      authorUserId: z.string().uuid().nullable().optional(),
      authorName: z.string().nullable().optional(),
      authorEmail: z.string().nullable().optional(),
      createdAt: z.string(),
      appearanceIcon: z.string().nullable().optional(),
      appearanceColor: z.string().nullable().optional(),
    }),
  ),
  deals: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      pipelineStage: z.string().nullable().optional(),
      valueAmount: z.number().nullable().optional(),
      valueCurrency: z.string().nullable().optional(),
      probability: z.number().nullable().optional(),
      expectedCloseAt: z.string().nullable().optional(),
      ownerUserId: z.string().uuid().nullable().optional(),
      source: z.string().nullable().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  todos: z.array(
    z.object({
      id: z.string().uuid(),
      todoId: z.string().uuid(),
      todoSource: z.string(),
      createdAt: z.string(),
      createdByUserId: z.string().uuid().nullable().optional(),
      title: z.string().nullable().optional(),
      isDone: z.boolean().nullable().optional(),
      priority: z.number().nullable().optional(),
      severity: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      dueAt: z.string().nullable().optional(),
      todoOrganizationId: z.string().uuid().nullable().optional(),
      customValues: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  ),
  people: z.array(
    z.object({
      id: z.string().uuid(),
      displayName: z.string().nullable().optional(),
      primaryEmail: z.string().nullable().optional(),
      primaryPhone: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      lifecycleStage: z.string().nullable().optional(),
      jobTitle: z.string().nullable().optional(),
      department: z.string().nullable().optional(),
      createdAt: z.string(),
      organizationId: z.string().uuid().nullable().optional(),
    }),
  ),
  viewer: z.object({
    userId: z.string().uuid().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
})

const companyDetailErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Fetch company detail',
  methods: {
    GET: {
      summary: 'Fetch company with related data',
      description: 'Returns a company customer record with optional related resources such as addresses, comments, activities, deals, todos, and linked people.',
      query: companyDetailQuerySchema,
      responses: [
        { status: 200, description: 'Company detail payload', schema: companyDetailResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: companyDetailErrorSchema },
        { status: 401, description: 'Unauthorized', schema: companyDetailErrorSchema },
        { status: 403, description: 'Forbidden for tenant/organization scope', schema: companyDetailErrorSchema },
        { status: 404, description: 'Company not found', schema: companyDetailErrorSchema },
      ],
    },
  },
}
