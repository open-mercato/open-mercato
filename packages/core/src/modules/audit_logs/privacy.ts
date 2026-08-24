import type {
  PrivacyDataClassHandler,
  PrivacyRetentionInput,
  PrivacySubjectInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass } from '@open-mercato/shared/lib/privacy'
import { AccessLogService } from './services/accessLogService'

export const ACCESS_LOGS_DATA_CLASS_ID = 'audit_logs.access_logs'

registerPrivacyDataClass({
  id: ACCESS_LOGS_DATA_CLASS_ID,
  module: 'audit_logs',
  title: 'Access logs',
  description: 'Tenant-scoped records of data and API access.',
  handlerService: 'accessLogsPrivacyHandler',
  subjectKinds: ['auth:user'],
  retention: { actions: ['delete'], defaultDays: 90 },
  subjectActions: ['discover', 'export'],
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

  async discoverSubject(input: PrivacySubjectInput) {
    if (input.subject.kind !== 'auth:user') return { found: false, recordCount: 0 }
    const result = await this.accessLogService.list({
      ...input.scope,
      actorUserId: input.subject.id,
      page: 1,
      pageSize: 1,
    })
    return { found: result.total > 0, recordCount: result.total }
  }

  async exportSubject(input: PrivacySubjectInput) {
    if (input.subject.kind !== 'auth:user') return { recordCount: 0, data: [] }
    const records: Array<Record<string, unknown>> = []
    let page = 1
    let totalPages = 1
    do {
      const result = await this.accessLogService.list({
        ...input.scope,
        actorUserId: input.subject.id,
        page,
        pageSize: 200,
      })
      records.push(...result.items.map((entry) => ({
        id: entry.id,
        actorUserId: entry.actorUserId,
        resourceKind: entry.resourceKind,
        resourceId: entry.resourceId,
        accessType: entry.accessType,
        fields: entry.fieldsJson ?? [],
        context: entry.contextJson ?? null,
        createdAt: entry.createdAt.toISOString(),
      })))
      totalPages = result.totalPages
      page += 1
    } while (page <= totalPages)
    return { recordCount: records.length, data: records }
  }
}
