import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { WarrantyClaimType } from '../data/validators'

export type ClaimTypeUiConfig = {
  lineHeaderKey: string
  allowedDispositions: string[]
}

export const CLAIM_TYPE_UI_CONFIG: Record<WarrantyClaimType, ClaimTypeUiConfig> = {
  warranty: {
    lineHeaderKey: 'warranty_claims.form.lineHeader.warranty',
    allowedDispositions: ['repair', 'replace', 'credit', 'refund', 'return_to_vendor', 'scrap', 'field_destroy', 'restock', 'deny'],
  },
  return: {
    lineHeaderKey: 'warranty_claims.form.lineHeader.return',
    allowedDispositions: ['restock', 'refund', 'replace', 'credit', 'deny'],
  },
  core_return: {
    lineHeaderKey: 'warranty_claims.form.lineHeader.core_return',
    allowedDispositions: ['credit', 'refund', 'restock', 'return_to_vendor', 'scrap', 'deny'],
  },
  vendor_recovery: {
    lineHeaderKey: 'warranty_claims.form.lineHeader.vendor_recovery',
    allowedDispositions: ['return_to_vendor', 'credit', 'replace', 'deny'],
  },
}

export function resolveClaimTypeUiConfig(claimType: string | null | undefined): ClaimTypeUiConfig {
  return (CLAIM_TYPE_UI_CONFIG as Record<string, ClaimTypeUiConfig>)[claimType ?? 'warranty'] ?? CLAIM_TYPE_UI_CONFIG.warranty
}

// Restocking fees and core charge/credit only apply to return and core-return claims. Warranty
// and vendor-recovery claims settle on the credit amount alone, so these adjustment fields must
// neither be edited nor rolled into the header totals for those types (LINE-05).
const FINANCIAL_ADJUSTMENT_CLAIM_TYPES = new Set<WarrantyClaimType>(['return', 'core_return'])

export function claimTypeAllowsLineFinancialAdjustments(claimType: string | null | undefined): boolean {
  return FINANCIAL_ADJUSTMENT_CLAIM_TYPES.has((claimType ?? 'warranty') as WarrantyClaimType)
}

export function assertDispositionAllowedForType(
  claimType: string | null | undefined,
  disposition: string | null | undefined,
): void {
  if (!disposition) return
  if (!resolveClaimTypeUiConfig(claimType).allowedDispositions.includes(disposition)) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.dispositionTypeConflict' })
  }
}
