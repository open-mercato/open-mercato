import type { PrivacyDataClassHandler, PrivacyRetentionInput } from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import { AccessLogService } from './services/accessLogService'

export const ACCESS_LOGS_DATA_CLASS_ID = 'audit_logs.access_logs'

registerPrivacyDataClass({
  id: ACCESS_LOGS_DATA_CLASS_ID,
  module: 'audit_logs',
  title: 'Access logs',
  description: 'Tenant-scoped records of data and API access.',
  handlerService: 'accessLogsPrivacyHandler',
  subjectKinds: [],
  retention: { actions: ['delete'], defaultDays: 90 },
  subjectActions: [],
})

export class AccessLogsPrivacyHandler implements PrivacyDataClassHandler {
  constructor(private readonly accessLogService: AccessLogService) {}

  async runRetention(input: PrivacyRetentionInput) {
    const result = await this.accessLogService.applyRetention({
      accessClass: 'all',
      batchSize: input.batchSize,
      dryRun: input.dryRun,
      organizationId: input.scope.organizationId,
      retentionDays: input.retentionDays,
      tenantId: input.scope.tenantId,
    })
    return {
      matched: result.matched,
      affected: result.deleted,
      hasMore: !input.dryRun && result.deleted >= result.batchSize,
    }
  }
}
