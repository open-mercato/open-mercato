import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchResultLink,
} from '@open-mercato/shared/modules/search'

function buildCustomerUrl(kind: string | null | undefined, id?: string | null): string | null {
  if (!id) return null
  const encoded = encodeURIComponent(id)
  if (kind === 'person') return `/backend/customers/people/${encoded}`
  if (kind === 'company') return `/backend/customers/companies/${encoded}`
  return `/backend/customers/companies/${encoded}`
}

function resolveEntityId(record: Record<string, unknown>): string | null {
  const direct =
    record.customer_entity_id ??
    record.entityId ??
    record.entity_id ??
    record.customerEntityId ??
    (typeof record.entity === 'object' && record.entity ? (record.entity as Record<string, unknown>).id : undefined)
  return typeof direct === 'string' && direct.length ? direct : null
}

function pickString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length) {
      return candidate.trim()
    }
  }
  return null
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'customers:customer_person_profile',
      enabled: true,
      priority: 10,

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const { record, customFields } = ctx
        const firstName = pickString(record.first_name, record.firstName, customFields?.first_name)
        const lastName = pickString(record.last_name, record.lastName, customFields?.last_name)
        const nameParts = [firstName, lastName].filter(Boolean).join(' ')
        const title = pickString(
          record.preferred_name,
          record.preferredName,
          nameParts.length ? nameParts : null,
          record.id as string,
        )
        const jobTitle = pickString(record.job_title, record.jobTitle, customFields?.job_title)
        const department = pickString(record.department, customFields?.department)
        const subtitleParts = [jobTitle, department].filter(Boolean)

        return {
          title: title ?? 'Person',
          subtitle: subtitleParts.length ? subtitleParts.join(' · ') : undefined,
          icon: 'user',
          badge: 'Person',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const entityId = resolveEntityId(ctx.record)
        return buildCustomerUrl('person', entityId)
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const entityId = resolveEntityId(ctx.record)
        if (!entityId) return null
        const href = buildCustomerUrl('person', entityId)
        if (!href) return null
        return [{ href: `${href}/edit`, label: 'Edit', kind: 'secondary' }]
      },

      fieldPolicy: {
        searchable: [
          'preferred_name',
          'first_name',
          'last_name',
          'job_title',
          'department',
          'seniority',
          'timezone',
          'linked_in_url',
          'twitter_url',
        ],
        hashOnly: ['primary_email', 'primary_phone', 'personal_email'],
        excluded: ['date_of_birth', 'government_id', 'ssn', 'tax_id'],
      },
    },
    {
      entityId: 'customers:customer_company_profile',
      enabled: true,
      priority: 10,

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const { record, customFields } = ctx
        const title = pickString(
          record.display_name,
          record.displayName,
          customFields?.display_name,
          record.brand_name,
          record.brandName,
          record.legal_name,
          record.legalName,
          record.domain,
          record.id as string,
        )
        const industry = pickString(record.industry, customFields?.industry)
        const sizeBucket = pickString(record.size_bucket, record.sizeBucket)
        const subtitleParts = [industry, sizeBucket].filter(Boolean)

        return {
          title: title ?? 'Company',
          subtitle: subtitleParts.length ? subtitleParts.join(' · ') : undefined,
          icon: 'building',
          badge: 'Company',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const entityId = resolveEntityId(ctx.record)
        return buildCustomerUrl('company', entityId)
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const entityId = resolveEntityId(ctx.record)
        if (!entityId) return null
        const href = buildCustomerUrl('company', entityId)
        if (!href) return null
        return [{ href: `${href}/edit`, label: 'Edit', kind: 'secondary' }]
      },

      fieldPolicy: {
        searchable: [
          'legal_name',
          'brand_name',
          'display_name',
          'domain',
          'website_url',
          'industry',
          'size_bucket',
          'description',
        ],
        hashOnly: ['tax_id', 'registration_number'],
        excluded: ['bank_account', 'billing_info', 'credit_info'],
      },
    },
    {
      entityId: 'customers:customer_deal',
      enabled: true,
      priority: 8,

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const { record } = ctx
        const title = pickString(record.title as string, 'Deal')
        const subtitleParts: string[] = []
        if (record.pipeline_stage) subtitleParts.push(String(record.pipeline_stage))
        if (record.status) subtitleParts.push(String(record.status))
        const amount = record.value_amount ?? record.valueAmount
        const currency = record.value_currency ?? record.valueCurrency
        if (amount) {
          subtitleParts.push(currency ? `${amount} ${currency}` : String(amount))
        }

        return {
          title: title ?? 'Deal',
          subtitle: subtitleParts.length ? subtitleParts.join(' · ') : undefined,
          icon: 'briefcase',
          badge: 'Deal',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id
        if (!id) return null
        return `/backend/customers/deals/${encodeURIComponent(String(id))}`
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const id = ctx.record.id
        if (!id) return null
        return [
          {
            href: `/backend/customers/deals/${encodeURIComponent(String(id))}/edit`,
            label: 'Edit',
            kind: 'secondary',
          },
        ]
      },

      fieldPolicy: {
        searchable: ['title', 'description', 'pipeline_stage', 'status', 'source'],
        hashOnly: [],
        excluded: ['value_amount', 'value_currency'],
      },
    },
    {
      entityId: 'customers:customer_activity',
      enabled: true,
      priority: 5,

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const { record } = ctx
        const title = pickString(
          record.subject as string,
          record.activity_type ? `Activity: ${record.activity_type}` : null,
          'Activity',
        )
        const body = typeof record.body === 'string' ? record.body.slice(0, 100) : undefined

        return {
          title: title ?? 'Activity',
          subtitle: body,
          icon: 'bolt',
          badge: 'Activity',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const entityId = ctx.record.entity_id ?? ctx.record.entityId
        if (!entityId) return null
        const activityId = ctx.record.id ?? ctx.record.activity_id
        const base = buildCustomerUrl(ctx.record.entity_kind as string, String(entityId))
        return base ? `${base}#activity-${activityId ?? ''}` : null
      },

      fieldPolicy: {
        searchable: ['subject', 'body', 'activity_type'],
        hashOnly: [],
        excluded: [],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
