import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  AgentEvalAssertion,
  AgentEvalCase,
  type AgentEvalAssertionType,
  type AgentEvalCaseStatus,
  type AgentEvalSeverity,
} from '../data/entities'
import { canonicalInputKey, canonicalJson } from '../lib/eval/canonicalInputKey'
import {
  EVAL_SET_FILE_ISSUE,
  manifestFromFile,
  validateEvalSetFile,
  type EvalSetFile,
  type EvalSetFileAssertion,
  type EvalSetFileCase,
  type EvalSetFileIssue,
} from '../lib/eval/evalSetFile'
import { EVAL_SET_IMPORT_FEATURES, hasEvalSetFeatures } from '../lib/eval/evalSetAccess'
import { deterministicCaseId, EvalSetTooLargeError } from '../lib/eval/manifest'
import { getScorerDefinition } from '../lib/eval/registry'

export const IMPORT_EVAL_SET_COMMAND_ID = 'agent_orchestrator.evalSets.import'
export const EVAL_SET_RESOURCE_KIND = 'agent_orchestrator.eval_set'
export const EVAL_SET_FILE_INVALID = 'eval_set_file_invalid'
const EVAL_CASE_NAME_MAX_LENGTH = 200
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const importEvalSetCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  file: z.unknown(),
  approve: z.boolean().default(false),
})

export type ImportEvalSetCommandInput = z.input<typeof importEvalSetCommandSchema>

export type EvalSetImportChange = 'created' | 'updated' | 'unchanged'
export type EvalSetImportCounts = { cases: number; assertions: number }

type AssertionSnapshot = {
  id: string
  scorerKey: string
  title: string
  type: AgentEvalAssertionType
  severity: AgentEvalSeverity
  config: unknown
  version: number
  enabled: boolean
  deletedAt: string | null
}

type CaseSnapshot = {
  id: string
  name: string | null
  input: unknown
  expected: unknown
  assertions: unknown
  status: AgentEvalCaseStatus
  approvedByUserId: string | null
  inputKey: string | null
}

export type EvalSetImportUndoPayload = {
  tenantId: string
  organizationId: string
  agentId: string
  createdCaseIds: string[]
  createdAssertionIds: string[]
  updatedCases: CaseSnapshot[]
  updatedAssertions: AssertionSnapshot[]
}

export type ImportEvalSetCommandResult = {
  version: string
  agentId: string
  label: string | null
  created: EvalSetImportCounts
  updated: EvalSetImportCounts
  unchanged: EvalSetImportCounts
  cases: Array<{ key: string; id: string; status: AgentEvalCaseStatus; change: EvalSetImportChange }>
  assertions: Array<{ key: string; id: string; change: EvalSetImportChange }>
  undo: EvalSetImportUndoPayload
}

function invalidFile(issues: EvalSetFileIssue[]): CrudHttpError {
  return new CrudHttpError(422, { error: EVAL_SET_FILE_INVALID, code: EVAL_SET_FILE_INVALID, issues })
}

function storageIssues(file: EvalSetFile): EvalSetFileIssue[] {
  return file.cases.flatMap((entry, index) =>
    entry.name && entry.name.length > EVAL_CASE_NAME_MAX_LENGTH
      ? [
          {
            code: EVAL_SET_FILE_ISSUE.schema,
            path: `cases.${index}.name`,
            message: `an imported case name must be at most ${EVAL_CASE_NAME_MAX_LENGTH} characters`,
          },
        ]
      : [],
  )
}

/**
 * Validates an eval-set file for import: the file-format rules (schema, scorer
 * configs, judge-gate refusal, unique keys, size cap) plus the column limits of
 * the rows it becomes. Throws a 422 carrying field-level issues.
 */
export function parseEvalSetFileForImport(raw: unknown): { file: EvalSetFile; version: string } {
  const validation = validateEvalSetFile(raw)
  if (!validation.ok) throw invalidFile(validation.issues)
  const issues = storageIssues(validation.file)
  if (issues.length > 0) throw invalidFile(issues)
  try {
    return { file: validation.file, version: manifestFromFile(validation.file).version }
  } catch (error) {
    if (error instanceof EvalSetTooLargeError) {
      throw invalidFile([{ code: EVAL_SET_FILE_ISSUE.tooLarge, path: '', message: error.message }])
    }
    throw error
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null)
}

function assertionSnapshot(row: AgentEvalAssertion): AssertionSnapshot {
  return {
    id: row.id,
    scorerKey: row.scorerKey,
    title: row.title,
    type: row.type,
    severity: row.severity,
    config: row.config ?? null,
    version: row.version,
    enabled: row.enabled,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

function caseSnapshot(row: AgentEvalCase): CaseSnapshot {
  return {
    id: row.id,
    name: row.name ?? null,
    input: row.input ?? null,
    expected: row.expected ?? null,
    assertions: row.assertions ?? null,
    status: row.status,
    approvedByUserId: row.approvedByUserId ?? null,
    inputKey: row.inputKey ?? null,
  }
}

function assertionTarget(entry: EvalSetFileAssertion) {
  const type: AgentEvalAssertionType = getScorerDefinition(entry.scorerKey)?.kind ?? entry.type ?? 'deterministic'
  return {
    scorerKey: entry.scorerKey,
    title: entry.title,
    type,
    severity: entry.severity,
    config: entry.config ?? {},
  }
}

function assertionMatches(row: AgentEvalAssertion, target: ReturnType<typeof assertionTarget>): boolean {
  return (
    row.deletedAt == null &&
    row.enabled &&
    row.scorerKey === target.scorerKey &&
    row.title === target.title &&
    row.type === target.type &&
    row.severity === target.severity &&
    sameJson(row.config, target.config)
  )
}

function caseRefs(entry: EvalSetFileCase, assertionIdsByKey: ReadonlyMap<string, string>): unknown {
  if (entry.assertions === undefined || entry.assertions === null) return null
  return entry.assertions.map((ref) => {
    const stored: Record<string, unknown> = { assertionId: assertionIdsByKey.get(ref.key) }
    if (ref.configOverride) stored.configOverride = ref.configOverride
    if (ref.disabled === true) stored.disabled = true
    return stored
  })
}

function caseContentMatches(
  row: AgentEvalCase,
  target: { name: string | null; input: unknown; expected: unknown; assertions: unknown },
): boolean {
  return (
    (row.name ?? null) === target.name &&
    sameJson(row.input, target.input) &&
    sameJson(row.expected, target.expected) &&
    sameJson(row.assertions, target.assertions)
  )
}

function groupBy<Row, Key>(rows: ReadonlyArray<Row>, keyOf: (row: Row) => Key): Map<Key, Row> {
  const map = new Map<Key, Row>()
  for (const row of rows) if (!map.has(keyOf(row))) map.set(keyOf(row), row)
  return map
}

function assertScopeMatchesActor(ctx: CommandRuntimeContext, scope: { tenantId: string; organizationId: string }): void {
  const actorTenantId = ctx.auth?.tenantId ?? null
  if (actorTenantId !== null && actorTenantId !== scope.tenantId) {
    throw new CrudHttpError(403, { error: '[internal] eval set belongs to another tenant' })
  }
  const actorOrganizationIds = ctx.organizationIds ?? null
  if (actorOrganizationIds !== null && !actorOrganizationIds.includes(scope.organizationId)) {
    throw new CrudHttpError(403, { error: '[internal] eval set belongs to another organization' })
  }
}

/**
 * Materializes an eval-set file into rows so its cases become editable in the
 * UI. Assertions are upserted by (organization, appliesTo = agentId, key) — a
 * soft-deleted row with that key is revived, because the unique key spans
 * deleted rows. Cases are matched by `sourceType: 'file'` + `sourceId` = the
 * deterministic case id; a key that is the id of one of the agent's existing
 * cases (what `GET /eval-sets/current/export` emits) updates that case. A
 * re-import of the same file writes nothing. Cases are `draft` unless
 * `approve` is set; a content change demotes an approved case back to draft
 * unless the same import approves it. Undo soft-deletes what the import
 * created and restores what it overwrote.
 */
export const importEvalSetCommand: CommandHandler<ImportEvalSetCommandInput, ImportEvalSetCommandResult> = {
  id: IMPORT_EVAL_SET_COMMAND_ID,
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = importEvalSetCommandSchema.parse(rawInput)
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    assertScopeMatchesActor(ctx, scope)
    const { file, version } = parseEvalSetFileForImport(input.file)
    const agentId = file.agentId
    const approverId = input.approve ? (input.userId ?? null) : null
    if (input.approve && !approverId) {
      throw new CrudHttpError(400, { error: '[internal] approving imported cases requires a user' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const assertionRows = file.assertions.length
      ? await findWithDecryption(
          em,
          AgentEvalAssertion,
          { ...scope, appliesTo: agentId, key: { $in: file.assertions.map((entry) => entry.key) } },
          undefined,
          scope,
        )
      : []
    const assertionsByKey = groupBy(assertionRows, (row) => row.key)

    const sourceIds = file.cases.map((entry) => deterministicCaseId(agentId, entry.key))
    const uuidKeys = file.cases.map((entry) => entry.key).filter((key) => UUID_PATTERN.test(key))
    const fileCaseRows = sourceIds.length
      ? await findWithDecryption(
          em,
          AgentEvalCase,
          { ...scope, agentDefinitionId: agentId, sourceType: 'file', sourceId: { $in: sourceIds }, deletedAt: null },
          undefined,
          scope,
        )
      : []
    const keyedCaseRows = uuidKeys.length
      ? await findWithDecryption(
          em,
          AgentEvalCase,
          { ...scope, agentDefinitionId: agentId, id: { $in: uuidKeys.map((key) => key.toLowerCase()) }, deletedAt: null },
          undefined,
          scope,
        )
      : []
    const casesBySourceId = groupBy(fileCaseRows, (row) => row.sourceId)
    const casesById = groupBy(keyedCaseRows, (row) => row.id)

    const created: EvalSetImportCounts = { cases: 0, assertions: 0 }
    const updated: EvalSetImportCounts = { cases: 0, assertions: 0 }
    const unchanged: EvalSetImportCounts = { cases: 0, assertions: 0 }
    const undo: EvalSetImportUndoPayload = {
      ...scope,
      agentId,
      createdCaseIds: [],
      createdAssertionIds: [],
      updatedCases: [],
      updatedAssertions: [],
    }
    const assertionResults: ImportEvalSetCommandResult['assertions'] = []
    const caseResults: ImportEvalSetCommandResult['cases'] = []
    const assertionIdsByKey = new Map<string, string>()
    const writes: Array<() => void> = []

    for (const entry of file.assertions) {
      const target = assertionTarget(entry)
      const existing = assertionsByKey.get(entry.key)
      if (!existing) {
        const id = randomUUID()
        writes.push(() => {
          em.persist(
            em.create(AgentEvalAssertion, {
              id,
              ...scope,
              key: entry.key,
              appliesTo: agentId,
              ...target,
              enabled: true,
            }),
          )
        })
        undo.createdAssertionIds.push(id)
        assertionIdsByKey.set(entry.key, id)
        assertionResults.push({ key: entry.key, id, change: 'created' })
        created.assertions += 1
        continue
      }
      assertionIdsByKey.set(entry.key, existing.id)
      if (assertionMatches(existing, target)) {
        assertionResults.push({ key: entry.key, id: existing.id, change: 'unchanged' })
        unchanged.assertions += 1
        continue
      }
      undo.updatedAssertions.push(assertionSnapshot(existing))
      const contractChanged = existing.scorerKey !== target.scorerKey || !sameJson(existing.config, target.config)
      writes.push(() => {
        existing.scorerKey = target.scorerKey
        existing.title = target.title
        existing.type = target.type
        existing.severity = target.severity
        existing.config = target.config
        existing.enabled = true
        existing.deletedAt = null
        if (contractChanged) existing.version = (existing.version ?? 1) + 1
      })
      assertionResults.push({ key: entry.key, id: existing.id, change: 'updated' })
      updated.assertions += 1
    }

    const claimedCaseIds = new Set<string>()
    file.cases.forEach((entry, index) => {
      const sourceId = sourceIds[index]
      const target = {
        name: entry.name ?? null,
        input: entry.input,
        expected: entry.expected ?? null,
        assertions: caseRefs(entry, assertionIdsByKey),
      }
      const candidate = casesBySourceId.get(sourceId) ?? casesById.get(entry.key.toLowerCase()) ?? null
      const existing = candidate && !claimedCaseIds.has(candidate.id) ? candidate : null
      if (!existing) {
        const id = randomUUID()
        const status: AgentEvalCaseStatus = approverId ? 'approved' : 'draft'
        writes.push(() => {
          em.persist(
            em.create(AgentEvalCase, {
              id,
              ...scope,
              sourceType: 'file',
              sourceId,
              agentDefinitionId: agentId,
              name: target.name,
              input: target.input,
              inputKey: canonicalInputKey(target.input),
              expected: target.expected,
              assertions: target.assertions,
              status,
              approvedByUserId: approverId,
            }),
          )
        })
        undo.createdCaseIds.push(id)
        caseResults.push({ key: entry.key, id, status, change: 'created' })
        created.cases += 1
        return
      }
      claimedCaseIds.add(existing.id)
      const contentChanged = !caseContentMatches(existing, target)
      const approveNow = approverId !== null && (contentChanged || existing.status !== 'approved')
      const demote = contentChanged && !approverId && existing.status === 'approved'
      if (!contentChanged && !approveNow) {
        caseResults.push({ key: entry.key, id: existing.id, status: existing.status, change: 'unchanged' })
        unchanged.cases += 1
        return
      }
      undo.updatedCases.push(caseSnapshot(existing))
      const nextStatus: AgentEvalCaseStatus = approveNow ? 'approved' : demote ? 'draft' : existing.status
      writes.push(() => {
        if (contentChanged) {
          existing.name = target.name
          existing.input = target.input
          existing.expected = target.expected
          existing.assertions = target.assertions
        }
        existing.inputKey = canonicalInputKey(target.input)
        if (approveNow) {
          existing.status = 'approved'
          existing.approvedByUserId = approverId
        } else if (demote) {
          existing.status = 'draft'
          existing.approvedByUserId = null
        }
      })
      caseResults.push({ key: entry.key, id: existing.id, status: nextStatus, change: 'updated' })
      updated.cases += 1
    })

    if (writes.length > 0) {
      await withAtomicFlush(
        em,
        [
          () => {
            for (const write of writes) write()
          },
        ],
        { transaction: true, label: IMPORT_EVAL_SET_COMMAND_ID },
      )
    }

    return {
      version,
      agentId,
      label: file.label ?? null,
      created,
      updated,
      unchanged,
      cases: caseResults,
      assertions: assertionResults,
      undo,
    }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('agent_orchestrator.audit.evalSets.import', 'Import eval set'),
      resourceKind: EVAL_SET_RESOURCE_KIND,
      resourceId: result.agentId,
      tenantId: result.undo.tenantId,
      organizationId: result.undo.organizationId,
      snapshotAfter: {
        version: result.version,
        created: result.created,
        updated: result.updated,
        unchanged: result.unchanged,
      },
      context: ctx.auth?.sub ? { importedByUserId: ctx.auth.sub } : null,
      payload: { undo: result.undo },
    }
  },
  async authorizeReplay({ ctx, logEntry }) {
    const payload = extractUndoPayload<EvalSetImportUndoPayload>(logEntry)
    if (!payload?.tenantId || !payload.organizationId) {
      throw new CrudHttpError(400, { error: '[internal] eval set import undo payload is missing' })
    }
    assertScopeMatchesActor(ctx, payload)
    const allowed = await hasEvalSetFeatures(
      ctx.container,
      ctx.auth,
      { tenantId: payload.tenantId, organizationId: payload.organizationId },
      EVAL_SET_IMPORT_FEATURES,
    )
    if (!allowed) throw new CrudHttpError(403, { error: '[internal] missing agent_orchestrator.eval.manage' })
  },
  async undo({ ctx, logEntry }) {
    const payload = extractUndoPayload<EvalSetImportUndoPayload>(logEntry)
    if (!payload?.tenantId || !payload.organizationId) return
    const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
    assertScopeMatchesActor(ctx, scope)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const caseIds = [...payload.createdCaseIds, ...payload.updatedCases.map((entry) => entry.id)]
    const assertionIds = [...payload.createdAssertionIds, ...payload.updatedAssertions.map((entry) => entry.id)]
    const cases = caseIds.length
      ? await findWithDecryption(em, AgentEvalCase, { ...scope, id: { $in: caseIds } }, undefined, scope)
      : []
    const assertions = assertionIds.length
      ? await findWithDecryption(em, AgentEvalAssertion, { ...scope, id: { $in: assertionIds } }, undefined, scope)
      : []
    const casesById = groupBy(cases, (row) => row.id)
    const assertionsById = groupBy(assertions, (row) => row.id)
    const now = new Date()
    await withAtomicFlush(
      em,
      [
        () => {
          for (const id of payload.createdCaseIds) {
            const row = casesById.get(id)
            if (row && !row.deletedAt) row.deletedAt = now
          }
          for (const before of payload.updatedCases) {
            const row = casesById.get(before.id)
            if (!row) continue
            row.name = before.name
            row.input = before.input
            row.expected = before.expected
            row.assertions = before.assertions
            row.status = before.status
            row.approvedByUserId = before.approvedByUserId
            row.inputKey = before.inputKey
          }
          for (const id of payload.createdAssertionIds) {
            const row = assertionsById.get(id)
            if (row && !row.deletedAt) row.deletedAt = now
          }
          for (const before of payload.updatedAssertions) {
            const row = assertionsById.get(before.id)
            if (!row) continue
            row.scorerKey = before.scorerKey
            row.title = before.title
            row.type = before.type
            row.severity = before.severity
            row.config = before.config
            row.version = before.version
            row.enabled = before.enabled
            row.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
          }
        },
      ],
      { transaction: true, label: `${IMPORT_EVAL_SET_COMMAND_ID}.undo` },
    )
  },
}

registerCommand(importEvalSetCommand)
