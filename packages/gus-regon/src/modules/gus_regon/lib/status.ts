import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import { resolveEnvironment, resolveGusConfig } from './config'
import type { GusEnvironment } from './types'

/**
 * Effective availability of the GUS lookup for one organization.
 * Client-safe shape — never contains the API key. The CRM company card is off
 * by default and never active without an explicitly provided key, not even in
 * the Test environment, so a deployment cannot surface it by accident.
 */
export type GusStatus = {
  /** Integration switched on in Settings → Integrations. */
  enabled: boolean
  environment: GusEnvironment
  /** An API key is stored (any environment). */
  hasApiKey: boolean
  /** Lookups can run (enabled + a usable configuration; Test may use the public test key). */
  lookupAvailable: boolean
  /** The "Show on CRM company forms" switch is on. */
  companyFormsRequested: boolean
  /** The built-in CRM company card is shown: enabled + switch on + an API key provided. */
  companyFormsActive: boolean
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function resolveGusStatus(enabled: boolean, credentials: Record<string, unknown> | null | undefined): GusStatus {
  const environment = resolveEnvironment(credentials?.environment)
  const hasApiKey = hasText(credentials?.apiKey)
  const lookupAvailable = enabled && resolveGusConfig(credentials) !== null
  const companyFormsRequested = parseBooleanFromUnknown(credentials?.showOnCompanyForms) ?? false
  return {
    enabled,
    environment,
    hasApiKey,
    lookupAvailable,
    companyFormsRequested,
    companyFormsActive: lookupAvailable && companyFormsRequested && hasApiKey,
  }
}

export type CompanyCardState = 'active' | 'missing_key' | 'switch_off' | 'integration_off'

/** Why the CRM company card is (not) shown — drives the status line on the integration page. */
export function describeCompanyCard(status: GusStatus): CompanyCardState {
  if (status.companyFormsActive) return 'active'
  if (status.companyFormsRequested && !status.hasApiKey) return 'missing_key'
  if (!status.companyFormsRequested) return 'switch_off'
  return 'integration_off'
}
