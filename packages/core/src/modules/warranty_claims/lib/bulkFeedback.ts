import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export function appendSkippedBulkCount(summary: string, skipped: number, t: TranslateFn): string {
  if (skipped <= 0) return summary
  return `${summary} ${t('warranty_claims.bulk.skipped', '{skipped} skipped.', { skipped })}`
}
