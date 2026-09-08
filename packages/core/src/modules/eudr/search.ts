import type { SearchBuildContext, SearchIndexSource, SearchModuleConfig, SearchResultPresenter } from '@open-mercato/shared/modules/search'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const EUDR_STATEMENTS_URL = '/backend/eudr/statements'
const EUDR_PLOTS_URL = '/backend/eudr/plots'
const EUDR_EVIDENCE_SUBMISSIONS_URL = '/backend/eudr/evidence-submissions'

function assertTenantContext(ctx: SearchBuildContext): void {
  if (typeof ctx.tenantId !== 'string' || ctx.tenantId.length === 0) {
    throw new Error('[internal] [search.eudr] Missing tenantId in search build context')
  }
}

function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function readRecordText(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const text = normalizeText(record[key])
    if (text) return text
  }
  return null
}

function readObjectText(source: unknown, ...keys: string[]): string | null {
  if (!source || typeof source !== 'object') return null
  return readRecordText(source as Record<string, unknown>, ...keys)
}

function formatSubtitle(...parts: Array<unknown>): string | undefined {
  const text = parts
    .map((part) => normalizeText(part))
    .filter((value): value is string => Boolean(value))
  if (!text.length) return undefined
  return text.join(' · ')
}

function appendLine(lines: string[], label: string, value: unknown) {
  const text = normalizeText(value)
  if (!text) return
  lines.push(`${label}: ${text}`)
}

function friendlyLabel(input: string): string {
  return input
    .replace(/^cf:/, '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, (_match, firstChar, secondChar) => `${firstChar} ${secondChar}`)
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function appendCustomFieldLines(lines: string[], customFields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined) continue
    appendLine(lines, friendlyLabel(key), value)
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

function buildRecordUrl(baseUrl: string, record: Record<string, unknown>): string | null {
  const recordId = readRecordText(record, 'id')
  return recordId ? `${baseUrl}/${encodeURIComponent(recordId)}` : null
}

function translateToken(translate: TranslateFn, prefix: string, value: string | null): string | null {
  if (!value) return null
  return translate(`${prefix}.${value}`, value)
}

function resolveSupplierName(record: Record<string, unknown>): string | null {
  const snapshot = record.supplier_snapshot ?? record.supplierSnapshot
  return readObjectText(snapshot, 'display_name', 'displayName', 'name')
}

function buildStatementPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('eudr.search.badge.statement', 'DDS statement')
  const title = readRecordText(record, 'title') ?? translate('eudr.common.recordUnavailable')
  const subtitle = formatSubtitle(
    readRecordText(record, 'reference_number', 'referenceNumber'),
    translateToken(translate, 'eudr.commodity', readRecordText(record, 'commodity')),
  )
  return { title, subtitle, icon: 'file-check', badge: label }
}

function buildPlotPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('eudr.search.badge.plot', 'Plot')
  const title = readRecordText(record, 'name') ?? translate('eudr.common.recordUnavailable')
  const subtitle = formatSubtitle(
    readRecordText(record, 'origin_country', 'originCountry'),
    translateToken(translate, 'eudr.plotType', readRecordText(record, 'plot_type', 'plotType')),
  )
  return { title, subtitle, icon: 'map-pin', badge: label }
}

function buildSubmissionPresenter(translate: TranslateFn, record: Record<string, unknown>): SearchResultPresenter {
  const label = translate('eudr.search.badge.submission', 'Evidence submission')
  const batchNumber = readRecordText(record, 'batch_number', 'batchNumber')
  const supplierName = resolveSupplierName(record)
  const title = batchNumber
    ? `${label} ${batchNumber}`
    : supplierName ?? translate('eudr.common.recordUnavailable')
  const subtitle = formatSubtitle(
    supplierName,
    translateToken(translate, 'eudr.submissionStatus', readRecordText(record, 'status')),
  )
  return { title, subtitle, icon: 'package', badge: label }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'eudr:eudr_due_diligence_statement',
      enabled: true,
      priority: 8,
      fieldPolicy: {
        searchable: ['title', 'reference_number', 'commodity'],
        excluded: ['notes'],
      },
      buildSource: async (ctx) => {
        assertTenantContext(ctx)
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Title', record.title)
        appendLine(lines, 'Reference number', record.reference_number ?? record.referenceNumber)
        appendLine(lines, 'Commodity', record.commodity)
        return buildIndexSource(ctx, buildStatementPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildStatementPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildRecordUrl(EUDR_STATEMENTS_URL, ctx.record),
      aclFeatures: ['eudr.statements.view'],
    },
    {
      entityId: 'eudr:eudr_plot',
      enabled: true,
      priority: 7,
      fieldPolicy: {
        searchable: ['name', 'external_id', 'origin_country'],
        excluded: ['producer_name'],
      },
      buildSource: async (ctx) => {
        assertTenantContext(ctx)
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'External ID', record.external_id ?? record.externalId)
        appendLine(lines, 'Origin country', record.origin_country ?? record.originCountry)
        return buildIndexSource(ctx, buildPlotPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildPlotPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildRecordUrl(EUDR_PLOTS_URL, ctx.record),
      aclFeatures: ['eudr.plots.view'],
    },
    {
      entityId: 'eudr:eudr_evidence_submission',
      enabled: true,
      priority: 6,
      fieldPolicy: {
        searchable: ['batch_number', 'commodity'],
        excluded: ['producer_name', 'notes'],
      },
      buildSource: async (ctx) => {
        assertTenantContext(ctx)
        const { t: translate } = await resolveTranslations()
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Batch number', record.batch_number ?? record.batchNumber)
        appendLine(lines, 'Commodity', record.commodity)
        appendLine(lines, 'Supplier', resolveSupplierName(record))
        return buildIndexSource(ctx, buildSubmissionPresenter(translate, record), lines)
      },
      formatResult: async (ctx) => {
        const { t: translate } = await resolveTranslations()
        return buildSubmissionPresenter(translate, ctx.record)
      },
      resolveUrl: async (ctx) => buildRecordUrl(EUDR_EVIDENCE_SUBMISSIONS_URL, ctx.record),
      aclFeatures: ['eudr.submissions.view'],
    },
  ],
}

export default searchConfig
export const config = searchConfig
