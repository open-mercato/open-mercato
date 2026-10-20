import type { TranslateFn, TranslateParams } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDate, formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import type { ExplainActorView, ExplainPrincipalView, ExplainValueView } from './types'

export const EXPLAIN_VALUE_MAX_LENGTH = 160

const DATE_PARAM_KEYS = new Set(['at', 'lastChangeAt', 'changedAt', 'since', 'until'])

export type FormattedExplainValue = {
  text: string
  tone: 'value' | 'empty' | 'redacted' | 'unknown'
}

type ValueLike = {
  value: unknown
  display: string | null
  valueKind: string
}

function truncate(text: string): string {
  return text.length > EXPLAIN_VALUE_MAX_LENGTH ? `${text.slice(0, EXPLAIN_VALUE_MAX_LENGTH - 1)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function formatExplainDateTime(value: string | null | undefined, locale?: string | null): string | null {
  return formatDisplayDateTime(value ?? null, locale ?? undefined)
}

function formatNumber(value: number, locale?: string | null): string {
  try {
    return new Intl.NumberFormat(locale ?? undefined, { maximumFractionDigits: 6 }).format(value)
  } catch {
    return String(value)
  }
}

function stringifyStructured(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function formatRawValue(source: ValueLike, t: TranslateFn, locale?: string | null): FormattedExplainValue {
  const display = typeof source.display === 'string' && source.display.trim().length > 0 ? source.display : null
  if (display) return { text: truncate(display), tone: 'value' }
  const raw = source.value
  if (raw === null || raw === undefined || raw === '') {
    return { text: t('insights.explain.values.empty'), tone: 'empty' }
  }
  if (typeof raw === 'boolean') {
    return { text: t(raw ? 'insights.why.values.true' : 'insights.why.values.false'), tone: 'value' }
  }
  if (typeof raw === 'number') return { text: formatNumber(raw, locale), tone: 'value' }
  if (typeof raw === 'string') {
    if (source.valueKind === 'datetime') return { text: formatExplainDateTime(raw, locale) ?? truncate(raw), tone: 'value' }
    if (source.valueKind === 'date') return { text: formatDisplayDate(raw, locale ?? undefined) ?? truncate(raw), tone: 'value' }
    return { text: truncate(raw), tone: 'value' }
  }
  if (Array.isArray(raw) && raw.length === 0) return { text: t('insights.explain.values.empty'), tone: 'empty' }
  if (isRecord(raw) && (typeof raw.amount === 'string' || typeof raw.amount === 'number')) {
    const amount = typeof raw.amount === 'number' ? formatNumber(raw.amount, locale) : raw.amount
    const currency = typeof raw.currencyCode === 'string' ? raw.currencyCode : typeof raw.currency === 'string' ? raw.currency : ''
    return { text: truncate(currency ? `${amount} ${currency}` : amount), tone: 'value' }
  }
  const structured = stringifyStructured(raw)
  return structured ? { text: truncate(structured), tone: 'value' } : { text: t('insights.why.values.notRecorded'), tone: 'unknown' }
}

export function formatExplainValue(
  value: ExplainValueView | null | undefined,
  t: TranslateFn,
  locale?: string | null,
): FormattedExplainValue {
  if (!value) return { text: t('insights.why.values.notRecorded'), tone: 'unknown' }
  if (value.redacted) return { text: t('insights.explain.values.redacted'), tone: 'redacted' }
  return formatRawValue(value, t, locale)
}

export function formatCurrentValue(current: ValueLike, t: TranslateFn, locale?: string | null): FormattedExplainValue {
  return formatRawValue(current, t, locale)
}

export function describeActor(actor: ExplainActorView, t: TranslateFn): string {
  if (actor.isSelf) return t('insights.explain.actor.you')
  if (actor.redacted) return t('insights.explain.actor.anotherUser')
  if (actor.kind === 'system') return t('insights.explain.actor.system')
  if (actor.kind === 'api_key') return actor.label ?? t('insights.explain.actor.apiKey')
  return actor.label ?? t('insights.why.actor.unknown')
}

export function describePrincipal(principal: ExplainPrincipalView, t: TranslateFn): string {
  if (principal.isSelf) return t('insights.explain.actor.you')
  if (principal.redacted) return t('insights.explain.actor.anotherUser')
  return principal.label ?? t('insights.why.actor.unknown')
}

export function toTranslateParams(
  params: Record<string, string | number | boolean | null> | null | undefined,
  locale?: string | null,
): TranslateParams {
  const result: TranslateParams = {}
  if (!params) return result
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      result[key] = ''
    } else if (typeof value === 'string' && DATE_PARAM_KEYS.has(key)) {
      result[key] = formatExplainDateTime(value, locale) ?? value
    } else if (typeof value === 'boolean') {
      result[key] = String(value)
    } else {
      result[key] = value
    }
  }
  return result
}

export const CUSTOM_FIELD_PREFIX = 'cf:'

export function describeFieldLabel(field: string, labelKey: string | null | undefined, t: TranslateFn): string {
  if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
    return t('insights.why.field.customFieldLabel', { key: field.slice(CUSTOM_FIELD_PREFIX.length) })
  }
  return labelKey ? t(labelKey) : field
}

export function readTranslationKeyParam(
  params: Record<string, string | number | boolean | null> | null | undefined,
  name: 'labelKey' | 'reasonKey',
): string | null {
  const value = params?.[name]
  return typeof value === 'string' && /^[a-z0-9_]+(?:\.[a-zA-Z0-9_-]+)+$/.test(value) ? value : null
}
