import { hasFeature } from '@open-mercato/shared/security/features'

/**
 * The exact feature `POST /api/marketing_automation/consent/import` requires (see
 * `api/consent/import/route.ts`). Kept as one constant so the settings screen's import control can
 * never drift from what the endpoint it calls actually demands — a mismatch here either hides a
 * working option from somebody who has it, or shows one to somebody who will always get a 403.
 */
export const SUPPRESSION_IMPORT_FEATURE = 'marketing_automation.consent.manage'

export function canImportSuppressionList(grantedFeatures: readonly string[] | undefined): boolean {
  return hasFeature(grantedFeatures, SUPPRESSION_IMPORT_FEATURE)
}
