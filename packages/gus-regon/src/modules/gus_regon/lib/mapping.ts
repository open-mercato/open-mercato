import type { GusCompany } from './types'

/**
 * Client-safe mapping of a GUS company onto CrudForm values.
 *
 * Rules: fill empty fields only (operator-typed values always win), never
 * remove anything, report which fields were filled.
 */

export type FormValues = Record<string, unknown>

export type ApplyResult = {
  values: FormValues
  filled: string[]
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
}

/** "MAZOWIECKIE" → "Mazowieckie", "WARMIŃSKO-MAZURSKIE" → "Warmińsko-Mazurskie". */
export function toTitleCase(value: string | null): string | null {
  if (!value) return null
  return value
    .toLocaleLowerCase('pl-PL')
    .replace(/(^|[\s-])(\p{L})/gu, (_match, sep: string, letter: string) => `${sep}${letter.toLocaleUpperCase('pl-PL')}`)
}

function newDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tmp-${Math.random().toString(36).slice(2)}`
}

export type CompanyAddressDraft = {
  id: string
  name?: string
  companyName?: string
  addressLine1: string
  buildingNumber?: string
  flatNumber?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  isPrimary: boolean
}

/** Builds a primary address draft in the shape used by the customers company form. */
export function buildAddressDraft(company: GusCompany, label?: string): CompanyAddressDraft | null {
  const addressLine1 = company.street ?? company.city
  if (!addressLine1) return null
  return {
    id: newDraftId(),
    ...(label ? { name: label } : {}),
    ...(company.name ? { companyName: company.name } : {}),
    addressLine1,
    ...(company.buildingNumber ? { buildingNumber: company.buildingNumber } : {}),
    ...(company.flatNumber ? { flatNumber: company.flatNumber } : {}),
    ...(company.city ? { city: company.city } : {}),
    ...(company.voivodeship ? { region: toTitleCase(company.voivodeship) ?? undefined } : {}),
    ...(company.postalCode ? { postalCode: company.postalCode } : {}),
    country: company.country,
    isPrimary: true,
  }
}

/**
 * Applies GUS data to the customers company form
 * (`crud-form:customers.company` edit form and the company create form).
 *
 * - `legalName`, `displayName` ← GUS name (when empty)
 * - `addresses` ← one primary address (only when the form manages addresses and has none yet)
 */
export function applyCompanyToCustomersCompanyForm(
  values: FormValues,
  company: GusCompany,
  options: { addressLabel?: string } = {},
): ApplyResult {
  const next: FormValues = { ...values }
  const filled: string[] = []

  if (company.name) {
    for (const key of ['legalName', 'displayName']) {
      if (isBlank(next[key])) {
        next[key] = company.name
        filled.push(key)
      }
    }
  }

  if (Array.isArray(values.addresses) && values.addresses.length === 0) {
    const draft = buildAddressDraft(company, options.addressLabel)
    if (draft) {
      next.addresses = [draft]
      filled.push('addresses')
    }
  }

  return { values: next, filled }
}
