import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { DataQualityFinding } from '../data/entities'
import type { DataQualityFindingStatus, DataQualitySeverity } from '../data/entities'

export interface UpsertFindingInput {
  checkId: string
  scanRunId: string
  targetEntityType: string
  targetRecordId: string
  fingerprint: string
  severity: string
  message: string
  detailsJson?: Record<string, unknown> | null
  tenantId: string
  organizationId: string
}

/**
 * Upsert a finding by fingerprint. If one already exists with matching
 * fingerprint, update lastSeenAt and scanRunId. If new, create it as open.
 * Returns { created: boolean, finding }.
 */
export async function upsertFinding(
  em: EntityManager,
  input: UpsertFindingInput,
): Promise<{ created: boolean; finding: DataQualityFinding }> {
  const existing = await em.findOne(DataQualityFinding, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    fingerprint: input.fingerprint,
    deletedAt: null,
  } as FilterQuery<DataQualityFinding>)

  if (existing) {
    existing.lastSeenAt = new Date()
    existing.scanRunId = input.scanRunId

    if (existing.status === 'resolved') {
      existing.status = 'open'
      existing.resolvedAt = null
      existing.resolvedBy = null
    }

    em.persist(existing)
    return { created: false, finding: existing }
  }

  const now = new Date()
  const finding = new DataQualityFinding()
  finding.checkId = input.checkId
  finding.scanRunId = input.scanRunId
  finding.targetEntityType = input.targetEntityType
  finding.targetRecordId = input.targetRecordId
  finding.fingerprint = input.fingerprint
  finding.status = 'open' as DataQualityFindingStatus
  finding.severity = input.severity as DataQualitySeverity
  finding.message = input.message
  finding.detailsJson = input.detailsJson ?? null
  finding.firstSeenAt = now
  finding.lastSeenAt = now
  finding.tenantId = input.tenantId
  finding.organizationId = input.organizationId

  em.persist(finding)
  return { created: true, finding }
}

/**
 * Resolve findings for a check+record that are currently open,
 * meaning the record now passes the check.
 */
export async function resolvePassingFindings(
  em: EntityManager,
  params: {
    checkId: string
    targetRecordId: string
    tenantId: string
    organizationId: string
  },
): Promise<number> {
  const findings = await em.find(DataQualityFinding, {
    checkId: params.checkId,
    targetRecordId: params.targetRecordId,
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    status: 'open',
    deletedAt: null,
  } as FilterQuery<DataQualityFinding>)

  const now = new Date()
  for (const finding of findings) {
    finding.status = 'resolved'
    finding.resolvedAt = now
  }

  if (findings.length > 0) {
    em.persist(findings)
  }

  return findings.length
}
