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

function buildRuleSetPresenter(
  t: TranslateFn,
  record: Record<string, unknown>,
  customFields: Record<string, unknown>,
): SearchResultPresenter {
  const title =
    pickString(record.name, record.display_name, record.displayName, customFields.name, customFields.display_name) ??
    (record.id as string | undefined) ??
    t('planner.search.badge.availabilityRuleSet', 'Availability rule set')
  const description = snippet(record.description ?? customFields.description)
  const timezone = pickString(record.timezone, customFields.timezone)
  return {
    title: String(title),
    subtitle: formatSubtitle(description, timezone),
    icon: 'calendar-check',
    badge: t('planner.search.badge.availabilityRuleSet', 'Availability rule set'),
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
      entityId: 'planner:planner_availability_rule_set',
      enabled: true,
      priority: 6,
      buildSource: async (ctx) => {
        const { t } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name ?? record.display_name ?? ctx.customFields.name)
        appendLine(lines, 'Description', record.description ?? ctx.customFields.description)
        appendLine(lines, 'Timezone', record.timezone ?? ctx.customFields.timezone)
        return buildIndexSource(ctx, buildRuleSetPresenter(t, record, ctx.customFields), lines)
      },
      formatResult: async (ctx) => {
        const { t } = await resolveTranslations()
        return buildRuleSetPresenter(t, ctx.record, ctx.customFields)
      },
      resolveUrl: async (ctx) => `/backend/planner/availability-rulesets/${encodeURIComponent(String(ctx.record.id))}`,
      fieldPolicy: {
        searchable: ['name', 'description', 'timezone'],
      },
    },
  ],
}

export default searchConfig
export const config = searchConfig
