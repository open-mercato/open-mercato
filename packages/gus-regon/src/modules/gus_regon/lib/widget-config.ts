import type { InjectionWidgetMetadata } from '@open-mercato/shared/modules/widgets/injection'
import type { ApplyResult, FormValues } from './mapping'
import type { GusCompany } from './types'

/**
 * Declarative configuration for a "Fetch from GUS" widget on any CrudForm.
 *
 * Client-safe and React-free, so it can be unit-tested and shared by the
 * built-in company widget and by host modules (see `createGusLookupWidget`).
 */

/** GUS values a host form can map. `streetLine` = street + building/flat number ("ul. Krucza 53/2"). */
export type GusCompanyField =
  | 'name'
  | 'nip'
  | 'regon'
  | 'street'
  | 'streetLine'
  | 'buildingNumber'
  | 'flatNumber'
  | 'postalCode'
  | 'city'
  | 'voivodeship'
  | 'county'
  | 'commune'
  | 'country'

/** GUS field → host form field id(s). Every target is filled only while empty. */
export type GusFieldMap = Partial<Record<GusCompanyField, string | string[]>>

export type GusVisibilityContext = {
  pathname: string
  operation?: string
  values: FormValues
}

export type GusLookupWidgetConfig = {
  /** Widget id, e.g. `purchasing.injection.gus-supplier`. Must be unique across modules. */
  id: string
  /** Map GUS values onto the host form fields (fill-empty-only). Use this OR `apply`. */
  fields?: GusFieldMap
  /** Custom mapping for forms that need more than a field map (e.g. address arrays). */
  apply?: (values: FormValues, company: GusCompany, helpers: { t: (key: string, fallback: string) => string }) => ApplyResult
  /** Form field holding the NIP; pre-fills the lookup input. */
  nipField?: string
  /** i18n keys (or plain text) for the field ids, used in the "Filled from GUS: …" message. */
  fieldLabels?: Record<string, string>
  /** Optional i18n key (or plain text) for the card heading. */
  titleKey?: string
  /** Optional i18n key (or plain text) for the helper text under the heading. */
  descriptionKey?: string
  /** Optional visibility rule (e.g. when one spot is shared by several forms). Defaults to always visible. */
  visible?: (context: GusVisibilityContext) => boolean
  /**
   * When the card renders:
   * - `lookup` (default) — the GUS integration is enabled and usable for the organization.
   * - `companyForms` — additionally the "Show on CRM company forms" switch is on and an API key is set
   *   (used by the built-in CRM company card).
   */
  gate?: 'lookup' | 'companyForms'
  /** ACL features required to see the widget. Defaults to `['gus_regon.lookup']`. */
  features?: string[]
  /** Extra modules that must be enabled for the widget to load (always includes `gus_regon` and `integrations`). */
  requiredModules?: string[]
  priority?: number
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
}

/** Resolves one mappable GUS value. */
export function resolveCompanyValue(company: GusCompany, field: GusCompanyField): string | null {
  switch (field) {
    case 'streetLine': {
      const base = company.street ?? company.city
      if (!base) return null
      const number = [company.buildingNumber, company.flatNumber].filter(Boolean).join('/')
      return number ? `${base} ${number}` : base
    }
    case 'country':
      return company.country
    default:
      return company[field] ?? null
  }
}

/** Whether a widget may render for the given status (`null`/`undefined` = unknown → hidden). */
export function isWidgetAllowed(
  gate: GusLookupWidgetConfig['gate'],
  status: { lookupAvailable: boolean; companyFormsActive: boolean } | null | undefined,
): boolean {
  if (!status) return false
  return gate === 'companyForms' ? status.companyFormsActive : status.lookupAvailable
}

/** Applies a field map: fills empty target fields only, never mutates the input. */
export function applyFieldMap(values: FormValues, company: GusCompany, map: GusFieldMap): ApplyResult {
  const next: FormValues = { ...values }
  const filled: string[] = []
  for (const [source, targets] of Object.entries(map) as Array<[GusCompanyField, string | string[] | undefined]>) {
    if (!targets) continue
    const value = resolveCompanyValue(company, source)
    if (value === null) continue
    for (const target of Array.isArray(targets) ? targets : [targets]) {
      if (isBlank(next[target])) {
        next[target] = value
        filled.push(target)
      }
    }
  }
  return { values: next, filled }
}

/** Validates the config and builds the injection widget metadata. Throws on misconfiguration. */
export function buildWidgetMetadata(config: GusLookupWidgetConfig): InjectionWidgetMetadata {
  if (!config.id || !/^[a-z0-9_]+\.[a-z0-9_.-]+$/.test(config.id)) {
    throw new Error(`[gus_regon] invalid widget id "${config.id}" — use "<module>.injection.<name>"`)
  }
  if (!config.fields && !config.apply) {
    throw new Error(`[gus_regon] widget "${config.id}" needs either "fields" or "apply"`)
  }
  if (config.fields && config.apply) {
    throw new Error(`[gus_regon] widget "${config.id}" must not define both "fields" and "apply"`)
  }
  if (config.gate && config.gate !== 'lookup' && config.gate !== 'companyForms') {
    throw new Error(`[gus_regon] widget "${config.id}" has an unknown gate "${String(config.gate)}"`)
  }
  return {
    id: config.id,
    title: 'GUS REGON',
    description: 'Fetch company data from GUS REGON by NIP.',
    features: config.features ?? ['gus_regon.lookup'],
    requiredModules: Array.from(new Set(['gus_regon', 'integrations', ...(config.requiredModules ?? [])])),
    priority: config.priority ?? 50,
  }
}
