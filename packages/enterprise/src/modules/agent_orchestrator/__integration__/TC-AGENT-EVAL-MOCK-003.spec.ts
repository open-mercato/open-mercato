import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteEvalSetRowsForAgent } from './helpers/evalReportFixtures'

/**
 * TC-AGENT-EVAL-MOCK-003: an eval-set file whose cases declare tool mocks
 * imports through POST /eval-sets/import, and the database cases it creates
 * carry no mocks (mocks apply only when the file itself is run).
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-11-17-eval-case-tool-mocks.md (A-4).
 * The import targets a throwaway agent id; cleanup removes its rows by agent id.
 */

const IMPORT_PATH = '/api/agent_orchestrator/eval-sets/import'

type ImportResponse = { created?: { cases?: number; assertions?: number }; cases?: Array<{ id?: string }> }
type InvalidFileResponse = { code?: string; issues?: Array<{ path?: string }> }

function evalSetFile(agentId: string, mocks: unknown) {
  return {
    format: 'open-mercato.agent-eval-set',
    formatVersion: 1,
    agentId,
    assertions: [{ key: 'present', scorerKey: 'output_present', severity: 'gate', title: 'Output present', config: {} }],
    cases: [
      {
        key: 'unknown-company',
        input: { question: 'What does Acme Ltd owe us?' },
        assertions: [{ key: 'present' }],
        mocks,
      },
    ],
  }
}

test('TC-AGENT-EVAL-MOCK-003: importing a file with tool mocks stores no mocks on the cases', async ({ request }) => {
  const token = await getAuthToken(request, 'admin@acme.com', 'secret')
  const agentId = `qa_eval_mock_003_${Date.now()}_${randomInt(1_000_000)}`
  const mocks = {
    match: 'any',
    tools: [
      { tool: 'customers.search_companies', match: 'strict', args: { query: 'Acme Ltd' }, output: [] },
      { id: 'stock', tool: 'qa_mock_marker.get_stock', error: 'upstream timeout', required: true },
    ],
  }
  try {
    const response = await apiRequest(request, 'POST', IMPORT_PATH, { token, data: { file: evalSetFile(agentId, mocks) } })
    expect(response.status(), await response.text()).toBe(200)
    const imported = (await readJsonSafe<ImportResponse>(response)) ?? {}
    expect(imported.created).toEqual({ cases: 1, assertions: 1 })

    const query = new URLSearchParams({ agentDefinitionId: agentId, sourceType: 'file', pageSize: '100' }).toString()
    const listed = await apiRequest(request, 'GET', `/api/agent_orchestrator/eval-cases?${query}`, { token })
    expect(listed.status()).toBe(200)
    const rows = (await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listed))?.items ?? []
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows[0])).not.toContain('qa_mock_marker')
    expect(rows[0]).not.toHaveProperty('mocks')

    const exported = await apiRequest(
      request,
      'GET',
      `/api/agent_orchestrator/eval-sets/current/export?${new URLSearchParams({ agentDefinitionId: agentId, format: 'json' })}`,
      { token },
    )
    expect(exported.status(), await exported.text()).toBe(200)
    expect(await exported.text()).not.toContain('qa_mock_marker')

    const invalid = await apiRequest(request, 'POST', IMPORT_PATH, {
      token,
      data: { file: evalSetFile(agentId, { tools: [{ tool: 'customers.search_companies', output: [] }] }) },
    })
    expect(invalid.status()).toBe(422)
    const issues = (await readJsonSafe<InvalidFileResponse>(invalid))?.issues ?? []
    expect(issues.map((issue) => issue.path)).toContain('cases.0.mocks.tools.0.args')
  } finally {
    await deleteEvalSetRowsForAgent(agentId).catch(() => undefined)
  }
})
