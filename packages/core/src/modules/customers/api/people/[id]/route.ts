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
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

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
    .filter(
      (tag: { id: string; label: string; color: string | null } | null): tag is {
        id: string
        label: string
        color: string | null
      } => tag !== null,
    )
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
    return parseBooleanToken(value)
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

type RouteProfilerMark = { label: string; time: bigint; extra?: Record<string, unknown> }
type RouteProfiler = { enabled: boolean; mark: (label: string, extra?: Record<string, unknown>) => void; end: (extra?: Record<string, unknown>) => void }

function normalizeProfilerTokens(input: string | null | undefined): string[] {
  if (!input) return []
  return input
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
}

function profilerMatches(scope: string, tokens: string[]): boolean {
  if (!tokens.length) return false
  const lower = scope.toLowerCase()
  return tokens.some((token) => {
    if (token === '*' || token === 'all' || parseBooleanToken(token) === true) return true
    if (token.endsWith('*')) {
      const prefix = token.slice(0, -1)
      return prefix.length === 0 ? true : lower.startsWith(prefix)
    }
    return token === lower
  })
}

function isRouteProfilingEnabled(scope: string): boolean {
  const candidates = [
    process.env.OM_CRUD_PROFILE,
    process.env.NEXT_PUBLIC_OM_CRUD_PROFILE,
    process.env.OM_ROUTE_PROFILE,
    process.env.NEXT_PUBLIC_OM_ROUTE_PROFILE,
  ]
  for (const raw of candidates) {
    if (!raw) continue
    const tokens = normalizeProfilerTokens(raw)
    if (profilerMatches(scope, tokens)) return true
  }
  return false
}

function createRouteProfiler(scope: string): RouteProfiler {
  if (!isRouteProfilingEnabled(scope)) {
    return { enabled: false, mark: () => {}, end: () => {} }
  }
  const marks: RouteProfilerMark[] = [{ label: 'start', time: process.hrtime.bigint() }]
  const round = (value: number) => Math.round(value * 1000) / 1000
  return {
    enabled: true,
    mark(label, extra) {
      marks.push({ label, time: process.hrtime.bigint(), extra })
    },
    end(extra) {
      marks.push({ label: 'end', time: process.hrtime.bigint(), extra })
      const segments: Array<{ step: string; durationMs: number; extra?: Record<string, unknown> }> = []
      for (let idx = 1; idx < marks.length; idx += 1) {
        const current = marks[idx]
        const previous = marks[idx - 1]
        if (current.label === 'end') continue
        const durationMs = Number(current.time - previous.time) / 1_000_000
        segments.push({
          step: current.label,
          durationMs: round(durationMs),
          ...(current.extra ? { extra: current.extra } : {}),
        })
      }
      const totalNs = marks[marks.length - 1].time - marks[0].time
      const payload: Record<string, unknown> = {
        scope,
        totalMs: round(Number(totalNs) / 1_000_000),
        steps: segments,
      }
      const tail = marks[marks.length - 1]
      if (tail.extra && Object.keys(tail.extra).length > 0) payload.meta = tail.extra
      else if (extra && Object.keys(extra).length > 0) payload.meta = extra
      try {
        console.info('[route:profile]', payload)
      } catch {
        // ignore logging failures
      }
    },
  }
}

async function resolveTodoDetails(
  queryEngine: QueryEngine,
  links: CustomerTodoLink[],
  tenantId: string | null,
  organizationIds: Array<string | null>,
  profiler?: RouteProfiler,
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

  profiler?.mark('todo_links_grouped', { sourceCount: idsBySource.size, linkCount: links.length })

  for (const [source, idSet] of idsBySource.entries()) {
    const ids = Array.from(idSet)
    if (!ids.length) continue
    profiler?.mark('todo_query_start', { source, count: ids.length })
    try {
      const result = await queryEngine.query<Record<string, unknown>>(source as EntityId, {
        tenantId,
        organizationIds: scopedOrgIds.length > 0 ? scopedOrgIds : undefined,
        filters: { id: { $in: ids } },
        includeCustomFields: ['priority', 'due_at', 'severity', 'description'],
        page: { page: 1, pageSize: Math.max(ids.length, 1) },
      })
      const itemCount = Array.isArray(result.items) ? result.items.length : 0
      profiler?.mark('todo_query_complete', { source, itemCount })
      let enriched = 0
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
            readCustomField(record, 'severity'),
          ]
          for (const candidate of candidates) {
            if (typeof candidate === 'string') {
              const trimmed = candidate.trim()
              if (trimmed.length) return trimmed
            }
          }
          return null
        })()
        const descriptionValue = (() => {
          const candidates = [
            record.description,
            record['cf:description'],
            record['cf_description'],
            readCustomField(record, 'description'),
          ]
          for (const candidate of candidates) {
            if (typeof candidate === 'string') {
              const trimmed = candidate.trim()
              if (trimmed.length) return trimmed
            }
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
        const customValues: Record<string, unknown> = {}
        const assignCustomValue = (key: unknown, value: unknown) => {
          if (typeof key !== 'string') return
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
        enriched += 1
      }
      profiler?.mark('todo_items_processed', { source, enriched })
    } catch (err) {
      profiler?.mark('todo_query_failed', { source, error: err instanceof Error ? err.message : String(err) })
      console.warn(`customers.people.detail: failed to resolve todos for source ${source}`, err)
    }
  }

  profiler?.mark('todo_details_ready', { enrichedCount: details.size })
  return details
}

export async function GET(_req: Request, ctx: { params?: { id?: string } }) {
  const profiler = createRouteProfiler('customers.people.detail')
  profiler.mark('request_received')

  const includeTokens = parseIncludeParams(_req)
  profiler.mark('includes_parsed', { include: Array.from(includeTokens) })

  const includeActivities = includeTokens.has('activities')
  const includeAddresses = includeTokens.has('addresses')
  const includeComments = includeTokens.has('comments') || includeTokens.has('notes')
  const includeDeals = includeTokens.has('deals')
  const includeTodos = includeTokens.has('todos') || includeTokens.has('tasks')

  let statusCode = 500
  let profileMeta: Record<string, unknown> | undefined
  let addresses: CustomerAddress[] = []
  let comments: CustomerComment[] = []
  let activities: CustomerActivity[] = []
  let todoLinks: CustomerTodoLink[] = []
  let todoDetails = new Map<string, TodoDetail>()
  let deals: CustomerDeal[] = []
  let tagAssignments: CustomerTagAssignment[] = []
  let userMap = new Map<string, { name: string | null; email: string | null }>()
  let customFields: Record<string, unknown> = {}
  let viewerUserId: string | null = null
  let profile: CustomerPersonProfile | null = null

  try {
    const parse = paramsSchema.safeParse({ id: ctx.params?.id })
    if (!parse.success) {
      statusCode = 400
      profileMeta = { reason: 'invalid_person_id' }
      return NextResponse.json({ error: 'Invalid person id' }, { status: 400 })
    }
    profiler.mark('params_resolved', { id: parse.data.id })

    const auth = await getAuthFromRequest(_req)
    if (!auth) {
      profiler.mark('auth_missing')
      statusCode = 401
      profileMeta = { reason: 'unauthorized' }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    profiler.mark('auth_resolved', {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      userId: auth.sub ?? null,
      isApiKey: !!auth.isApiKey,
    })
    viewerUserId = auth.isApiKey ? null : auth.sub ?? null

    const container = await createRequestContainer()
    profiler.mark('container_resolved')

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: _req })
    profiler.mark('scope_resolved', {
      scopedOrganizations: Array.isArray(scope?.filterIds) ? scope.filterIds.length : 0,
    })
    const em = (container.resolve('em') as EntityManager)

    const person = await em.findOne(CustomerEntity, { id: parse.data.id, kind: 'person', deletedAt: null })
    profiler.mark('person_loaded', { found: !!person })
    if (!person) {
      statusCode = 404
      profileMeta = { reason: 'person_not_found' }
      return notFound('Person not found')
    }

    if (auth.tenantId && person.tenantId !== auth.tenantId) {
      statusCode = 404
      profileMeta = { reason: 'person_tenant_mismatch' }
      return notFound('Person not found')
    }
    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)

    if (allowedOrgIds.size && person.organizationId && !allowedOrgIds.has(person.organizationId)) {
      statusCode = 403
      profileMeta = { reason: 'organization_forbidden' }
      return forbidden('Access denied')
    }

    profile = await em.findOne(CustomerPersonProfile, { entity: person })
    profiler.mark('profile_loaded', { found: !!profile })

    if (includeAddresses) {
      addresses = await em.find(CustomerAddress, { entity: person.id }, { orderBy: { isPrimary: 'desc', createdAt: 'desc' } })
      profiler.mark('addresses_loaded', { count: addresses.length })
    }

    tagAssignments = await findWithDecryption(
      em,
      CustomerTagAssignment,
      { entity: person.id },
      { populate: ['tag'] },
      { tenantId: person.tenantId ?? auth.tenantId ?? null, organizationId: person.organizationId ?? auth.orgId ?? null },
    )
    profiler.mark('tags_loaded', { count: tagAssignments.length })

    if (includeComments) {
      comments = await em.find(CustomerComment, { entity: person.id }, { orderBy: { createdAt: 'desc' }, limit: 50 })
      profiler.mark('comments_loaded', { count: comments.length })
    }

    if (includeActivities) {
      activities = await em.find(CustomerActivity, { entity: person.id }, { orderBy: { occurredAt: 'desc', createdAt: 'desc' }, limit: 50 })
      profiler.mark('activities_loaded', { count: activities.length })
    }

    if (includeTodos) {
      todoLinks = await em.find(CustomerTodoLink, { entity: person.id }, { orderBy: { createdAt: 'desc' }, limit: 50 })
      profiler.mark('todo_links_loaded', { count: todoLinks.length })
      if (todoLinks.length) {
        const queryEngine = (container.resolve('queryEngine') as QueryEngine)
        try {
          todoDetails = await resolveTodoDetails(
            queryEngine,
            todoLinks,
            person.tenantId ?? auth.tenantId ?? null,
            [person.organizationId ?? null, ...(scope?.filterIds ?? [])],
            profiler,
          )
        } catch (err) {
          console.warn('customers.people.detail: failed to enrich todo links', err)
        }
        profiler.mark('todo_details_enriched', { count: todoDetails.size, links: todoLinks.length })
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
    if (viewerUserId) authorIds.add(viewerUserId)

    if (authorIds.size) {
      const users = await em.find(User, { id: { $in: Array.from(authorIds) } })
      userMap = new Map(
        users.map((user) => [
          user.id,
          {
            name: user.name ?? null,
            email: user.email ?? null,
          },
        ])
      )
      profiler.mark('authors_loaded', { count: userMap.size })
    }

    if (includeDeals) {
      const dealLinks = await findWithDecryption(
        em,
        CustomerDealPersonLink,
        { person: person.id },
        { populate: ['deal'] },
        { tenantId: person.tenantId ?? auth.tenantId ?? null, organizationId: person.organizationId ?? auth.orgId ?? null },
      )
      deals = dealLinks
        .map((link) => (link.deal as CustomerDeal | string | null) ?? null)
        .filter((deal): deal is CustomerDeal => !!deal && typeof deal !== 'string')
      profiler.mark('deals_loaded', { count: deals.length })
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
    profiler.mark('entity_custom_fields_loaded', { keys: Object.keys(entityCustomFieldValues?.[person.id] ?? {}).length })

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
      profiler.mark('profile_custom_fields_loaded', { keys: Object.keys(profileCustomFieldValues?.[profileId] ?? {}).length })
    }

    const routing = await resolvePersonCustomFieldRouting(em, person.tenantId ?? null, person.organizationId ?? null)
    profiler.mark('custom_field_routing_resolved', { keys: routing.size })
    customFields = mergePersonCustomFieldValues(
      routing,
      entityCustomFieldValues?.[person.id] ?? {},
      profileId ? profileCustomFieldValues?.[profileId] ?? {} : {},
    )
    profiler.mark('custom_fields_merged', { keys: Object.keys(customFields).length })

    const viewerUserIdFinal = viewerUserId
    const response = NextResponse.json({
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
              severity: detail?.severity ?? null,
              description: detail?.description ?? null,
              dueAt: detail?.dueAt ?? null,
              todoOrganizationId: detail?.organizationId ?? null,
              customValues: detail?.customValues ?? null,
            }
          })
        : [],
      viewer: {
        userId: viewerUserIdFinal,
        name: viewerUserIdFinal ? userMap.get(viewerUserIdFinal)?.name ?? null : null,
        email: viewerUserIdFinal ? userMap.get(viewerUserIdFinal)?.email ?? auth.email ?? null : auth.email ?? null,
      },
    })
    statusCode = 200
    profileMeta = {
      include: Array.from(includeTokens),
      counts: {
        tags: tagAssignments.length,
        comments: comments.length,
        activities: activities.length,
        todos: todoLinks.length,
        addresses: addresses.length,
        deals: deals.length,
      },
    }
    profiler.mark('response_ready', { status: statusCode })
    return response
  } catch (err) {
    if (statusCode < 400) statusCode = 500
    const message = err instanceof Error ? err.message : String(err)
    profileMeta = { ...(profileMeta ?? {}), error: message }
    throw err
  } finally {
    profiler.end({ status: statusCode, ...(profileMeta ?? {}) })
  }
}
const personDetailQuerySchema = z.object({
  include: z
    .string()
    .optional()
    .describe('Comma-separated list of relations to include (addresses, comments, activities, deals, todos).'),
}).passthrough()

const personDetailResponseSchema = z.object({
  person: z.object({
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
      firstName: z.string().nullable().optional(),
      lastName: z.string().nullable().optional(),
      preferredName: z.string().nullable().optional(),
      jobTitle: z.string().nullable().optional(),
      department: z.string().nullable().optional(),
      seniority: z.string().nullable().optional(),
      timezone: z.string().nullable().optional(),
      linkedInUrl: z.string().nullable().optional(),
      twitterUrl: z.string().nullable().optional(),
      companyEntityId: z.string().uuid().nullable().optional(),
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
  viewer: z.object({
    userId: z.string().uuid().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
})

const personDetailErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Fetch person detail',
  methods: {
    GET: {
      summary: 'Fetch person with related data',
      description: 'Returns a person customer record with optional related resources such as addresses, comments, activities, deals, and todos.',
      query: personDetailQuerySchema,
      responses: [
        { status: 200, description: 'Person detail payload', schema: personDetailResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: personDetailErrorSchema },
        { status: 401, description: 'Unauthorized', schema: personDetailErrorSchema },
        { status: 403, description: 'Forbidden for tenant/organization scope', schema: personDetailErrorSchema },
        { status: 404, description: 'Person not found', schema: personDetailErrorSchema },
      ],
    },
  },
}
