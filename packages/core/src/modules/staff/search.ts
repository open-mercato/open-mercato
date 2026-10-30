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

/**
 * EP-46. The four time-tracking entities below join `staff:staff_time_project`
 * in the index, and every one of them carries a gate that is deliberately
 * stricter than the feature its REST route declares.
 *
 * The reason is a property of the search layer, not of this module: an entity's
 * `aclFeatures` is the ONLY authorization the search pipeline applies. It is
 * enforced twice per query — `resolveReadableEntityTypes` narrows the entity
 * list before the query and `filterSearchResultsByEntityAccess` filters the
 * results after it — but both decide **per entity type**, never per record.
 * `SearchEntityConfig` has no row-level hook and `SearchOptions` has no record-id
 * allowlist, so a search gate cannot reproduce the per-project membership
 * intersection that `resolveProjectAccess` applies on every time-tracking route.
 *
 * So each gate below names the feature set whose holder already sees **every**
 * record of that entity through the API. `staff.timesheets.projects.manage` is
 * that feature for entries, tasks and reports: it is what makes
 * `resolveProjectAccess` answer `canManageAll: true`, which is the only state in
 * which those routes stop intersecting with the caller's project membership.
 * A project member without it gets no hits at all rather than hits for projects
 * they cannot open — the failure mode that costs a support ticket, not the one
 * that discloses a client's work.
 */
const UNRESTRICTED_PROJECT_ACCESS_FEATURE = 'staff.timesheets.projects.manage'

function buildTimeTaskPresenter(t: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const title =
    pickString(record.title, record.reference) ?? (record.id as string | undefined) ?? t('staff.search.badge.timeTask', 'Task')
  return {
    title: String(title),
    subtitle: formatSubtitle(record.reference, snippet(record.description, 80)),
    icon: 'list-checks',
    badge: t('staff.search.badge.timeTask', 'Task'),
  }
}

function buildTimeReportPresenter(t: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const title =
    pickString(record.title, record.reference) ?? (record.id as string | undefined) ?? t('staff.search.badge.timeReport', 'Report')
  return {
    title: String(title),
    subtitle: formatSubtitle(record.reference, record.period_from ?? record.periodFrom, record.period_to ?? record.periodTo),
    icon: 'file-text',
    badge: t('staff.search.badge.timeReport', 'Report'),
  }
}

function buildTimeTagPresenter(t: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const title =
    pickString(record.label, record.slug) ?? (record.id as string | undefined) ?? t('staff.search.badge.timeTag', 'Tag')
  return {
    title: String(title),
    subtitle: formatSubtitle(record.slug),
    icon: 'tag',
    badge: t('staff.search.badge.timeTag', 'Tag'),
  }
}

function buildTimeEntryPresenter(t: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const title = snippet(record.notes, 80) ?? t('staff.search.badge.timeEntry', 'Time entry')
  return {
    title,
    subtitle: formatSubtitle(record.date, record.duration_minutes ?? record.durationMinutes),
    icon: 'timer',
    badge: t('staff.search.badge.timeEntry', 'Time entry'),
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'staff:staff_team',
      aclFeatures: ['staff.view'],
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
      aclFeatures: ['staff.view'],
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
      aclFeatures: ['staff.view'],
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
    {
      entityId: 'staff:staff_time_project',
      aclFeatures: ['staff.timesheets.projects.view'],
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Code', record.code)
        appendLine(lines, 'Description', record.description)
        appendLine(lines, 'Type', record.project_type ?? record.projectType)
        appendLine(lines, 'Cost Center', record.cost_center ?? record.costCenter)
        const presenter: SearchResultPresenter = {
          title: String(record.name ?? record.id ?? t('staff.search.badge.timeProject', 'Project')),
          subtitle: formatSubtitle(record.code, record.project_type ?? record.projectType),
          icon: 'clock',
          badge: t('staff.search.badge.timeProject', 'Project'),
        }
        return buildIndexSource(ctx, presenter, lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return {
          title: String(ctx.record.name ?? ctx.record.id ?? ''),
          subtitle: formatSubtitle(ctx.record.code, ctx.record.project_type ?? ctx.record.projectType),
          icon: 'clock',
          badge: t('staff.search.badge.timeProject', 'Project'),
        }
      },
      resolveUrl: async (ctx) => `/backend/staff/time-tracking/projects/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['name', 'code', 'description', 'project_type', 'cost_center'],
      },
    },
    {
      entityId: 'staff:staff_time_task',
      aclFeatures: ['staff.timesheets.tasks.view', UNRESTRICTED_PROJECT_ACCESS_FEATURE],
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Reference', record.reference)
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Description', record.description)
        return buildIndexSource(ctx, buildTimeTaskPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTimeTaskPresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) => {
        const projectId = pickString(ctx.record.time_project_id, ctx.record.timeProjectId)
        if (!projectId) return null
        return `/backend/staff/time-tracking/board?projectId=${encodeURIComponent(projectId)}&task=${encodeURIComponent(String(ctx.record.id))}`
      },
      fieldPolicy: {
        searchable: ['title', 'description', 'reference'],
      },
    },
    {
      entityId: 'staff:staff_time_report',
      aclFeatures: ['staff.timesheets.reports.view', UNRESTRICTED_PROJECT_ACCESS_FEATURE],
      enabled: true,
      priority: 7,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Reference', record.reference)
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Status', record.status)
        return buildIndexSource(ctx, buildTimeReportPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTimeReportPresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) => `/backend/staff/time-tracking/reports/${encodeURIComponent(String(ctx.record.id))}`,
      /**
       * `total_amount` and the denormalised `customer_snapshot` are excluded, not
       * merely left out of `searchable`: money in a time-tracking response is
       * gated on `staff.timesheets.rates.view`, and the search pipeline has no way
       * to apply a second feature to a subset of an indexed record's fields.
       */
      fieldPolicy: {
        searchable: ['reference', 'title'],
        excluded: ['total_amount', 'customer_snapshot'],
      },
    },
    {
      entityId: 'staff:staff_time_tag',
      aclFeatures: ['staff.timesheets.view'],
      enabled: true,
      priority: 5,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Label', record.label)
        appendLine(lines, 'Slug', record.slug)
        return buildIndexSource(ctx, buildTimeTagPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTimeTagPresenter(t, ctx.record)
      },
      /**
       * A tag has no detail screen and the entries list deep-links only `taskId`
       * and `ids`, so there is no honest destination to send the caller to. The
       * presenter still answers the question a tag search asks — "does this label
       * exist, and what is it spelled" — and `url` is optional in the result
       * contract, so an unlinked hit renders rather than pointing somewhere wrong.
       */
      resolveUrl: async () => null,
      fieldPolicy: {
        searchable: ['label', 'slug'],
      },
    },
    {
      /**
       * Entry notes are the most sensitive text time tracking holds — they are
       * where a consultant writes what they did for a named client. The gate is
       * therefore the strictest one the module has for entries: `staff.timesheets.view`
       * AND `staff.timesheets.projects.manage`, the pair that makes
       * `resolveProjectAccess` return `canManageAll`, which is the only state in
       * which `/api/staff/timesheets/time-entries` stops narrowing to the caller's
       * own entries plus their project memberships. A consultant with
       * `staff.timesheets.manage_own` gets no entry hits at all — including their
       * own — because the gate cannot express "own" and half a gate is worse than
       * none.
       */
      entityId: 'staff:staff_time_entry',
      aclFeatures: ['staff.timesheets.view', UNRESTRICTED_PROJECT_ACCESS_FEATURE],
      enabled: true,
      priority: 4,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Notes', record.notes)
        appendLine(lines, 'Date', record.date)
        return buildIndexSource(ctx, buildTimeEntryPresenter(t, record), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildTimeEntryPresenter(t, ctx.record)
      },
      resolveUrl: async (ctx) =>
        `/backend/staff/time-tracking/entries?ids=${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['notes'],
        excluded: ['rate_override_amount', 'rate_currency_code'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
