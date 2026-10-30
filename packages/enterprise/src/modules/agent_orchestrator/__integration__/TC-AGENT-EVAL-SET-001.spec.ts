import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAgentEvalCasesByIds } from './helpers/agentPerfFixtures'
import { createScopedAgentUser, deleteScopedAgentUser, type ScopedAgentUser } from './helpers/agentAccessFixtures'
import {
  createApprovedEvalCase,
  deleteEvalSetRowsForAgent,
  deleteEvalSuiteRunsByIds,
  firstRegisteredAgentId,
  loginAs,
} from './helpers/evalReportFixtures'

/**
 * TC-AGENT-EVAL-SET-001: eval-set import, export and eval-run settings.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-10-21-eval-reports-and-reproducible-regression.md
 * (API Contracts → POST /eval-sets/import, GET /eval-sets/:version/export, Integration coverage).
 *
 * Every import targets a throwaway agent id unique to the test, so the file
 * cases and agent-scoped assertions it writes never mix with other specs' rows
 * and cleanup removes them by agent id. The eval-run settings case needs a
 * registered agent; its run completes without a model (cases end errored), so
 * nothing here depends on a configured LLM provider.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'
const IMPORT_PATH = '/api/agent_orchestrator/eval-sets/import'
const EVAL_SET_FORMAT = 'open-mercato.agent-eval-set'
const EVAL_SET_FILE_INVALID = 'eval_set_file_invalid'
const DOWNGRADED_HEADER = 'x-om-eval-set-downgraded'
const DEFAULT_EVAL_SET_MAX_BYTES = 5242880
const BUILTIN_RUBRIC_KEYS = ['appropriate_abstention', 'groundedness', 'rationale_quality']

type ImportCounts = { cases?: number; assertions?: number }
type ImportResponse = {
  version?: string
  agentId?: string
  created?: ImportCounts
  updated?: ImportCounts
  unchanged?: ImportCounts
  cases?: Array<{ key?: string; id?: string; status?: string; change?: string }>
  assertions?: Array<{ key?: string; id?: string; change?: string }>
}
type InvalidFileResponse = { code?: string; issues?: Array<{ code?: string; path?: string }> }
type EvalCaseListResponse = { items?: Array<Record<string, unknown>> }
type ExportedFile = {
  format?: string
  agentId?: string
  assertions?: Array<{ key?: string; severity?: string; scorerKey?: string }>
  cases?: Array<{ key?: string }>
}
type AuditActionsResponse = { items?: Array<{ commandId?: string; undoToken?: string | null }> }

function uniqueAgentId(label: string): string {
  return `qa_eval_set_001_${label}_${Date.now()}_${randomInt(1_000_000)}`
}

function deterministicAssertion(key: string) {
  return {
    key,
    scorerKey: 'json_path_compare',
    severity: 'warn',
    title: `QA ${key}`,
    config: { path: '$.ok', operator: 'eq', value: 'true' },
  }
}

function evalSetFile(agentId: string, caseKeys: string[]) {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: 1,
    agentId,
    label: 'qa-eval-set-001',
    assertions: [deterministicAssertion('ok_path')],
    cases: caseKeys.map((key) => ({
      key,
      name: `QA ${key}`,
      input: { question: `${key} input` },
      assertions: [{ key: 'ok_path' }],
    })),
  }
}

function yamlEvalSet(agentId: string, caseKey: string): string {
  return [
    `format: ${EVAL_SET_FORMAT}`,
    'formatVersion: 1',
    `agentId: ${agentId}`,
    'label: qa-eval-set-001',
    'assertions:',
    '  - key: ok_path',
    '    scorerKey: json_path_compare',
    '    severity: warn',
    '    title: QA ok_path',
    '    config:',
    '      path: $.ok',
    '      operator: eq',
    "      value: 'true'",
    'cases:',
    `  - key: ${caseKey}`,
    `    name: QA ${caseKey}`,
    '    input:',
    `      question: ${caseKey} input`,
    '    assertions:',
    '      - key: ok_path',
    '',
  ].join('\n')
}

function exportPath(version: string, agentId: string, format: 'json' | 'yaml'): string {
  const query = new URLSearchParams({ agentDefinitionId: agentId, format }).toString()
  return `/api/agent_orchestrator/eval-sets/${encodeURIComponent(version)}/export?${query}`
}

async function importEvalSet(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<ImportResponse> {
  const response = await apiRequest(request, 'POST', IMPORT_PATH, { token, data })
  expect(response.status(), await response.text()).toBe(200)
  return (await readJsonSafe<ImportResponse>(response)) ?? {}
}

async function expectInvalidFile(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
  expectedCodes: string[],
): Promise<void> {
  const response = await apiRequest(request, 'POST', IMPORT_PATH, { token, data })
  expect(response.status(), await response.text()).toBe(422)
  const body = (await readJsonSafe<InvalidFileResponse>(response)) ?? {}
  expect(body.code).toBe(EVAL_SET_FILE_INVALID)
  const codes = (body.issues ?? []).map((issue) => issue.code)
  for (const code of expectedCodes) expect(codes, `issues must include ${code}`).toContain(code)
}

async function listFileCases(
  request: APIRequestContext,
  token: string,
  agentId: string,
): Promise<Array<Record<string, unknown>>> {
  const query = new URLSearchParams({ agentDefinitionId: agentId, sourceType: 'file', pageSize: '100' }).toString()
  const response = await apiRequest(request, 'GET', `/api/agent_orchestrator/eval-cases?${query}`, { token })
  expect(response.status(), await response.text()).toBe(200)
  return (await readJsonSafe<EvalCaseListResponse>(response))?.items ?? []
}

function caseSourceType(row: Record<string, unknown>): unknown {
  return row.source_type ?? row.sourceType
}

function expectNoChanges(result: ImportResponse, cases: number, assertions: number): void {
  expect(result.created).toEqual({ cases: 0, assertions: 0 })
  expect(result.updated).toEqual({ cases: 0, assertions: 0 })
  expect(result.unchanged).toEqual({ cases, assertions })
}

test.describe('TC-AGENT-EVAL-SET-001: eval-set import, export and eval-run settings', () => {
  test('JSON and YAML imports create file cases; a re-import changes nothing; undo removes the imported case', async ({
    request,
  }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const agentId = uniqueAgentId('import')

    try {
      const file = evalSetFile(agentId, ['case-a', 'case-b'])
      const imported = await importEvalSet(request, token, { file, approve: true })
      expect(imported.agentId).toBe(agentId)
      expect(imported.version?.startsWith('sha256:')).toBe(true)
      expect(imported.created).toEqual({ cases: 2, assertions: 1 })
      expect(imported.updated).toEqual({ cases: 0, assertions: 0 })
      expect((imported.cases ?? []).map((entry) => entry.status)).toEqual(['approved', 'approved'])

      const listed = await listFileCases(request, token, agentId)
      expect(listed).toHaveLength(2)
      for (const row of listed) expect(caseSourceType(row)).toBe('file')
      const importedIds = (imported.cases ?? []).map((entry) => entry.id).sort()
      expect(listed.map((row) => String(row.id)).sort()).toEqual(importedIds)

      const reimported = await importEvalSet(request, token, { file, approve: true })
      expectNoChanges(reimported, 2, 1)
      expect(reimported.version).toBe(imported.version)

      const yamlImport = await importEvalSet(request, token, { text: yamlEvalSet(agentId, 'case-c'), format: 'yaml' })
      expect(yamlImport.created).toEqual({ cases: 1, assertions: 0 })
      expect(yamlImport.unchanged).toEqual({ cases: 0, assertions: 1 })
      const yamlCase = yamlImport.cases?.[0]
      expect(yamlCase?.status, 'an import without approve writes drafts').toBe('draft')
      expect(await listFileCases(request, token, agentId)).toHaveLength(3)

      const actionsQuery = new URLSearchParams({
        resourceKind: 'agent_orchestrator.eval_set',
        resourceId: agentId,
        undoableOnly: 'true',
      }).toString()
      const actionsRes = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${actionsQuery}`, { token })
      expect(actionsRes.status(), await actionsRes.text()).toBe(200)
      const undoTokens = ((await readJsonSafe<AuditActionsResponse>(actionsRes))?.items ?? [])
        .filter((entry) => entry.commandId === 'agent_orchestrator.evalSets.import')
        .map((entry) => entry.undoToken)
        .filter((undoToken): undoToken is string => typeof undoToken === 'string' && undoToken.length > 0)
      expect(undoTokens.length, 'every import is an undoable command').toBeGreaterThanOrEqual(1)

      const undoRes = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token,
        data: { undoToken: undoTokens[0] },
      })
      expect(undoRes.status(), await undoRes.text()).toBe(200)
      const afterUndo = await listFileCases(request, token, agentId)
      expect(afterUndo.map((row) => String(row.id)).sort(), 'undo removes the case the YAML import created').toEqual(
        importedIds,
      )

      const autoDetected = await importEvalSet(request, token, { text: JSON.stringify(file), approve: true })
      expectNoChanges(autoDetected, 2, 1)
    } finally {
      await deleteEvalSetRowsForAgent(agentId).catch(() => undefined)
    }
  })

  test('invalid files are 422 with issue codes, an oversize body is 413, an unknown rubricRef is 422', async ({
    request,
  }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const agentId = uniqueAgentId('invalid')
    let judgeAssertionId: string | null = null

    try {
      await expectInvalidFile(request, token, { file: { ...evalSetFile(agentId, ['a']), format: 'nope' } }, [
        'invalid_format',
      ])
      await expectInvalidFile(request, token, { file: { ...evalSetFile(agentId, ['a']), formatVersion: 99 } }, [
        'unsupported_format_version',
      ])
      await expectInvalidFile(request, token, { text: 'format: [unterminated', format: 'yaml' }, ['invalid_format'])

      const broken = {
        ...evalSetFile(agentId, ['dup', 'dup']),
        assertions: [
          deterministicAssertion('ok_path'),
          { ...deterministicAssertion('no_scorer'), scorerKey: 'qa_no_such_scorer' },
          { ...deterministicAssertion('bad_config'), config: { path: '$.ok', operator: 'qa_not_an_operator' } },
          { key: 'judge_gate', scorerKey: 'llm_judge', severity: 'gate', title: 'QA judge gate', config: { rubricRef: 'groundedness' } },
        ],
      }
      await expectInvalidFile(request, token, { file: broken }, [
        'duplicate_key',
        'unknown_scorer',
        'invalid_scorer_config',
        'judge_gate_refused',
      ])

      const unknownRubric = {
        ...evalSetFile(agentId, ['a']),
        assertions: [
          deterministicAssertion('ok_path'),
          { key: 'judge', scorerKey: 'llm_judge', severity: 'warn', title: 'QA judge', config: { rubricRef: 'qa_no_such_rubric' } },
        ],
      }
      await expectInvalidFile(request, token, { file: unknownRubric }, ['unknown_rubric'])

      const unknownRef = {
        ...evalSetFile(agentId, ['a']),
        cases: [{ key: 'a', input: { question: 'a' }, assertions: [{ key: 'qa_missing_assertion' }] }],
      }
      await expectInvalidFile(request, token, { file: unknownRef }, ['unknown_assertion_ref'])
      expect(await listFileCases(request, token, agentId), 'a rejected file writes nothing').toHaveLength(0)

      const oversize = await apiRequest(request, 'POST', IMPORT_PATH, {
        token,
        data: { text: 'x'.repeat(DEFAULT_EVAL_SET_MAX_BYTES * 2 + 1024) },
      })
      expect(oversize.status(), 'a body above twice OM_AGENT_EVAL_SET_MAX_BYTES is refused before parsing').toBe(413)
      expect((await readJsonSafe<{ code?: string }>(oversize))?.code).toBe('eval_set_too_large')

      const badBody = await apiRequest(request, 'POST', IMPORT_PATH, {
        token,
        data: { file: evalSetFile(agentId, ['a']), text: 'format: x' },
      })
      expect(badBody.status(), 'file and text together are an invalid body').toBe(400)

      const unknownRubricAssertion = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-assertions', {
        token,
        data: {
          key: 'qa_judge_unknown',
          title: 'QA judge unknown rubric',
          type: 'llm_judge',
          scorerKey: 'llm_judge',
          config: { rubricRef: 'qa_no_such_rubric' },
          severity: 'warn',
          appliesTo: agentId,
          enabled: true,
        },
      })
      expect(unknownRubricAssertion.status(), await unknownRubricAssertion.text()).toBe(422)
      expect((await readJsonSafe<{ code?: string }>(unknownRubricAssertion))?.code).toBe('unknown_rubric')

      const judgeAssertion = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-assertions', {
        token,
        data: {
          key: 'qa_judge_known',
          title: 'QA judge known rubric',
          type: 'llm_judge',
          scorerKey: 'llm_judge',
          config: { rubricRef: 'groundedness' },
          severity: 'warn',
          appliesTo: agentId,
          enabled: true,
        },
      })
      expect(judgeAssertion.status(), await judgeAssertion.text()).toBe(201)
      judgeAssertionId = (await readJsonSafe<{ id?: string }>(judgeAssertion))?.id ?? null
      expect(judgeAssertionId).toBeTruthy()
      const unknownOnUpdate = await apiRequest(request, 'PUT', '/api/agent_orchestrator/eval-assertions', {
        token,
        data: { id: judgeAssertionId, config: { rubricRef: 'qa_no_such_rubric' } },
      })
      expect(unknownOnUpdate.status(), await unknownOnUpdate.text()).toBe(422)
      expect((await readJsonSafe<{ code?: string }>(unknownOnUpdate))?.code).toBe('unknown_rubric')
    } finally {
      await deleteEvalSetRowsForAgent(agentId).catch(() => undefined)
    }
  })

  test('current export round-trips as JSON and YAML, a judge gate exports as warn, an unknown version is 404', async ({
    request,
  }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const agentId = uniqueAgentId('export')

    try {
      await importEvalSet(request, token, { file: evalSetFile(agentId, ['case-a', 'case-b']), approve: true })

      const firstJson = await apiRequest(request, 'GET', exportPath('current', agentId, 'json'), { token })
      expect(firstJson.status(), await firstJson.text()).toBe(200)
      const firstJsonText = await firstJson.text()
      const settle = await importEvalSet(request, token, { text: firstJsonText, approve: true })
      expect(settle.created?.cases, 'importing the export must not duplicate cases').toBe(0)
      expect(settle.updated?.cases, 'importing the export must not change cases').toBe(0)
      expect(settle.updated?.assertions, 'importing the export must not change assertions').toBe(0)

      const jsonExport = await apiRequest(request, 'GET', exportPath('current', agentId, 'json'), { token })
      expect(jsonExport.status(), await jsonExport.text()).toBe(200)
      expect(jsonExport.headers()['content-type']).toContain('application/json')
      expect(jsonExport.headers()['content-disposition']).toContain('attachment;')
      expect(jsonExport.headers()['x-om-eval-set-version']?.startsWith('sha256:')).toBe(true)
      expect(jsonExport.headers()[DOWNGRADED_HEADER]).toBeUndefined()
      const jsonText = await jsonExport.text()
      const exported = JSON.parse(jsonText) as ExportedFile
      expect(exported.format).toBe(EVAL_SET_FORMAT)
      expect(exported.agentId).toBe(agentId)
      expect(exported.cases).toHaveLength(2)
      expect((exported.assertions ?? []).map((assertion) => assertion.key)).toContain('ok_path')

      const jsonRoundTrip = await importEvalSet(request, token, { text: jsonText, approve: true })
      expectNoChanges(jsonRoundTrip, 2, exported.assertions?.length ?? 0)

      const yamlExport = await apiRequest(request, 'GET', exportPath('current', agentId, 'yaml'), { token })
      expect(yamlExport.status(), await yamlExport.text()).toBe(200)
      expect(yamlExport.headers()['content-type']).toContain('application/yaml')
      expect(yamlExport.headers()['x-om-eval-set-version']).toBe(jsonExport.headers()['x-om-eval-set-version'])
      const yamlText = await yamlExport.text()
      expect(yamlText).toContain(`format: ${EVAL_SET_FORMAT}`)
      const yamlRoundTrip = await importEvalSet(request, token, { text: yamlText, format: 'yaml', approve: true })
      expectNoChanges(yamlRoundTrip, 2, exported.assertions?.length ?? 0)

      const judgeGate = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-assertions', {
        token,
        data: {
          key: 'qa_judge_gate',
          title: 'QA judge gate',
          type: 'llm_judge',
          scorerKey: 'llm_judge',
          config: { rubricRef: 'groundedness' },
          severity: 'gate',
          appliesTo: agentId,
          enabled: true,
        },
      })
      expect(judgeGate.status(), await judgeGate.text()).toBe(201)
      const downgradedExport = await apiRequest(request, 'GET', exportPath('current', agentId, 'json'), { token })
      expect(downgradedExport.status(), await downgradedExport.text()).toBe(200)
      expect(downgradedExport.headers()[DOWNGRADED_HEADER]).toBe('qa_judge_gate')
      const downgraded = JSON.parse(await downgradedExport.text()) as ExportedFile
      const judgeEntry = (downgraded.assertions ?? []).find((assertion) => assertion.key === 'qa_judge_gate')
      expect(judgeEntry?.scorerKey).toBe('llm_judge')
      expect(judgeEntry?.severity, 'the file format refuses a judge gate').toBe('warn')

      const unknownVersion = await apiRequest(request, 'GET', exportPath(`sha256:${'0'.repeat(64)}`, agentId, 'json'), {
        token,
      })
      expect(unknownVersion.status(), await unknownVersion.text()).toBe(404)
      const malformedVersion = await apiRequest(request, 'GET', exportPath('newest', agentId, 'json'), { token })
      expect(malformedVersion.status()).toBe(400)
    } finally {
      await deleteEvalSetRowsForAgent(agentId).catch(() => undefined)
    }
  })

  test('import needs eval.manage and export needs eval.export', async ({ request }) => {
    const adminToken = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const agentId = uniqueAgentId('acl')
    let exportOnly: ScopedAgentUser | null = null
    let manageOnly: ScopedAgentUser | null = null

    try {
      exportOnly = await createScopedAgentUser(request, adminToken, {
        label: 'evalset-export',
        features: ['agent_orchestrator.eval.export'],
      })
      manageOnly = await createScopedAgentUser(request, adminToken, {
        label: 'evalset-manage',
        features: ['agent_orchestrator.eval.manage'],
      })

      const file = evalSetFile(agentId, ['case-a'])
      const forbiddenImport = await apiRequest(request, 'POST', IMPORT_PATH, { token: exportOnly.token, data: { file } })
      expect(forbiddenImport.status(), 'import must 403 without eval.manage').toBe(403)
      const forbiddenExport = await apiRequest(request, 'GET', exportPath('current', agentId, 'json'), {
        token: manageOnly.token,
      })
      expect(forbiddenExport.status(), 'export must 403 without eval.export').toBe(403)

      const allowedImport = await apiRequest(request, 'POST', IMPORT_PATH, { token: manageOnly.token, data: { file } })
      expect(allowedImport.status(), await allowedImport.text()).toBe(200)
      const allowedExport = await apiRequest(request, 'GET', exportPath('current', agentId, 'json'), {
        token: exportOnly.token,
      })
      expect(allowedExport.status(), await allowedExport.text()).toBe(200)
    } finally {
      await deleteEvalSetRowsForAgent(agentId).catch(() => undefined)
      await deleteScopedAgentUser(request, adminToken, exportOnly).catch(() => undefined)
      await deleteScopedAgentUser(request, adminToken, manageOnly).catch(() => undefined)
    }
  })

  test('eval runs accept capped callSettings, reject providerOptions, and report the posted settings', async ({
    request,
  }) => {
    test.slow()

    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const agentId = await firstRegisteredAgentId(request, token)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const createdEvalCaseIds: string[] = []
    const suiteRunIds: string[] = []

    try {
      const evalCaseId = await createApprovedEvalCase(request, token, agentId, `qa-eval-set-001-${stamp}`)
      createdEvalCaseIds.push(evalCaseId)
      const baseRun = { agentDefinitionId: agentId, evalCaseIds: [evalCaseId], repeatCount: 1, judgeMayGate: false }

      for (const callSettings of [
        { temperature: 0.2, providerOptions: { openai: { reasoningEffort: 'low' } } },
        { maxOutputTokens: 1_000_000 },
        { temperature: 5 },
      ]) {
        const rejected = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-runs', {
          token,
          data: { ...baseRun, callSettings },
        })
        expect(rejected.status(), `callSettings ${JSON.stringify(callSettings)} must be rejected`).toBe(400)
      }

      const callSettings = { temperature: 0.3, seed: 7, maxOutputTokens: 256 }
      const accepted = await apiRequest(request, 'POST', '/api/agent_orchestrator/eval-runs', {
        token,
        data: { ...baseRun, callSettings },
      })
      expect(accepted.status(), await accepted.text()).toBe(200)
      const suiteRunId = (await readJsonSafe<{ suiteRunId?: string }>(accepted))?.suiteRunId ?? ''
      expect(suiteRunId).toBeTruthy()
      suiteRunIds.push(suiteRunId)

      const detailRes = await apiRequest(request, 'GET', `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}`, {
        token,
      })
      expect(detailRes.status(), await detailRes.text()).toBe(200)
      const detail = await readJsonSafe<{ run?: { summary?: { __evalRun?: { callSettings?: unknown } } | null } }>(detailRes)
      expect(detail?.run?.summary?.__evalRun?.callSettings).toEqual(callSettings)

      const reportRes = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/eval-runs/${encodeURIComponent(suiteRunId)}/report?format=json`,
        { token },
      )
      expect(reportRes.status(), await reportRes.text()).toBe(200)
      const report = await readJsonSafe<{
        environment?: { modelSettings?: { temperature?: number; maxOutputTokens?: number; seed?: { requested?: number } } }
      }>(reportRes)
      expect(report?.environment?.modelSettings?.temperature).toBe(0.3)
      expect(report?.environment?.modelSettings?.maxOutputTokens).toBe(256)
      expect(report?.environment?.modelSettings?.seed?.requested).toBe(7)
    } finally {
      await deleteEvalSuiteRunsByIds(suiteRunIds).catch(() => undefined)
      await deleteAgentEvalCasesByIds(createdEvalCaseIds).catch(() => undefined)
    }
  })

  test('GET /eval-scorers lists the built-in judge rubrics', async ({ request }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const response = await apiRequest(request, 'GET', '/api/agent_orchestrator/eval-scorers', { token })
    expect(response.status(), await response.text()).toBe(200)
    const body = await readJsonSafe<{ scorers?: unknown[]; rubrics?: Array<{ key?: string; source?: string }> }>(response)
    expect(Array.isArray(body?.scorers)).toBe(true)
    const builtins = (body?.rubrics ?? []).filter((rubric) => rubric.source === 'builtin').map((rubric) => rubric.key)
    for (const key of BUILTIN_RUBRIC_KEYS) expect(builtins, `built-in rubric ${key}`).toContain(key)
  })

  test('the eval case page labels an imported case as an eval-set file case', async ({ page, request }) => {
    const token = await getAuthToken(request, ADMIN_EMAIL, ADMIN_PASSWORD)
    const agentId = uniqueAgentId('ui')

    try {
      const imported = await importEvalSet(request, token, { file: evalSetFile(agentId, ['case-ui']), approve: true })
      const caseId = imported.cases?.[0]?.id ?? ''
      expect(caseId).toBeTruthy()

      await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      await page.goto(`/backend/eval-cases/${encodeURIComponent(caseId)}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { level: 1, name: agentId })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Eval-set file').first()).toBeVisible()
    } finally {
      await deleteEvalSetRowsForAgent(agentId).catch(() => undefined)
    }
  })
})
