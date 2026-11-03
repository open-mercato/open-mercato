import type { z } from 'zod'
import type { OmnibusConfigPatch } from '../data/validators'
import { omnibusConfigSchema, type OmnibusConfig } from './omnibusTypes'

export type OmnibusConfigFieldErrors = Record<string, string[]>

export type OmnibusConfigEvaluation =
  | { ok: true; config: OmnibusConfig }
  | { ok: false; status: 400; body: { error: string; details: { fieldErrors: OmnibusConfigFieldErrors } } }
  | { ok: false; status: 422; body: { field: 'enabled'; error: 'backfill_required_before_enable'; channels: string[] } }

export function parseStoredOmnibusConfig(raw: unknown): OmnibusConfig | null {
  if (raw === null || raw === undefined) return null
  const parsed = omnibusConfigSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function buildOmnibusFieldErrors(issues: z.core.$ZodIssue[]): OmnibusConfigFieldErrors {
  const fieldErrors: OmnibusConfigFieldErrors = {}
  for (const issue of issues) {
    const basePath = issue.path.map((segment) => String(segment)).join('.')
    const keys = issue.code === 'unrecognized_keys' ? issue.keys : null
    const paths = keys ? keys.map((key) => (basePath ? `${basePath}.${key}` : key)) : [basePath || '_root']
    for (const path of paths) {
      const bucket = fieldErrors[path] ?? []
      bucket.push(keys ? 'omnibus_field_not_supported' : issue.message)
      fieldErrors[path] = bucket
    }
  }
  return fieldErrors
}

export function invalidOmnibusConfig(fieldErrors: OmnibusConfigFieldErrors): OmnibusConfigEvaluation {
  return { ok: false, status: 400, body: { error: 'Invalid config', details: { fieldErrors } } }
}

export function mergeOmnibusConfig(existing: OmnibusConfig | null, patch: OmnibusConfigPatch): OmnibusConfig {
  const next: Record<string, unknown> = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || key === 'backfillCoverage') continue
    if (value === null) {
      delete next[key]
      continue
    }
    next[key] = value
  }
  return omnibusConfigSchema.parse(next)
}

export function listInScopeOmnibusChannels(config: OmnibusConfig): string[] {
  const enabledCountries = new Set(config.enabledCountryCodes)
  return Object.entries(config.channels)
    .filter(([, channel]) => Boolean(channel.countryCode && enabledCountries.has(channel.countryCode)))
    .map(([channelId]) => channelId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

export function evaluateOmnibusConfig(config: OmnibusConfig): OmnibusConfigEvaluation {
  if (!config.enabled) return { ok: true, config }
  const inScope = listInScopeOmnibusChannels(config)
  if (!config.defaultPresentedPriceKindId && inScope.length === 0) {
    return invalidOmnibusConfig({ defaultPresentedPriceKindId: ['omnibus_presented_price_kind_required'] })
  }
  const uncovered = inScope.filter((channelId) => !config.backfillCoverage[channelId])
  if (uncovered.length > 0) {
    return {
      ok: false,
      status: 422,
      body: { field: 'enabled', error: 'backfill_required_before_enable', channels: uncovered },
    }
  }
  return { ok: true, config }
}
