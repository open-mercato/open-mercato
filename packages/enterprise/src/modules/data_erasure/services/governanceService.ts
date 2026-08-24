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
import type {
  EnvironmentSanitizationInput,
  RetentionRunInput,
  SubjectRequestInput,
  SubjectResolutionInput,
} from '../data/validators'
import type { PrivacyPolicyService } from './policyService'
import type { PrivacyLegalHoldService } from './legalHoldService'
import { PrivacyServiceError } from './errors'
import { requireNonProductionEnvironment } from './environmentClassification'

type ErasureManifestService = {
  append: (input: {
    requestId: string
    tenantId: string
    organizationId: string
    subjectKind: string
    subjectId: string
    dataClassIds?: string[]
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

type SanitizationClassResult = {
  dataClassId: string
  status: 'completed' | 'failed'
  matched: number
  affected: number
  verificationPassed: boolean
  findings: Array<{ code: string; count: number }>
  errorCode: string | null
}

type SubjectResolutionClassResult = {
  dataClassId: string
  status: 'completed' | 'failed'
  subjectCount: number
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
    commandContext?: CommandRuntimeContext,
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
          actorId,
          commandContext,
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

  async resolveSubjects(
    scope: PrivacyScope,
    actorId: string,
    input: SubjectResolutionInput,
  ): Promise<{
    operation: PrivacyOperation
    subjects: Record<string, Array<{ kind: string; id: string }>>
  }> {
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
      && definition.subjectIdentifierKinds?.includes(input.identifier.kind)
    ))
    if (definitions.length === 0) {
      throw new PrivacyServiceError('No data class supports this identifier.', 'SUBJECT_IDENTIFIER_NOT_SUPPORTED', 400)
    }

    const operation = await this.createOperation(scope, actorId, {
      type: 'discover',
      dryRun: true,
    })
    const results: SubjectResolutionClassResult[] = []
    const subjects: Record<string, Array<{ kind: string; id: string }>> = {}
    for (const definition of definitions) {
      const handler = this.dependencies.resolveHandler(definition.handlerService)
      if (!handler.resolveSubjects) {
        results.push({
          dataClassId: definition.id,
          status: 'failed',
          subjectCount: 0,
          errorCode: 'HANDLER_NOT_AVAILABLE',
        })
        continue
      }
      try {
        const resolved = await handler.resolveSubjects({
          scope,
          identifier: input.identifier,
          actorId,
        })
        const allowedKinds = new Set(definition.subjectKinds)
        const unique = new Map<string, { kind: string; id: string }>()
        for (const subject of resolved.subjects) {
          if (!allowedKinds.has(subject.kind) || !subject.id.trim()) continue
          unique.set(`${subject.kind}:${subject.id}`, subject)
        }
        const classSubjects = Array.from(unique.values())
        subjects[definition.id] = classSubjects
        results.push({
          dataClassId: definition.id,
          status: 'completed',
          subjectCount: classSubjects.length,
          errorCode: null,
        })
      } catch {
        results.push({
          dataClassId: definition.id,
          status: 'failed',
          subjectCount: 0,
          errorCode: 'EXECUTION_FAILED',
        })
      }
    }

    const failed = results.filter((result) => result.status === 'failed').length
    const status: PrivacyOperationStatus = failed === 0
      ? 'completed'
      : failed === results.length
        ? 'failed'
        : 'partial'
    const completed = await this.completeOperation(operation, status, {
      identifierKind: input.identifier.kind,
      classes: results,
      totals: {
        classes: results.length,
        failed,
        subjects: results.reduce((sum, result) => sum + result.subjectCount, 0),
      },
    })
    return { operation: completed, subjects }
  }

  async runEnvironmentSanitization(
    scope: PrivacyScope,
    actorId: string,
    input: EnvironmentSanitizationInput,
  ): Promise<PrivacyOperation> {
    if (!input.dryRun && input.confirmation !== 'SANITIZE_NON_PRODUCTION') {
      throw new PrivacyServiceError(
        'Apply mode requires explicit SANITIZE_NON_PRODUCTION confirmation.',
        'SANITIZATION_CONFIRMATION_REQUIRED',
        400,
      )
    }
    const environmentClassification = requireNonProductionEnvironment()
    const definitions = listPrivacyDataClasses().filter((definition) => (
      definition.environmentSanitization !== undefined
    ))
    if (definitions.length === 0) {
      throw new PrivacyServiceError(
        'No environment sanitization handlers are registered.',
        'SANITIZATION_HANDLERS_NOT_AVAILABLE',
        409,
      )
    }
    const operation = await this.createOperation(scope, actorId, {
      type: 'sanitization',
      dryRun: input.dryRun,
    })
    const results: SanitizationClassResult[] = []

    for (const definition of definitions) {
      const handler = this.dependencies.resolveHandler(definition.handlerService)
      if (!handler.sanitizeEnvironment || !handler.verifyEnvironmentSanitization) {
        results.push({
          dataClassId: definition.id,
          status: 'failed',
          matched: 0,
          affected: 0,
          verificationPassed: false,
          findings: [],
          errorCode: 'HANDLER_NOT_AVAILABLE',
        })
        continue
      }
      try {
        const sanitization = await handler.sanitizeEnvironment({
          scope,
          dryRun: input.dryRun,
          actorId,
          profile: input.profile,
        })
        const verification = await handler.verifyEnvironmentSanitization({
          scope,
          dryRun: input.dryRun,
          actorId,
          profile: input.profile,
        })
        const failed = !input.dryRun && !verification.passed
        results.push({
          dataClassId: definition.id,
          status: failed ? 'failed' : 'completed',
          matched: sanitization.matched,
          affected: sanitization.affected,
          verificationPassed: verification.passed,
          findings: verification.findings,
          errorCode: failed ? 'VERIFICATION_FAILED' : null,
        })
      } catch (error) {
        results.push({
          dataClassId: definition.id,
          status: 'failed',
          matched: 0,
          affected: 0,
          verificationPassed: false,
          findings: [],
          errorCode: error instanceof PrivacyServiceError ? error.code : 'EXECUTION_FAILED',
        })
      }
    }

    const failed = results.filter((result) => result.status === 'failed').length
    const status: PrivacyOperationStatus = failed === 0
      ? 'completed'
      : failed === results.length
        ? 'failed'
        : 'partial'
    return this.completeOperation(operation, status, {
      profile: input.profile,
      environmentClassification,
      classes: results,
      totals: {
        classes: results.length,
        failed,
        matched: results.reduce((sum, result) => sum + result.matched, 0),
        affected: results.reduce((sum, result) => sum + result.affected, 0),
        findings: results.reduce((sum, result) => (
          sum + result.findings.reduce((classSum, finding) => classSum + finding.count, 0)
        ), 0),
      },
    })
  }

  async runSubjectRequest(
    scope: PrivacyScope,
    actorId: string,
    input: SubjectRequestInput,
    commandContext?: CommandRuntimeContext,
    options?: { skipManifest?: boolean },
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
    if (!input.dryRun && input.action === 'erase' && hasCompletedClass && !options?.skipManifest) {
      const manifest = this.dependencies.resolveManifest()
      if (manifest) {
        try {
          await manifest.append({
            requestId: operation.id,
            ...scope,
            subjectKind: input.subject.kind,
            subjectId: input.subject.id,
            dataClassIds: results
              .filter((result) => result.status === 'completed')
              .map((result) => result.dataClassId),
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
