import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'backups',
  title: 'Backups',
  version: '0.1.0',
  description: 'Audited backup and restore tooling for instance operators.',
  author: 'Open Mercato Team',
  license: 'Proprietary',
  ejectable: true,
}

export {
  BackupService,
  BackupServiceError,
  listBackupManifests,
  readBackupManifest,
} from './lib/backupService'
export type {
  BackupManifest,
  BackupOperationResult,
  BackupServiceOptions,
  RestoreOperationResult,
} from './lib/contracts'
export {
  readAuditReceipt,
  verifyAuditReceipt,
} from './lib/auditReceipts'
