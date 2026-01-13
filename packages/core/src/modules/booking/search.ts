import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function snippet(value: unknown, max = 140): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.length) return undefined
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 3)}...`
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = Array.isArray(value)
    ? value.map((item) => (item === null || item === undefined ? '' : String(item))).filter(Boolean).join(', ')
    : (typeof value === 'object' ? JSON.stringify(value) : String(value))
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

function friendlyLabel(input: string): string {
  return input
    .replace(/^cf:/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, (_, a, b) => `${a} ${b}`)
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function appendCustomFieldLines(lines: string[], customFields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined) continue
    appendLine(lines, friendlyLabel(key), value)
  }
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .map((part) => part.trim())
    .filter(Boolean)
  if (text.length === 0) return undefined
  return text.join(' · ')
}

function buildUrl(path: string, id?: string | null, suffix?: string): string | null {
  if (id) {
    return `/backend/booking/${path}/${encodeURIComponent(id)}${suffix ?? ''}`
  }
  return `/backend/booking/${path}${suffix ?? ''}`
}

function buildServicePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('booking.search.badge.service', 'Service')
  const description = snippet(record.description ?? customFields.description)
  const duration = record.duration_minutes ?? record.durationMinutes
  const maxAttendees = record.max_attendees ?? record.maxAttendees
  const maxAttendeesValue =
    typeof maxAttendees === 'number' || typeof maxAttendees === 'string' ? maxAttendees : null
  const status =
    typeof record.is_active === 'boolean'
      ? record.is_active
        ? t('booking.search.status.active', 'Active')
        : t('booking.search.status.inactive', 'Inactive')
      : undefined
  const durationUnit = t('booking.services.table.durationUnit', 'min')
  const maxLabel =
    maxAttendeesValue != null
      ? t('booking.search.service.maxAttendees', 'Max {{count}}', { count: maxAttendeesValue })
      : null
  return {
    title: String(title),
    subtitle: formatSubtitle(
      description,
      duration != null ? `${duration} ${durationUnit}` : null,
      maxLabel,
      status,
    ),
    icon: 'calendar',
    badge: t('booking.search.badge.service', 'Service'),
  }
}

function buildResourcePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('booking.search.badge.resource', 'Resource')
  const description = snippet(record.description ?? customFields.description)
  const capacity = record.capacity ?? record.capacity_value ?? record.capacityValue
  const capacityUnit = pickString(record.capacity_unit_name, record.capacityUnitName, record.capacity_unit_value, record.capacityUnitValue)
  const capacityLabel = capacity != null ? `${capacity}${capacityUnit ? ` ${capacityUnit}` : ''}` : null
  return {
    title: String(title),
    subtitle: formatSubtitle(description, capacityLabel),
    icon: 'box',
    badge: t('booking.search.badge.resource', 'Resource'),
  }
}

function buildResourceTypePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('booking.search.badge.resourceType', 'Resource type')
  const description = snippet(record.description ?? customFields.description)
  return {
    title: String(title),
    subtitle: formatSubtitle(description),
    icon: 'shapes',
    badge: t('booking.search.badge.resourceType', 'Resource type'),
  }
}

function buildTeamPresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('booking.search.badge.team', 'Team')
  const description = snippet(record.description ?? customFields.description)
  return {
    title: String(title),
    subtitle: formatSubtitle(description),
    icon: 'users',
    badge: t('booking.search.badge.team', 'Team'),
  }
}

function buildTeamMemberPresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.display_name, record.displayName, record.name, customFields.display_name, customFields.name) ??
    (record.id as string | undefined) ??
    t('booking.search.badge.teamMember', 'Team member')
  const description = snippet(record.description ?? customFields.description)
  const tags = Array.isArray(record.tags) ? record.tags.join(', ') : undefined
  return {
    title: String(title),
    subtitle: formatSubtitle(description, tags),
    icon: 'user',
    badge: t('booking.search.badge.teamMember', 'Team member'),
  }
}

function buildTeamRolePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('booking.search.badge.teamRole', 'Team role')
  const description = snippet(record.description ?? customFields.description)
  return {
    title: String(title),
    subtitle: formatSubtitle(description),
    icon: 'shield',
    badge: t('booking.search.badge.teamRole', 'Team role'),
  }
}

function buildAvailabilityRuleSetPresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('booking.search.badge.availabilityRuleSet', 'Availability rule set')
  const description = snippet(record.description ?? customFields.description)
  const timezone = pickString(record.timezone, customFields.timezone)
  return {
    title: String(title),
    subtitle: formatSubtitle(description, timezone),
    icon: 'calendar-check',
    badge: t('booking.search.badge.availabilityRuleSet', 'Availability rule set'),
  }
}

function buildAttendeePresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const firstName = pickString(record.first_name, record.firstName, customFields.first_name, customFields.firstName)
  const lastName = pickString(record.last_name, record.lastName, customFields.last_name, customFields.lastName)
  const nameParts = [firstName, lastName].filter(Boolean).join(' ')
  const title =
    pickString(record.display_name, record.displayName, customFields.display_name) ??
    (nameParts.length ? nameParts : null) ??
    pickString(record.email, customFields.email) ??
    (record.id as string | undefined) ??
    t('booking.search.badge.attendee', 'Attendee')
  const attendeeType = pickString(record.attendee_type, record.attendeeType, customFields.attendee_type)
  const email = pickString(record.email, customFields.email)
  const phone = pickString(record.phone, customFields.phone)
  const notes = snippet(record.notes ?? customFields.notes)
  return {
    title: String(title),
    subtitle: formatSubtitle(attendeeType, email, phone, notes),
    icon: 'user',
    badge: t('booking.search.badge.attendee', 'Attendee'),
  }
}

function buildIndexSource(
  ctx: SearchBuildContext,
  presenter: SearchResultPresenter,
  lines: string[],
): SearchIndexSource | null {
  appendCustomFieldLines(lines, ctx.customFields)
  if (!lines.length) return null
  return {
    text: lines,
    presenter,
    checksumSource: { record: ctx.record, customFields: ctx.customFields },
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'booking:booking_service',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Duration (min)', record.duration_minutes ?? record.durationMinutes)
        appendLine(lines, 'Capacity model', record.capacity_model ?? record.capacityModel)
        appendLine(lines, 'Max attendees', record.max_attendees ?? record.maxAttendees)
        appendLine(lines, 'Tags', record.tags)
        return buildIndexSource(ctx, buildServicePresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildServicePresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async () => buildUrl('services'),
      fieldPolicy: {
        searchable: ['name', 'description', 'duration_minutes', 'capacity_model', 'max_attendees', 'tags'],
      },
    },
    {
      entityId: 'booking:booking_resource',
      enabled: true,
      priority: 8,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Capacity', record.capacity ?? record.capacity_value ?? record.capacityValue)
        appendLine(lines, 'Capacity unit', record.capacity_unit_name ?? record.capacityUnitName ?? record.capacity_unit_value)
        appendLine(lines, 'Resource type', record.resource_type_id ?? record.resourceTypeId)
        appendLine(lines, 'Tags', record.tags)
        return buildIndexSource(ctx, buildResourcePresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildResourcePresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildUrl('resources', ctx.record.id as string ?? ctx.record.resource_id as string),
      fieldPolicy: {
        searchable: ['name', 'description', 'capacity', 'capacity_unit_name', 'capacity_unit_value', 'tags'],
      },
    },
    {
      entityId: 'booking:booking_resource_type',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Icon', record.appearance_icon ?? record.appearanceIcon)
        appendLine(lines, 'Color', record.appearance_color ?? record.appearanceColor)
        return buildIndexSource(ctx, buildResourceTypePresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildResourceTypePresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildUrl('resource-types', ctx.record.id as string ?? null, '/edit'),
      fieldPolicy: {
        searchable: ['name', 'description', 'appearance_icon', 'appearance_color'],
      },
    },
    {
      entityId: 'booking:booking_team',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Active', record.is_active ?? record.isActive)
        return buildIndexSource(ctx, buildTeamPresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTeamPresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildUrl('teams', ctx.record.id as string ?? null, '/edit'),
      fieldPolicy: {
        searchable: ['name', 'description'],
      },
    },
    {
      entityId: 'booking:booking_team_member',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.display_name ?? record.displayName ?? ctx.customFields.display_name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Tags', record.tags)
        appendLine(lines, 'Active', record.is_active ?? record.isActive)
        return buildIndexSource(ctx, buildTeamMemberPresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTeamMemberPresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildUrl('team-members', ctx.record.id as string ?? null),
      fieldPolicy: {
        searchable: ['display_name', 'description', 'tags'],
      },
    },
    {
      entityId: 'booking:booking_team_role',
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Icon', record.appearance_icon ?? record.appearanceIcon)
        appendLine(lines, 'Color', record.appearance_color ?? record.appearanceColor)
        return buildIndexSource(ctx, buildTeamRolePresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTeamRolePresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildUrl('team-roles', ctx.record.id as string ?? null, '/edit'),
      fieldPolicy: {
        searchable: ['name', 'description', 'appearance_icon', 'appearance_color'],
      },
    },
    {
      entityId: 'booking:booking_availability_rule_set',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Timezone', record.timezone ?? ctx.customFields.timezone)
        return buildIndexSource(ctx, buildAvailabilityRuleSetPresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildAvailabilityRuleSetPresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildUrl('availability-rulesets', ctx.record.id as string ?? null),
      fieldPolicy: {
        searchable: ['name', 'description', 'timezone'],
      },
    },
    {
      entityId: 'booking:booking_event_attendee',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'First name', record.first_name ?? record.firstName ?? ctx.customFields.first_name)
        appendLine(lines, 'Last name', record.last_name ?? record.lastName ?? ctx.customFields.last_name)
        appendLine(lines, 'Email', record.email ?? ctx.customFields.email)
        appendLine(lines, 'Phone', record.phone ?? ctx.customFields.phone)
        appendLine(lines, 'Attendee type', record.attendee_type ?? record.attendeeType ?? ctx.customFields.attendee_type)
        appendLine(lines, 'Notes', record.notes ?? ctx.customFields.notes)
        return buildIndexSource(ctx, buildAttendeePresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildAttendeePresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => buildUrl('attendees', ctx.record.id as string ?? null),
      fieldPolicy: {
        searchable: ['first_name', 'last_name', 'attendee_type', 'notes'],
        hashOnly: ['email', 'phone'],
        excluded: ['address_line1', 'address_line2', 'postal_code', 'external_ref'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
