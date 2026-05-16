import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

function leadPresenter(record: Record<string, unknown>): SearchResultPresenter {
  const title = pickString(record.name_raw, record.nameRaw, record.email_normalized, record.phone_e164, record.id) ?? 'Champion Lead'
  const subtitle = [pickString(record.source), pickString(record.qualification_status, record.qualificationStatus)]
    .filter(Boolean)
    .join(' - ')
  return {
    title,
    subtitle: subtitle || undefined,
    icon: 'target',
    badge: 'Lead',
  }
}

function contactPresenter(record: Record<string, unknown>): SearchResultPresenter {
  return {
    title: pickString(record.display_name, record.displayName, record.primary_email, record.id) ?? 'Champion Contact',
    subtitle: pickString(record.lifecycle, record.primary_phone_e164, record.primaryPhoneE164) ?? undefined,
    icon: 'user',
    badge: 'Contact',
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'champion_crm:lead',
      enabled: true,
      priority: 7,
      fieldPolicy: {
        searchable: ['name_raw', 'source', 'utm_source', 'utm_campaign', 'qualification_status'],
        hashOnly: ['email_normalized', 'phone_e164'],
        excluded: ['source_payload'],
      },
      buildSource: (ctx: SearchBuildContext): SearchIndexSource | null => {
        const record = ctx.record
        const lines = [
          pickString(record.name_raw, record.nameRaw),
          pickString(record.source),
          pickString(record.utm_source, record.utmSource),
          pickString(record.utm_campaign, record.utmCampaign),
          pickString(record.qualification_status, record.qualificationStatus),
        ].filter((value): value is string => Boolean(value))
        if (!lines.length) return null
        return {
          text: lines,
          presenter: leadPresenter(record),
          checksumSource: { record },
        }
      },
      formatResult: (ctx) => leadPresenter(ctx.record),
      resolveUrl: (ctx) => {
        const id = pickString(ctx.record.id)
        return id ? `/backend/champion-crm/leads/${encodeURIComponent(id)}` : null
      },
    },
    {
      entityId: 'champion_crm:contact',
      enabled: true,
      priority: 6,
      fieldPolicy: {
        searchable: ['display_name', 'first_name', 'last_name', 'lifecycle'],
        hashOnly: ['primary_email', 'primary_phone_e164'],
        excluded: ['consent_summary', 'internal_alert'],
      },
      formatResult: (ctx) => contactPresenter(ctx.record),
    },
    {
      entityId: 'champion_crm:deal',
      enabled: true,
      priority: 5,
      fieldPolicy: {
        searchable: ['title', 'stage', 'status'],
        excluded: ['metadata'],
      },
      formatResult: (ctx) => ({
        title: pickString(ctx.record.title, ctx.record.id) ?? 'Champion Deal',
        subtitle: pickString(ctx.record.status, ctx.record.stage) ?? undefined,
        icon: 'briefcase',
        badge: 'Deal',
      }),
    },
    {
      entityId: 'champion_crm:investment',
      enabled: true,
      priority: 4,
      fieldPolicy: {
        searchable: ['name', 'description', 'city', 'address', 'status'],
        excluded: ['metadata'],
      },
    },
    {
      entityId: 'champion_crm:apartment',
      enabled: true,
      priority: 4,
      fieldPolicy: {
        searchable: ['unit_number', 'building', 'floor', 'status'],
        excluded: ['metadata'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig

