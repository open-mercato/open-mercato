import type { VectorSearchEntitySpec } from '@open-mercato/shared/modules/vector-search'
import { resolveEntityTableName } from '@open-mercato/shared/lib/query/engine'
import {
  CustomerEntity,
  CustomerPersonProfile,
  CustomerCompanyProfile,
  CustomerDeal,
  CustomerDealPersonLink,
  CustomerDealCompanyLink,
  CustomerComment,
  CustomerActivity,
  CustomerTodoLink,
} from './data/entities'

type BuildContext = Parameters<VectorSearchEntitySpec['build']>[0]

type MaybeRecord = { [key: string]: unknown }

function normalize(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null
  try {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  } catch {
    return null
  }
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = normalize(value)
    if (normalized) seen.add(normalized)
  }
  return Array.from(seen)
}

const customerEntityVectorSearch: VectorSearchEntitySpec = {
  async build({ recordId, em }: BuildContext) {
    const entity = await em.findOne(CustomerEntity, { id: recordId, deletedAt: null }, { populate: ['personProfile', 'companyProfile'] })
    if (!entity) return null

    const kind = normalize(entity.kind)
    if (kind !== 'person' && kind !== 'company') return null

    const url = kind === 'person'
      ? `/backend/customers/people/${recordId}`
      : `/backend/customers/companies/${recordId}`

    const textChunks: string[] = []
    const searchTerms = uniqueStrings([
      entity.primaryEmail,
      entity.primaryPhone,
      entity.status,
      entity.lifecycleStage,
      entity.source,
    ])

    let lead: string | null = null
    const metadata: Record<string, unknown> = {
      kind,
      status: normalize(entity.status),
      lifecycleStage: normalize(entity.lifecycleStage),
      ownerUserId: normalize(entity.ownerUserId),
    }

    if (kind === 'person') {
      const profile = entity.personProfile ?? await em.findOne(CustomerPersonProfile, { entity: entity.id })
      if (profile) {
        const leadParts = uniqueStrings([profile.jobTitle, profile.department, profile.seniority])
        if (leadParts.length) lead = leadParts.join(' • ')
        textChunks.push(
          profile.firstName ?? '',
          profile.lastName ?? '',
          profile.preferredName ?? '',
          profile.jobTitle ?? '',
          profile.department ?? '',
          profile.seniority ?? '',
          profile.timezone ?? '',
          profile.linkedInUrl ?? '',
          profile.twitterUrl ?? '',
        )
        if (profile.preferredName) searchTerms.push(profile.preferredName)
        if (profile.company) {
          const companyId = typeof profile.company === 'string' ? profile.company : profile.company.id
          if (companyId) metadata.companyId = companyId
        }
      }
      if (!lead) lead = normalize(entity.description)
    } else {
      const profile = entity.companyProfile ?? await em.findOne(CustomerCompanyProfile, { entity: entity.id })
      if (profile) {
        const leadParts = uniqueStrings([profile.industry, profile.sizeBucket])
        if (leadParts.length) lead = leadParts.join(' • ')
        textChunks.push(
          profile.legalName ?? '',
          profile.brandName ?? '',
          profile.industry ?? '',
          profile.sizeBucket ?? '',
          profile.domain ?? '',
          profile.websiteUrl ?? '',
        )
        if (profile.domain) searchTerms.push(profile.domain)
        metadata.industry = normalize(profile.industry)
      }
      if (!lead) lead = normalize(entity.description)
    }

    const title = normalize(entity.displayName) ?? 'Customer'

    const links = [
      { href: url, label: kind === 'person' ? 'Open person' : 'Open company', relation: 'primary' as const },
    ]

    return {
      title,
      lead: lead ?? null,
      icon: kind === 'person' ? 'User' : 'Building',
      url,
      links,
      text: textChunks,
      metadata,
      searchTerms: uniqueStrings(searchTerms),
    }
  },
}

const customerDealVectorSearch: VectorSearchEntitySpec = {
  async build({ recordId, em }: BuildContext) {
    const deal = await em.findOne(CustomerDeal, { id: recordId, deletedAt: null })
    if (!deal) return null

    const peopleLinks = await em.find(CustomerDealPersonLink, { deal: recordId }, { populate: ['person'] })
    const companyLinks = await em.find(CustomerDealCompanyLink, { deal: recordId }, { populate: ['company'] })

    const primaryContact = peopleLinks[0]?.person as CustomerEntity | undefined
    const primaryCompany = companyLinks[0]?.company as CustomerEntity | undefined

    const links = [{ href: `/backend/customers/deals/${recordId}`, label: 'Open deal', relation: 'primary' as const }]

    if (primaryContact) {
      links.push({ href: `/backend/customers/people/${primaryContact.id}`, label: `Person · ${primaryContact.displayName ?? 'Contact'}` })
    }
    if (primaryCompany) {
      links.push({ href: `/backend/customers/companies/${primaryCompany.id}`, label: `Company · ${primaryCompany.displayName ?? 'Company'}` })
    }

    const leadParts = uniqueStrings([
      deal.pipelineStage,
      deal.status,
      deal.valueAmount && deal.valueCurrency ? `${deal.valueAmount} ${deal.valueCurrency}` : null,
    ])

    const textChunks = [
      deal.description ?? '',
      deal.pipelineStage ?? '',
      deal.status ?? '',
      deal.source ?? '',
    ]

    for (const link of peopleLinks) {
      const person = link.person as CustomerEntity | undefined
      if (person) {
        textChunks.push(person.displayName ?? '')
      }
    }
    for (const link of companyLinks) {
      const company = link.company as CustomerEntity | undefined
      if (company) {
        textChunks.push(company.displayName ?? '')
      }
    }

    return {
      title: normalize(deal.title) ?? 'Deal',
      lead: leadParts.length ? leadParts.join(' • ') : null,
      icon: 'Briefcase',
      url: `/backend/customers/deals/${recordId}`,
      links,
      text: textChunks,
      metadata: {
        status: normalize(deal.status),
        pipelineStage: normalize(deal.pipelineStage),
        ownerUserId: normalize(deal.ownerUserId),
        probability: typeof deal.probability === 'number' ? deal.probability : null,
      },
      searchTerms: uniqueStrings([
        deal.status,
        deal.pipelineStage,
        deal.source,
      ]),
    }
  },
}

const customerActivityVectorSearch: VectorSearchEntitySpec = {
  async build({ recordId, em }: BuildContext) {
    const activity = await em.findOne(CustomerActivity, { id: recordId }, { populate: ['entity'] })
    if (!activity) return null
    const customer = activity.entity as CustomerEntity | undefined
    if (!customer) return null

    const kind = normalize(customer.kind)
    if (kind !== 'person' && kind !== 'company') return null

    const baseUrl = kind === 'person'
      ? `/backend/customers/people/${customer.id}`
      : `/backend/customers/companies/${customer.id}`

    const url = `${baseUrl}?tab=activities&activity=${activity.id}`

    return {
      title: normalize(activity.subject) ?? `Activity · ${activity.activityType}`,
      lead: formatDate(activity.occurredAt),
      icon: activity.appearanceIcon || 'CalendarClock',
      url,
      links: [
        { href: url, label: 'Open activity', relation: 'primary' as const },
        { href: baseUrl, label: `Customer · ${customer.displayName ?? 'Record'}` },
      ],
      text: [activity.body ?? '', activity.activityType ?? ''],
      metadata: {
        activityType: normalize(activity.activityType),
        customerId: customer.id,
      },
      searchTerms: uniqueStrings([
        activity.activityType,
        activity.subject,
      ]),
    }
  },
}

const customerCommentVectorSearch: VectorSearchEntitySpec = {
  async build({ recordId, em }: BuildContext) {
    const comment = await em.findOne(CustomerComment, { id: recordId, deletedAt: null }, { populate: ['entity'] })
    if (!comment) return null
    const customer = comment.entity as CustomerEntity | undefined
    if (!customer) return null

    const kind = normalize(customer.kind)
    if (kind !== 'person' && kind !== 'company') return null

    const baseUrl = kind === 'person'
      ? `/backend/customers/people/${customer.id}`
      : `/backend/customers/companies/${customer.id}`

    const url = `${baseUrl}?tab=notes&note=${comment.id}`
    const snippet = comment.body.length > 120 ? `${comment.body.slice(0, 117)}…` : comment.body

    return {
      title: `Note for ${customer.displayName ?? 'customer'}`,
      lead: snippet,
      icon: comment.appearanceIcon || 'StickyNote',
      url,
      links: [
        { href: url, label: 'Open note', relation: 'primary' as const },
        { href: baseUrl, label: `Customer · ${customer.displayName ?? 'Record'}` },
      ],
      text: [comment.body ?? ''],
      metadata: {
        customerId: customer.id,
      },
      searchTerms: uniqueStrings([
        snippet,
        customer.displayName ?? null,
      ]),
    }
  },
}

const customerTodoLinkVectorSearch: VectorSearchEntitySpec = {
  async build({ recordId, em, knex }: BuildContext) {
    const link = await em.findOne(CustomerTodoLink, { id: recordId }, { populate: ['entity'] })
    if (!link) return null

    const customer = link.entity as CustomerEntity | undefined
    if (!customer) return null

    const kind = normalize(customer.kind)
    if (kind !== 'person' && kind !== 'company') return null

    const baseUrl = kind === 'person'
      ? `/backend/customers/people/${customer.id}`
      : `/backend/customers/companies/${customer.id}`

    let todoTitle: string | null = null
    let todoStatus: string | null = null
    let todoUrl: string | null = null

    try {
      const table = resolveEntityTableName(em, link.todoSource)
      const row = await knex(table).where({ id: link.todoId }).first()
      if (row && typeof row === 'object') {
        const record = row as MaybeRecord
        todoTitle = normalize(record.title)
        todoStatus = normalize((record as MaybeRecord)['status'] as string | undefined)
      }
    } catch (error) {
      console.warn('[vector_search] failed to resolve todo details', error)
    }

    if (link.todoSource === 'example:todo') {
      todoUrl = `/backend/example/todos/${link.todoId}/edit`
    }

    const url = `${baseUrl}?tab=tasks&todoLink=${recordId}`

    const links = [
      { href: url, label: 'Customer task', relation: 'primary' as const },
      { href: baseUrl, label: `Customer · ${customer.displayName ?? 'Record'}` },
    ]
    if (todoUrl) {
      links.push({ href: todoUrl, label: 'Open todo' })
    }

    return {
      title: todoTitle ?? `Linked todo · ${link.todoId}`,
      lead: todoStatus,
      icon: 'CheckSquare',
      url,
      links,
      text: [todoTitle ?? '', todoStatus ?? '', link.todoSource ?? ''],
      metadata: {
        customerId: customer.id,
        todoSource: link.todoSource,
        todoId: link.todoId,
      },
      searchTerms: uniqueStrings([
        todoTitle,
        link.todoSource,
      ]),
    }
  },
}

export const entities = [
  {
    id: 'customers:customer_entity',
    label: 'Customer',
    description: 'CRM customer record (person or company).',
    labelField: 'displayName',
    showInSidebar: false,
    fields: [],
    vectorSearch: customerEntityVectorSearch,
  },
  {
    id: 'customers:customer_person_profile',
    label: 'Customer Person',
    description: 'Individual contact record within the CRM.',
    labelField: 'displayName',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'customers:customer_company_profile',
    label: 'Customer Company',
    description: 'Organization or account tracked within the CRM.',
    labelField: 'displayName',
    showInSidebar: false,
    fields: [],
  },
  {
    id: 'customers:customer_deal',
    label: 'Customer Deal',
    description: 'Sales opportunity with value, stage, and close date.',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
    vectorSearch: customerDealVectorSearch,
  },
  {
    id: 'customers:customer_activity',
    label: 'Customer Activity',
    description: 'Timeline events and touchpoints logged against people or companies.',
    labelField: 'subject',
    showInSidebar: false,
    defaultEditor: false,
    fields: [],
    vectorSearch: customerActivityVectorSearch,
  },
  {
    id: 'customers:customer_comment',
    label: 'Customer Note',
    description: 'Free-form notes added to customer timelines.',
    labelField: 'body',
    showInSidebar: false,
    fields: [],
    vectorSearch: customerCommentVectorSearch,
  },
  {
    id: 'customers:customer_todo_link',
    label: 'Customer Task Link',
    description: 'Link between customers and external to-dos.',
    labelField: 'todoId',
    showInSidebar: false,
    fields: [],
    vectorSearch: customerTodoLinkVectorSearch,
  },
]

export default entities
