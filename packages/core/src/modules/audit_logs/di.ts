import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'
import { AuditEvidenceExportService } from '@open-mercato/core/modules/audit_logs/services/evidenceExportService'
import { AccessLogsPrivacyHandler } from './privacy'

export function register(container: AppContainer) {
  container.register({
    actionLogService: asClass(ActionLogService).scoped(),
  })

  container.register({
    accessLogService: asClass(AccessLogService).scoped(),
  })

  container.register({
    auditEvidenceExportService: asClass(AuditEvidenceExportService).scoped(),
    accessLogsPrivacyHandler: asClass(AccessLogsPrivacyHandler).scoped(),
  })
}
