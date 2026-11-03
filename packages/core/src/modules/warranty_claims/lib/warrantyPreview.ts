export type WarrantyEntitlementPreview = 'in_warranty' | 'out_of_warranty' | 'unknown'

export function addWarrantyMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const copy = new Date(date.getTime())
  copy.setUTCDate(1)
  copy.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay))
  return copy
}

export function computeWarrantyEntitlementPreview(
  purchaseDate: Date | null,
  warrantyMonths: number | null,
  at: Date = new Date(),
): WarrantyEntitlementPreview {
  if (!purchaseDate || Number.isNaN(purchaseDate.getTime())) return 'unknown'
  if (warrantyMonths === null || !Number.isFinite(warrantyMonths)) return 'unknown'
  return addWarrantyMonths(purchaseDate, warrantyMonths).getTime() >= at.getTime() ? 'in_warranty' : 'out_of_warranty'
}
