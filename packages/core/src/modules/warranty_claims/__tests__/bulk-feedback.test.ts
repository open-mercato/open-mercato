import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { appendSkippedBulkCount } from '../lib/bulkFeedback'

const t = ((key: string, fallbackOrParams?: string | Record<string, unknown>, params?: Record<string, unknown>) => {
  const values = typeof fallbackOrParams === 'object' ? fallbackOrParams : params
  if (key === 'warranty_claims.bulk.skipped') return `${values?.skipped} skipped.`
  return typeof fallbackOrParams === 'string' ? fallbackOrParams : key
}) as TranslateFn

describe('appendSkippedBulkCount', () => {
  test('shows the number of ineligible rows skipped by a bulk action', () => {
    expect(appendSkippedBulkCount('2 claims updated.', 3, t)).toBe('2 claims updated. 3 skipped.')
  })

  test('leaves the summary unchanged when no rows were skipped', () => {
    expect(appendSkippedBulkCount('2 claims updated.', 0, t)).toBe('2 claims updated.')
  })
})
