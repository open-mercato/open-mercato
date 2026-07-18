/**
 * Scrap-reason dictionary (task 4.2, spec decision b): a generic
 * `dictionaries` module `Dictionary`/`DictionaryEntry` pair (NOT a
 * module-local entity), mirroring `seedCurrencyDictionary` in
 * `@open-mercato/core/modules/customers/cli.ts` — the platform pattern for
 * a module owning one system dictionary keyed by a stable `key`.
 *
 * `production-downtime-reasons` is explicitly DEFERRED to a future OEE
 * extension (spec decision b) and is NOT declared here.
 *
 * The manage UI is the generic `dictionaries` module settings page
 * (`/backend/config/dictionaries`) — production does not build its own
 * custom dictionary-settings section (unlike `customers`' bespoke
 * `DictionarySettings.tsx`), since the generic manager already supports
 * editing entries for any `Dictionary` row by key/name.
 */
export const PRODUCTION_SCRAP_REASON_DICTIONARY_KEY = 'production-scrap-reasons'

export const PRODUCTION_DICTIONARIES_MANAGE_HREF = '/backend/config/dictionaries'

export type ScrapReasonDefault = {
  value: string
  label: string
}

/**
 * English defaults only (spec decision: dictionary entries store labels as
 * plain data, not i18n keys — matching every other seeded dictionary in the
 * codebase, e.g. `DEAL_STATUS_DEFAULTS`/`ENTITY_STATUS_DEFAULTS` in
 * `customers/cli.ts`). Tenants can rename/add entries via the dictionaries
 * manage UI.
 */
export const SCRAP_REASON_DEFAULTS: ScrapReasonDefault[] = [
  { value: 'setup', label: 'Setup' },
  { value: 'material_defect', label: 'Material defect' },
  { value: 'operator_error', label: 'Operator error' },
  { value: 'machine_fault', label: 'Machine fault' },
  { value: 'other', label: 'Other' },
]
