/**
 * Cache key builders for data_quality module.
 * All keys include tenant and organization scope.
 */

export function summaryKey(tenantId: string, organizationId: string, targetEntityType?: string): string {
  const target = targetEntityType ?? 'all'
  return `data_quality:${tenantId}:${organizationId}:summary:${target}`
}

export function scanDetailKey(scanRunId: string): string {
  return `data_quality:scan:${scanRunId}`
}

export function summaryTags(tenantId: string, organizationId: string): string[] {
  return [
    `tenant:${tenantId}`,
    `org:${organizationId}`,
    'data_quality',
    'data_quality:summary',
  ]
}

export function findingsTags(tenantId: string, organizationId: string): string[] {
  return [
    `tenant:${tenantId}`,
    `org:${organizationId}`,
    'data_quality',
    'data_quality:findings',
  ]
}

export function scanTags(tenantId: string, organizationId: string, scanRunId: string): string[] {
  return [
    `tenant:${tenantId}`,
    `org:${organizationId}`,
    'data_quality',
    `data_quality:scan:${scanRunId}`,
  ]
}
