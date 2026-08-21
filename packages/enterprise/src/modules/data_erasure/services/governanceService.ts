import type { EntityManager } from '@mikro-orm/postgresql'
import type { RequiredEntityData } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type {
  PrivacyDataClassDefinition,
  PrivacyDataClassHandler,
  PrivacyScope,
  PrivacySubjectExportResult,
} from '@open-mercato/shared/lib/privacy'
import { listPrivacyDataClasses } from '@open-mercato/shared/lib/privacy'
import { emitPrivacyEvent } from '@open-mercato/core/modules/audit_logs/events'
import {
  PrivacyOperation,
  type PrivacyOperationStatus,
  type PrivacyOperationType,
} from '../data/entities'
import type { RetentionRunInput, SubjectRequestInput } from '../data/validators'
import type { PrivacyPolicyService } from './policyService'
import type { PrivacyLegalHoldService } from './legalHoldService'
import { PrivacyServiceError } from './errors'

type ErasureManifestService = {
  append: (input: {
    requestId: string
    tenantId: string
    organizationId: string
    subjectKind: string
    subjectId: string
    executedAt: Date
  }) => Promise<void>
}

type GovernanceDependencies = {
  em: EntityManager
  privacyPolicyService: PrivacyPolicyService
  privacyLegalHoldService: PrivacyLegalHoldService
  resolveHandler: (key: string) => PrivacyDataClassHandler
  resolveManifest: () => ErasureManifestService | null
}

type SubjectClassResult = {
  dataClassId: string
  status: 'completed' | 'blocked' | 'failed'
  recordCount: number
  affected: number
  errorCode: string | null
}

export class PrivacyGovernanceService {
  constructor(private readonly dependencies: GovernanceDependencies) {}

  listDataClasses(): PrivacyDataClassDefinition[] {
    return listPrivacyDataClasses()
  }

  listOperations(
    scope: PrivacyScope,
    input: { page: number; pageSize: number; type?: PrivacyOperationType; status?: PrivacyOperationStatus },
  ): Promise<{ items: PrivacyOperation[]; total: number; page: number; pageSize: number }> {
    const where = {
      ...scope,
      ...(input.type ? { type: input.type } : {}),
      ...(input.status ? { status: input.status } : {}),
    }
    return this.dependencies.em.findAndCount(PrivacyOperation, where, {
      orderBy: { createdAt: 'desc' },
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }).then(([items, total]) => ({ items, total, page: input.page, pageSize: input.pageSize }))
  }

  async runRetention(
    scope: PrivacyScope,
    actorId: string,
    input: RetentionRunInput,
  ): Promise<PrivacyOperation> {
    const policy = await this.dependencies.privacyPolicyService.get(scope, input.policyId)
    if (!policy.isActive) throw new PrivacyServiceError('Retention policy is inactive.', 'POLICY_INACTIVE', 409)
    const definition = listPrivacyDataClasses().find((item) => item.id === policy.dataClassId)
    if (!definition?.retention) {
      throw new PrivacyServiceError('Data class does not support retention.', 'RETENTION_NOT_SUPPORTED', 400)
    }
    const operation = await this.createOperation(scope, actorId, {
      type: 'retention',
      dataClassId: definition.id,
      dryRun: input.dryRun,
    })
    const holds = await this.dependencies.privacyLegalHoldService.findActive(scope, { dataClassId: definition.id })
    const classHold = holds.find((hold) => !hold.subjectKind)
    if (classHold) {
      return this.completeOperation(operation, 'blocked', {
        matched: 0,
        affected: 0,
        batches: 0,
        continuationRequired: false,
        blockedByLegalHold: true,
      })
    }

    const handler = this.dependencies.resolveHandler(definition.handlerService)
    if (!handler.runRetention) {
      return this.completeOperation(operation, 'failed', {
        matched: 0,
        affected: 0,
        batches: 0,
        continuationRequired: false,
        errorCode: 'HANDLER_NOT_AVAILABLE',
      })
    }
    const excludedSubjects = holds
      .filter((hold) => Boolean(hold.subjectKind && hold.subjectId))
      .map((hold) => ({ kind: hold.subjectKind as string, id: hold.subjectId as string }))
    let matched = 0
    let affected = 0
    let batches = 0
    let hasMore = false
    try {
      do {
        const result = await handler.runRetention({
          scope,
          retentionDays: policy.retentionDays,
          action: policy.action,
          batchSize: policy.batchSize,
          dryRun: input.dryRun,
          excludedSubjects,
        })
        matched += result.matched
        affected += result.affected
        hasMore = result.hasMore
        batches += 1
      } while (!input.dryRun && hasMore && batches < input.maxBatches)
      return this.completeOperation(operation, hasMore ? 'partial' : 'completed', {
        matched,
        affected,
        batches,
        continuationRequired: hasMore,
        blockedByLegalHold: false,
      })
    } catch (error) {
      return this.completeOperation(operation, 'failed', {
        matched,
        affected,
        batches,
        continuationRequired: hasMore,
        errorCode: error instanceof PrivacyServiceError ? error.code : 'EXECUTION_FAILED',
      })
    }
  }

  async runSubjectRequest(
    scope: PrivacyScope,
    actorId: string,
    input: SubjectRequestInput,
    commandContext?: CommandRuntimeContext,
  ): Promise<{
    operation: PrivacyOperation
    exports?: Record<string, PrivacySubjectExportResult>
  }> {
    const definitions = this.resolveSubjectDefinitions(input)
    const operation = await this.createOperation(scope, actorId, {
      type: input.action,
      subjectKind: input.subject.kind,
      subjectId: input.subject.id,
      dryRun: input.dryRun,
    })
    const results: SubjectClassResult[] = []
    const exports: Record<string, PrivacySubjectExportResult> = {}

    for (const definition of definitions) {
      const mutation = input.action === 'erase' || input.action === 'anonymize'
      if (mutation) {
        const holds = await this.dependencies.privacyLegalHoldService.findActive(scope, {
          dataClassId: definition.id,
          subject: input.subject,
        })
        if (holds.length > 0) {
          results.push(this.subjectResult(definition.id, 'blocked', 0, 0, 'LEGAL_HOLD_ACTIVE'))
          continue
        }
      }
      const handler = this.dependencies.resolveHandler(definition.handlerService)
      try {
        if (input.action === 'discover' && handler.discoverSubject) {
          const result = await handler.discoverSubject({ scope, subject: input.subject, dryRun: true, actorId })
          results.push(this.subjectResult(definition.id, 'completed', result.recordCount, 0, null))
        } else if (input.action === 'export' && handler.exportSubject) {
          const result = await handler.exportSubject({ scope, subject: input.subject, dryRun: true, actorId })
          exports[definition.id] = result
          results.push(this.subjectResult(definition.id, 'completed', result.recordCount, 0, null))
        } else if (input.action === 'erase' && handler.eraseSubject) {
          const result = await handler.eraseSubject({
            scope,
            subject: input.subject,
            dryRun: input.dryRun,
            actorId,
            commandContext,
          })
          results.push(this.subjectResult(definition.id, 'completed', 0, result.affected, null))
        } else if (input.action === 'anonymize' && handler.anonymizeSubject) {
          const result = await handler.anonymizeSubject({
            scope,
            subject: input.subject,
            dryRun: input.dryRun,
            actorId,
            commandContext,
          })
          results.push(this.subjectResult(definition.id, 'completed', 0, result.affected, null))
        } else {
          results.push(this.subjectResult(definition.id, 'failed', 0, 0, 'HANDLER_NOT_AVAILABLE'))
        }
      } catch (error) {
        results.push(this.subjectResult(
          definition.id,
          'failed',
          0,
          0,
          error instanceof PrivacyServiceError ? error.code : 'EXECUTION_FAILED',
        ))
      }
    }

    let status = this.resolveSubjectStatus(results)
    const hasCompletedClass = results.some((result) => result.status === 'completed')
    const report: Record<string, unknown> = {
      classes: results,
      totals: {
        recordCount: results.reduce((sum, result) => sum + result.recordCount, 0),
        affected: results.reduce((sum, result) => sum + result.affected, 0),
      },
    }
    if (!input.dryRun && input.action === 'erase' && hasCompletedClass) {
      const manifest = this.dependencies.resolveManifest()
      if (manifest) {
        try {
          await manifest.append({
            requestId: operation.id,
            ...scope,
            subjectKind: input.subject.kind,
            subjectId: input.subject.id,
            executedAt: new Date(),
          })
          report.manifestStatus = 'completed'
        } catch {
          report.manifestStatus = 'failed'
          if (status === 'completed') status = 'partial'
        }
      } else {
        report.manifestStatus = 'skipped'
      }
    }
    const completed = await this.completeOperation(operation, status, report)
    if (!input.dryRun && input.action === 'erase' && hasCompletedClass) {
      await emitPrivacyEvent('privacy.subject.erased', {
        operationId: completed.id,
        subjectKind: input.subject.kind,
        subjectId: input.subject.id,
        ...scope,
      })
    }
    if (!input.dryRun && input.action === 'anonymize' && hasCompletedClass) {
      await emitPrivacyEvent('privacy.subject.anonymized', {
        operationId: completed.id,
        subjectKind: input.subject.kind,
        subjectId: input.subject.id,
        ...scope,
      })
    }
    return { operation: completed, ...(input.action === 'export' ? { exports } : {}) }
  }

  private resolveSubjectDefinitions(input: SubjectRequestInput): PrivacyDataClassDefinition[] {
    const requested = input.dataClassIds ? new Set(input.dataClassIds) : null
    if (requested) {
      for (const id of requested) {
        if (!listPrivacyDataClasses().some((definition) => definition.id === id)) {
          throw new PrivacyServiceError('Data class not found.', 'DATA_CLASS_NOT_FOUND', 400)
        }
      }
    }
    const definitions = listPrivacyDataClasses().filter((definition) => (
      (!requested || requested.has(definition.id))
      && definition.subjectKinds.includes(input.subject.kind)
      && definition.subjectActions.includes(input.action)
    ))
    if (definitions.length === 0) {
      throw new PrivacyServiceError('No data class supports this subject action.', 'SUBJECT_ACTION_NOT_SUPPORTED', 400)
    }
    return definitions
  }

  private async createOperation(
    scope: PrivacyScope,
    actorId: string,
    input: Pick<PrivacyOperation, 'type' | 'dryRun'> & Partial<Pick<PrivacyOperation, 'dataClassId' | 'subjectKind' | 'subjectId'>>,
  ): Promise<PrivacyOperation> {
    const operation = this.dependencies.em.create(PrivacyOperation, {
      ...scope,
      type: input.type,
      status: 'running',
      dataClassId: input.dataClassId ?? null,
      subjectKind: input.subjectKind ?? null,
      subjectId: input.subjectId ?? null,
      dryRun: input.dryRun,
      requestedBy: actorId,
    } as RequiredEntityData<PrivacyOperation>)
    await this.dependencies.em.persist(operation).flush()
    return operation
  }

  private async completeOperation(
    operation: PrivacyOperation,
    status: PrivacyOperationStatus,
    report: Record<string, unknown>,
  ): Promise<PrivacyOperation> {
    operation.status = status
    operation.reportJson = report
    operation.completedAt = new Date()
    await this.dependencies.em.flush()
    return operation
  }

  private subjectResult(
    dataClassId: string,
    status: SubjectClassResult['status'],
    recordCount: number,
    affected: number,
    errorCode: string | null,
  ): SubjectClassResult {
    return { dataClassId, status, recordCount, affected, errorCode }
  }

  private resolveSubjectStatus(results: SubjectClassResult[]): PrivacyOperationStatus {
    if (results.every((result) => result.status === 'completed')) return 'completed'
    if (results.every((result) => result.status === 'blocked')) return 'blocked'
    if (results.every((result) => result.status === 'failed')) return 'failed'
    return 'partial'
  }
}
