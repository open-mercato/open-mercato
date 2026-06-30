import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataQualityTarget } from '@open-mercato/shared/modules/data-quality'
import { evaluateExpression, type ConditionExpression } from '../../business_rules'
import type { ProgressService, ProgressServiceContext } from '../../progress/lib/progressService'
import { DataQualityCheck, DataQualityScanRun, DataQualitySuiteCheck } from '../data/entities'
import { generateFindingFingerprint } from './fingerprints'
import { resolvePassingFindings, upsertFinding } from './findings'
import { calculateScanScore } from './scoring'
import { loadTargetRegistry } from './targetRegistry'

const DEFAULT_BATCH_SIZE = 250
const MAX_BATCH_SIZE = 1000
const MIN_BATCH_SIZE = 50
const SOFT_DELETE_COLUMN = 'deleted_at'

export interface ScanRunnerContext {
  tenantId: string
  organizationId: string
  userId?: string | null
}

export interface ScanRunnerDeps {
  em: EntityManager
  progressService: ProgressService
}

function getBatchSize(): number {
  const envVal = process.env.DATA_QUALITY_SCAN_BATCH_SIZE
  if (!envVal) return DEFAULT_BATCH_SIZE

  const parsed = Number.parseInt(envVal, 10)
  if (Number.isNaN(parsed)) return DEFAULT_BATCH_SIZE

  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, parsed))
}

function getProgressContext(ctx: ScanRunnerContext): ProgressServiceContext {
  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  }
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function quoteIdentifier(identifier: string): string {
  return identifier
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.')
}

function splitQualifiedTableName(tableName: string): { schemaName: string | null; tableOnly: string } {
  const [schemaName, tableOnly] = tableName.includes('.')
    ? tableName.split('.', 2)
    : [null, tableName]

  return { schemaName, tableOnly }
}

async function tableHasColumn(em: EntityManager, tableName: string, columnName: string): Promise<boolean> {
  const { schemaName, tableOnly } = splitQualifiedTableName(tableName)

  const sql = schemaName
    ? `SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1`
    : `SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ? LIMIT 1`

  const params = schemaName
    ? [schemaName, tableOnly, columnName]
    : [tableOnly, columnName]

  const rows = await em.getConnection().execute<Array<{ '?column?': number }>>(sql, params)
  return rows.length > 0
}

function buildBaseFilters(
  scanRun: DataQualityScanRun,
  target: DataQualityTarget,
  ctx: ScanRunnerContext,
  includeSoftDeleteFilter: boolean,
): { clauses: string[]; params: Array<string> } {
  const clauses = [
    `${quoteIdentifier(target.scopeColumns.tenantId)} = ?`,
    `${quoteIdentifier(target.scopeColumns.organizationId)} = ?`,
  ]
  const params: string[] = [ctx.tenantId, ctx.organizationId]

  const criteria = scanRun.criteriaJson
  const ids = getStringArray(criteria?.ids)
  if (ids.length > 0) {
    clauses.push(`${quoteIdentifier(target.idColumn)} IN (${ids.map(() => '?').join(', ')})`)
    params.push(...ids)
  }

  if (includeSoftDeleteFilter) {
    clauses.push(`${quoteIdentifier(SOFT_DELETE_COLUMN)} IS NULL`)
  }

  return { clauses, params }
}

async function countTargetRecords(
  em: EntityManager,
  scanRun: DataQualityScanRun,
  target: DataQualityTarget,
  ctx: ScanRunnerContext,
  includeSoftDeleteFilter: boolean,
): Promise<number> {
  const tableExpression = quoteIdentifier(target.tableName)
  const { clauses, params } = buildBaseFilters(scanRun, target, ctx, includeSoftDeleteFilter)
  const sql = `SELECT COUNT(*) AS count FROM ${tableExpression} WHERE ${clauses.join(' AND ')}`
  const rows = await em.getConnection().execute<Array<{ count: number | string }>>(sql, params)
  return Number(rows[0]?.count ?? 0)
}

async function fetchTargetBatch(params: {
  em: EntityManager
  scanRun: DataQualityScanRun
  target: DataQualityTarget
  ctx: ScanRunnerContext
  includeSoftDeleteFilter: boolean
  batchSize: number
  lastId: string | null
}): Promise<Array<Record<string, unknown>>> {
  const { em, scanRun, target, ctx, includeSoftDeleteFilter, batchSize, lastId } = params
  const tableExpression = quoteIdentifier(target.tableName)
  const idExpression = quoteIdentifier(target.idColumn)
  const selectedColumns = Array.from(
    new Set([target.idColumn, ...Object.values(target.fieldMappings).map((mapping) => mapping.dbColumn)]),
  ).map((columnName) => quoteIdentifier(columnName))

  const { clauses, params: baseParams } = buildBaseFilters(scanRun, target, ctx, includeSoftDeleteFilter)
  const paramsForBatch = [...baseParams]
  if (lastId) {
    clauses.push(`${idExpression} > ?`)
    paramsForBatch.push(lastId)
  }

  paramsForBatch.push(String(batchSize))

  const sql = [
    `SELECT ${selectedColumns.join(', ')}`,
    `FROM ${tableExpression}`,
    `WHERE ${clauses.join(' AND ')}`,
    `ORDER BY ${idExpression} ASC`,
    'LIMIT ?',
  ].join(' ')

  return em.getConnection().execute<Array<Record<string, unknown>>>(sql, paramsForBatch)
}

/**
 * Execute a data quality scan run.
 * Pages through target records using keyset pagination by ID,
 * evaluates each check's failure expression, and upserts/resolves findings.
 */
export async function executeScanRun(
  scanRunId: string,
  deps: ScanRunnerDeps,
  ctx: ScanRunnerContext,
): Promise<void> {
  const { em, progressService } = deps
  const progressContext = getProgressContext(ctx)
  const batchSize = getBatchSize()

  const scanRun = await em.findOne(DataQualityScanRun, {
    id: scanRunId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
  if (!scanRun) {
    throw new Error(`Scan run ${scanRunId} not found`)
  }

  scanRun.status = 'running'
  scanRun.startedAt = new Date()
  await em.flush()

  if (scanRun.progressJobId) {
    await progressService.startJob(scanRun.progressJobId, progressContext)
  }

  try {
    const checks = await loadChecksForScan(em, scanRun, ctx)
    if (checks.length === 0) {
      await completeScan(scanRun, em, progressService, ctx)
      return
    }

    const targetEntityType = scanRun.targetEntityType ?? checks[0]?.targetEntityType
    if (!targetEntityType) {
      throw new Error(`Unable to determine target entity type for scan run ${scanRun.id}`)
    }

    const registry = loadTargetRegistry()
    const target = registry.targets.find((entry) => entry.entityId === targetEntityType)
    if (!target) {
      throw new Error(`Target entity type "${targetEntityType}" not found in data quality registry`)
    }

    if (!target.scopeColumns.tenantId || !target.scopeColumns.organizationId) {
      throw new Error(`Target "${targetEntityType}" missing required scope columns`)
    }

    await executeScanBatches(scanRun, checks, target, batchSize, deps, ctx)
    await completeScan(scanRun, em, progressService, ctx)
  } catch (error) {
    await failScan(scanRun, em, progressService, ctx, error)
    throw error
  }
}

async function loadChecksForScan(
  em: EntityManager,
  scanRun: DataQualityScanRun,
  ctx: ScanRunnerContext,
): Promise<DataQualityCheck[]> {
  const criteria = scanRun.criteriaJson
  const criteriaCheckIds = getStringArray(criteria?.checkIds)

  if (criteriaCheckIds.length > 0) {
    return em.find(DataQualityCheck, {
      id: { $in: criteriaCheckIds },
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      enabled: true,
      deletedAt: null,
    })
  }

  if (scanRun.suiteId) {
    const memberships = await em.find(
      DataQualitySuiteCheck,
      {
        suiteId: scanRun.suiteId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        enabled: true,
        deletedAt: null,
      },
      { orderBy: { sequence: 'ASC' } },
    )

    if (memberships.length === 0) return []

    const checkIds = memberships.map((membership) => membership.checkId)
    const checks = await em.find(DataQualityCheck, {
      id: { $in: checkIds },
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      enabled: true,
      deletedAt: null,
    })

    const checksById = new Map(checks.map((check) => [check.id, check]))
    return checkIds
      .map((checkId) => checksById.get(checkId))
      .filter((check): check is DataQualityCheck => check != null)
  }

  return []
}

async function executeScanBatches(
  scanRun: DataQualityScanRun,
  checks: DataQualityCheck[],
  target: DataQualityTarget,
  batchSize: number,
  deps: ScanRunnerDeps,
  ctx: ScanRunnerContext,
): Promise<void> {
  const { em, progressService } = deps
  const progressContext = getProgressContext(ctx)
  const includeSoftDeleteFilter = await tableHasColumn(em, target.tableName, SOFT_DELETE_COLUMN)

  const totalCount = await countTargetRecords(em, scanRun, target, ctx, includeSoftDeleteFilter)
  scanRun.totalCount = totalCount
  await em.flush()

  if (scanRun.progressJobId) {
    await progressService.updateProgress(scanRun.progressJobId, { totalCount }, progressContext)
  }

  if (totalCount === 0) return

  let lastId: string | null = null
  let scannedCount = 0
  let failedCount = 0
  let findingCount = 0

  while (true) {
    if (scanRun.progressJobId) {
      const cancelled = await progressService.isCancellationRequested(scanRun.progressJobId, ctx.tenantId)
      if (cancelled) {
        scanRun.status = 'cancelled'
        scanRun.finishedAt = new Date()
        scanRun.scannedCount = scannedCount
        scanRun.failedCount = failedCount
        scanRun.findingCount = findingCount
        await em.flush()
        await progressService.markCancelled(scanRun.progressJobId, progressContext)
        return
      }
    }

    const rows = await fetchTargetBatch({
      em,
      scanRun,
      target,
      ctx,
      includeSoftDeleteFilter,
      batchSize,
      lastId,
    })
    if (rows.length === 0) break

    for (const row of rows) {
      const recordId = String(row[target.idColumn])
      const recordData: Record<string, unknown> = {}
      for (const [fieldName, mapping] of Object.entries(target.fieldMappings)) {
        recordData[fieldName] = row[mapping.dbColumn] ?? null
      }

      let recordFailed = false

      for (const check of checks) {
        if (check.targetEntityType !== target.entityId) continue

        try {
          const expression = check.failureExpression as unknown as ConditionExpression | null
          if (!expression) continue

          const matches = evaluateExpression(expression, recordData, {
            tenant: { id: ctx.tenantId },
            organization: { id: ctx.organizationId },
          })

          const fingerprint = generateFindingFingerprint({
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            checkId: check.id,
            targetEntityType: target.entityId,
            targetRecordId: recordId,
          })

          if (matches) {
            const { created } = await upsertFinding(em, {
              checkId: check.id,
              scanRunId: scanRun.id,
              targetEntityType: target.entityId,
              targetRecordId: recordId,
              fingerprint,
              severity: check.severity,
              message: check.name,
              detailsJson: {
                fields: Object.keys(target.fieldMappings),
                checkCode: check.code,
              },
              tenantId: ctx.tenantId,
              organizationId: ctx.organizationId,
            })
            if (created) {
              findingCount += 1
            }
            recordFailed = true
          } else {
            await resolvePassingFindings(em, {
              checkId: check.id,
              targetRecordId: recordId,
              tenantId: ctx.tenantId,
              organizationId: ctx.organizationId,
            })
          }
        } catch {
          // Expression evaluation errors are isolated to the current check and record.
        }
      }

      if (recordFailed) {
        failedCount += 1
      }
      scannedCount += 1
    }

    scanRun.scannedCount = scannedCount
    scanRun.failedCount = failedCount
    scanRun.findingCount = findingCount
    await em.flush()

    if (scanRun.progressJobId) {
      await progressService.updateProgress(
        scanRun.progressJobId,
        {
          processedCount: scannedCount,
          progressPercent: Math.round((scannedCount / totalCount) * 100),
        },
        progressContext,
      )
    }

    lastId = String(rows[rows.length - 1]?.[target.idColumn])
  }
}

async function completeScan(
  scanRun: DataQualityScanRun,
  em: EntityManager,
  progressService: ProgressService,
  ctx: ScanRunnerContext,
): Promise<void> {
  scanRun.status = 'completed'
  scanRun.finishedAt = new Date()
  scanRun.score = calculateScanScore(scanRun.scannedCount, scanRun.failedCount)
  await em.flush()

  if (scanRun.progressJobId) {
    await progressService.completeJob(
      scanRun.progressJobId,
      {
        resultSummary: {
          scannedCount: scanRun.scannedCount,
          failedCount: scanRun.failedCount,
          findingCount: scanRun.findingCount,
          score: scanRun.score,
        },
      },
      getProgressContext(ctx),
    )
  }
}

async function failScan(
  scanRun: DataQualityScanRun,
  em: EntityManager,
  progressService: ProgressService,
  ctx: ScanRunnerContext,
  error: unknown,
): Promise<void> {
  scanRun.status = 'failed'
  scanRun.finishedAt = new Date()
  scanRun.errorMessage = error instanceof Error ? error.message : 'Scan failed'
  await em.flush()

  if (scanRun.progressJobId) {
    await progressService.failJob(
      scanRun.progressJobId,
      {
        errorMessage: scanRun.errorMessage ?? 'Scan failed',
      },
      getProgressContext(ctx),
    )
  }
}
