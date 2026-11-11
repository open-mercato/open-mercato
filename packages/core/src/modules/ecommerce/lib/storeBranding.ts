import { ecommerceStoreBrandingSchema, type EcommerceStoreBranding } from '../data/validators'
import type { Translate } from './crudSupport'

export const STORE_BRANDING_UPDATE_COMMAND_ID = 'ecommerce.stores.branding.update'
export const STORE_BRANDING_RESOURCE_KIND = 'ecommerce.store'

export type BrandingFieldErrors = Record<string, string>

const I18N_KEY_PATTERN = /^ecommerce\.[A-Za-z0-9_.]+$/

export function compactBranding(branding: EcommerceStoreBranding): EcommerceStoreBranding {
  const entries = Object.entries(branding).filter(([, value]) => value !== undefined && value !== null && value !== '')
  return Object.fromEntries(entries) as EcommerceStoreBranding
}

export function mergeBrandingIntoSettings<TSettings extends object>(
  settings: TSettings | null | undefined,
  branding: EcommerceStoreBranding,
): TSettings & { branding: EcommerceStoreBranding } {
  return { ...(settings ?? ({} as TSettings)), branding: compactBranding(branding) }
}

function readIssueMessage(message: string, translate: Translate): string {
  return I18N_KEY_PATTERN.test(message) ? translate(message, message) : message
}

export type BrandingParseResult =
  | { ok: true; branding: EcommerceStoreBranding }
  | { ok: false; fieldErrors: BrandingFieldErrors }

export function parseBrandingInput(input: unknown, translate: Translate): BrandingParseResult {
  const result = ecommerceStoreBrandingSchema.safeParse(input)
  if (result.success) return { ok: true, branding: compactBranding(result.data) }
  const fieldErrors: BrandingFieldErrors = {}
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        fieldErrors[key] = translate('ecommerce.validation.brandingFieldUnknown', 'This branding setting does not exist.')
      }
      continue
    }
    const field = issue.path.length ? issue.path.map(String).join('.') : 'branding'
    if (fieldErrors[field] === undefined) {
      fieldErrors[field] = readIssueMessage(issue.message, translate)
    }
  }
  return { ok: false, fieldErrors }
}
