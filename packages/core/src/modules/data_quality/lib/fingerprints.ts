import { createHash } from 'crypto'

/**
 * Generate a stable fingerprint for a finding.
 * Fingerprint is scoped by tenant + org + check + target record.
 * This ensures idempotent upsert on repeated scans.
 */
export function generateFindingFingerprint(params: {
  tenantId: string
  organizationId: string
  checkId: string
  targetEntityType: string
  targetRecordId: string
}): string {
  const input = [
    params.tenantId,
    params.organizationId,
    params.checkId,
    params.targetEntityType,
    params.targetRecordId,
  ].join('::')

  return createHash('sha256').update(input).digest('hex').substring(0, 64)
}
