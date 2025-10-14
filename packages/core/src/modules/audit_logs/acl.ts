export const features = [
  'audit_logs.view_self',
  'audit_logs.view_tenant',
  'audit_logs.undo_self',
  'audit_logs.undo_tenant',
] as const

export type AuditLogFeature = (typeof features)[number]
