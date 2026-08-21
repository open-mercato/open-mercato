import type { PrivacyLegalHold, PrivacyOperation, PrivacyRetentionPolicy } from '../data/entities'

export function serializePolicy(policy: PrivacyRetentionPolicy) {
  return {
    id: policy.id,
    dataClassId: policy.dataClassId,
    retentionDays: policy.retentionDays,
    action: policy.action,
    batchSize: policy.batchSize,
    isActive: policy.isActive,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  }
}

export function serializeLegalHold(hold: PrivacyLegalHold) {
  return {
    id: hold.id,
    dataClassId: hold.dataClassId,
    subjectKind: hold.subjectKind,
    subjectId: hold.subjectId,
    reason: hold.reason,
    expiresAt: hold.expiresAt?.toISOString() ?? null,
    releasedAt: hold.releasedAt?.toISOString() ?? null,
    createdAt: hold.createdAt.toISOString(),
    updatedAt: hold.updatedAt.toISOString(),
  }
}

export function serializeOperation(operation: PrivacyOperation) {
  return {
    id: operation.id,
    type: operation.type,
    status: operation.status,
    dataClassId: operation.dataClassId,
    subjectKind: operation.subjectKind,
    subjectId: operation.subjectId,
    dryRun: operation.dryRun,
    report: operation.reportJson,
    requestedBy: operation.requestedBy,
    completedAt: operation.completedAt?.toISOString() ?? null,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
  }
}
