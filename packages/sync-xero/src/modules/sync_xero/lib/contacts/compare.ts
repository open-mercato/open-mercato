import { XERO_CONTACT_MARKER_FIELD, XERO_TAX_NUMBER_FIELD } from '../field-definitions'
import { normalizeTaxNumber } from './indexes'
import type { MappedXeroCompany, XeroContactStatus } from './mapping'

/** A Company as the run reads it: the Xero-owned columns and the profile's custom-field values. */
export type CompanySnapshot = {
  entityId: string
  displayName: string | null
  legalName: string | null
  primaryEmail: string | null
  primaryPhone: string | null
  websiteUrl: string | null
  status: string | null
  isActive: boolean
  custom: Record<string, unknown>
}

/** Only Xero-owned keys (App Spec § 6.2 rule 2): an OM-only field can never appear in it. */
export type CompanyWriteInput = {
  displayName?: string
  legalName?: string
  primaryEmail?: string
  primaryPhone?: string
  websiteUrl?: string
  status?: 'active' | 'archived'
  isActive?: boolean
  customFields?: Record<string, string>
}

type StatusTarget = { status: 'active' | 'archived'; isActive: boolean }

const TEXT_FIELDS = ['displayName', 'legalName', 'primaryEmail', 'primaryPhone', 'websiteUrl'] as const

/**
 * Xero's status carries only the archive state: `ARCHIVED` (and `GDPRREQUEST`) archives the Company;
 * `ACTIVE` sets `active` on create and afterwards only brings an archived Company back, so a
 * `pending` or `inactive` a CRM user set stays.
 */
export function resolveCompanyStatus(contactStatus: XeroContactStatus | null, current: CompanySnapshot | null): StatusTarget | null {
  if (contactStatus === 'ARCHIVED' || contactStatus === 'GDPRREQUEST') return { status: 'archived', isActive: false }
  if (!current) return { status: 'active', isActive: true }
  if (contactStatus === 'ACTIVE' && current.status === 'archived') return { status: 'active', isActive: true }
  return null
}

function customText(snapshot: CompanySnapshot, key: string): string | null {
  const value = snapshot.custom[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function buildCompanyCreateInput(company: MappedXeroCompany, marker: string): CompanyWriteInput {
  const status = resolveCompanyStatus(company.contactStatus, null)!
  const input: CompanyWriteInput = { displayName: company.displayName, legalName: company.legalName, ...status }
  for (const field of TEXT_FIELDS) {
    const value = company[field]
    if (value !== null) input[field] = value
  }
  input.customFields = { [XERO_CONTACT_MARKER_FIELD]: marker }
  if (company.taxNumber) input.customFields[XERO_TAX_NUMBER_FIELD] = company.taxNumber
  return input
}

/**
 * Compare-before-write (App Spec § 6.2 rule 3): the update input holds only the Xero-owned values
 * that differ from the Company; `null` when nothing differs, so no command runs. A blank or
 * left-out Xero value never clears an OM value. The tax number compares after normalization, and
 * the marker is written only while the Company has none.
 */
export function diffCompanyUpdate(company: MappedXeroCompany, marker: string, current: CompanySnapshot): CompanyWriteInput | null {
  const input: CompanyWriteInput = {}
  for (const field of TEXT_FIELDS) {
    const value = company[field]
    if (value !== null && value !== (current[field] ?? null)) input[field] = value
  }
  const status = resolveCompanyStatus(company.contactStatus, current)
  if (status && (status.status !== current.status || status.isActive !== current.isActive)) Object.assign(input, status)

  const customFields: Record<string, string> = {}
  if (!customText(current, XERO_CONTACT_MARKER_FIELD)) customFields[XERO_CONTACT_MARKER_FIELD] = marker
  const currentTaxNumber = customText(current, XERO_TAX_NUMBER_FIELD)
  if (company.taxNumber && normalizeTaxNumber(company.taxNumber) !== normalizeTaxNumber(currentTaxNumber)) {
    customFields[XERO_TAX_NUMBER_FIELD] = company.taxNumber
  }
  if (Object.keys(customFields).length > 0) input.customFields = customFields
  return Object.keys(input).length > 0 ? input : null
}
