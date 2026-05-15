/**
 * Curated ISO 3166-1 alpha-2 country catalog for the v1 `address` field type
 * (Phase C of `.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * The list is intentionally small (~25 commonly-targeted countries for the
 * DentalOS pilot + early B2B deployments). Authors who need a longer catalog
 * can override the country select per-form via Phase F+ extensions. The codes
 * follow ISO 3166-1 alpha-2 per § Implementation Plan C.
 */
export type CountryOption = {
  /** ISO 3166-1 alpha-2 code (uppercase). */
  code: string
  /** English display name. Translated labels land with the i18n bundle. */
  name: string
}

export const COUNTRY_OPTIONS: ReadonlyArray<CountryOption> = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PL', name: 'Poland' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'IE', name: 'Ireland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'JP', name: 'Japan' },
  { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'ZA', name: 'South Africa' },
]

const COUNTRY_NAME_BY_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const option of COUNTRY_OPTIONS) {
    map[option.code] = option.name
  }
  return map
})()

/**
 * Returns the English country name for the provided alpha-2 code, or the
 * code itself when the code is not in the curated catalog.
 */
export function resolveCountryName(code: string): string {
  if (!code) return ''
  return COUNTRY_NAME_BY_CODE[code] ?? code
}
