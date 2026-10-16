import { companyCreateSchema } from '@open-mercato/core/modules/customers/data/validators'
import { nonBlank, type XeroContact, type XeroPhone } from './contact'

export const XERO_COMPANY_NAME_MAX_LENGTH = 200
export const XERO_PHONE_TYPES = ['DEFAULT', 'MOBILE', 'DDI', 'OFFICE'] as const
const ITALY_COUNTRY_CODE = '39'
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

export type XeroCompanyField = 'displayName' | 'legalName' | 'primaryEmail' | 'primaryPhone' | 'websiteUrl'
export type XeroValueWarning = { code: 'xero.value_left_out' | 'xero.value_truncated'; field: XeroCompanyField }
export type XeroContactStatus = 'ACTIVE' | 'ARCHIVED' | 'GDPRREQUEST'

/** The Xero-owned Company values of one Contact after App Spec § 6.2a rules 1–3; `null` means "leave OM's value". */
export type MappedXeroCompany = {
  displayName: string
  legalName: string
  primaryEmail: string | null
  primaryPhone: string | null
  websiteUrl: string | null
  taxNumber: string | null
  contactStatus: XeroContactStatus | null
  warnings: XeroValueWarning[]
}

export type XeroCompanyMapping = { ok: true; company: MappedXeroCompany } | { ok: false; reason: 'name_missing' }

const fields = companyCreateSchema.shape

function accepted(schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }, value: string): boolean {
  const result = schema.safeParse(value)
  return result.success && typeof result.data === 'string' && result.data.length > 0
}

function pickPhone(phones: XeroPhone[] | null | undefined): XeroPhone | null {
  for (const type of XERO_PHONE_TYPES) {
    const phone = (phones ?? []).find((entry) => entry.PhoneType?.toUpperCase() === type && nonBlank(entry.PhoneNumber))
    if (phone) return phone
  }
  return null
}

/**
 * `+<PhoneCountryCode> <PhoneAreaCode> <PhoneNumber>`, with non-digits stripped from the country code
 * and a leading trunk `0` dropped from the area code, except for Italy. `null` without a country code,
 * because OM requires one and the Organisation's country is not read.
 */
export function formatXeroPhone(phone: XeroPhone): string | null {
  const countryCode = (phone.PhoneCountryCode ?? '').replace(/\D/g, '')
  const number = nonBlank(phone.PhoneNumber)
  if (!countryCode || !number) return null
  const areaCode = nonBlank(phone.PhoneAreaCode) ?? ''
  const area = countryCode === ITALY_COUNTRY_CODE ? areaCode : areaCode.replace(/^0/, '')
  return [`+${countryCode}`, area, number].filter((part) => part.length > 0).join(' ')
}

export function normalizeXeroWebsite(website: string): string {
  return URL_SCHEME.test(website) ? website : `https://${website}`
}

function contactStatusOf(value: string | null | undefined): XeroContactStatus | null {
  const status = nonBlank(value)?.toUpperCase()
  return status === 'ACTIVE' || status === 'ARCHIVED' || status === 'GDPRREQUEST' ? status : null
}

/** App Spec § 6.2a "Company": a pure mapping; the caller compares the result with the Company before any write. */
export function mapXeroContactToCompany(contact: XeroContact): XeroCompanyMapping {
  const name = nonBlank(contact.Name)
  if (!name) return { ok: false, reason: 'name_missing' }
  const warnings: XeroValueWarning[] = []

  let displayName = name
  if (displayName.length > XERO_COMPANY_NAME_MAX_LENGTH) {
    displayName = displayName.slice(0, XERO_COMPANY_NAME_MAX_LENGTH).trimEnd()
    warnings.push({ code: 'xero.value_truncated', field: 'displayName' }, { code: 'xero.value_truncated', field: 'legalName' })
  }

  let primaryEmail = nonBlank(contact.EmailAddress)
  if (primaryEmail && !accepted(fields.primaryEmail, primaryEmail)) {
    primaryEmail = null
    warnings.push({ code: 'xero.value_left_out', field: 'primaryEmail' })
  }

  let primaryPhone: string | null = null
  const phone = pickPhone(contact.Phones)
  if (phone) {
    const formatted = formatXeroPhone(phone)
    if (formatted && accepted(fields.primaryPhone, formatted)) primaryPhone = formatted
    else warnings.push({ code: 'xero.value_left_out', field: 'primaryPhone' })
  }

  let websiteUrl: string | null = null
  const website = nonBlank(contact.Website)
  if (website) {
    const normalized = normalizeXeroWebsite(website)
    if (accepted(fields.websiteUrl, normalized)) websiteUrl = normalized
    else warnings.push({ code: 'xero.value_left_out', field: 'websiteUrl' })
  }

  return {
    ok: true,
    company: {
      displayName,
      legalName: displayName,
      primaryEmail,
      primaryPhone,
      websiteUrl,
      taxNumber: nonBlank(contact.TaxNumber),
      contactStatus: contactStatusOf(contact.ContactStatus),
      warnings,
    },
  }
}
