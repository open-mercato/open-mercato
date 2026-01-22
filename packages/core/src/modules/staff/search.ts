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

function appendCustomFieldLines(lines: string[], customFields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined) continue
    appendLine(lines, key.replace(/^cf:/, ''), value)
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

function buildTeamPresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('staff.search.badge.team', 'Team')
  const description = snippet(record.description ?? customFields.description)
  return {
    title: String(title),
    subtitle: formatSubtitle(description),
    icon: 'users',
    badge: t('staff.search.badge.team', 'Team'),
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
    t('staff.search.badge.teamMember', 'Employee')
  const description = snippet(record.description ?? customFields.description)
  const tags = Array.isArray(record.tags) ? record.tags.join(', ') : undefined
  return {
    title: String(title),
    subtitle: formatSubtitle(description, tags),
    icon: 'user',
    badge: t('staff.search.badge.teamMember', 'Employee'),
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
    t('staff.search.badge.teamRole', 'Role')
  const description = snippet(record.description ?? customFields.description)
  return {
    title: String(title),
    subtitle: formatSubtitle(description),
    icon: 'shield',
    badge: t('staff.search.badge.teamRole', 'Role'),
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
      entityId: 'staff:staff_team',
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
      resolveUrl: async (ctx) => `/backend/staff/teams/${encodeURIComponent(String(ctx.record.id))}/edit`,
      fieldPolicy: {
        searchable: ['name', 'description'],
      },
    },
    {
      entityId: 'staff:staff_team_member',
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
      resolveUrl: async (ctx) => `/backend/staff/team-members/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['display_name', 'description', 'tags'],
      },
    },
    {
      entityId: 'staff:staff_team_role',
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
      resolveUrl: async (ctx) => `/backend/staff/team-roles/${encodeURIComponent(String(ctx.record.id))}/edit`,
      fieldPolicy: {
        searchable: ['name', 'description', 'appearance_icon', 'appearance_color'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
