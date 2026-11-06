import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  GUARDRAIL_CHECKS_PATH,
  INTEGRITY_CHECK_KINDS,
  deleteSeededIntegrityRuns,
  seedIntegrityRun,
  type SeededIntegrityRun,
} from './helpers/integrityFixtures'

/**
 * TC-AGENT-INT-001: the guardrail-checks list accepts the integrity check kinds and stays org-scoped.
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md
 * (Testing Strategy → Integration → `GET /guardrail-checks?kind=evidence_quote`).
 *
 * No model needed. Each integrity kind (`evidence_quote`, `reference_exists`,
 * `tool_consulted`, `custom_integrity`) is a valid `kind` filter (200 + items);
 * an unknown kind is rejected by the list validator (400). An `evidence_quote`
 * row seeded in the caller's organization is returned by the filter, while one
 * seeded for the same tenant under another organization id is not.
 *
 * Fixtures: integrity checks are written only by a real agent run and runs have
 * no create API, so the run + check rows are seeded through dbFixtures (same
 * precedent as TC-AGENT-PERF-*) and removed in `finally`.
 */

type GuardrailCheckListBody = {
  items?: Array<{ id?: string; agent_run_id?: string; kind?: string; result?: string }>
}

function kindFilterPath(kind: string, agentRunId?: string): string {
  const params = new URLSearchParams({ kind, pageSize: '100' })
  if (agentRunId) params.set('agentRunId', agentRunId)
  return `${GUARDRAIL_CHECKS_PATH}?${params.toString()}`
}

test.describe('TC-AGENT-INT-001: guardrail-checks integrity kind filter', () => {
  test('accepts every integrity kind, rejects an unknown kind', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    for (const kind of INTEGRITY_CHECK_KINDS) {
      const response = await apiRequest(request, 'GET', kindFilterPath(kind), { token })
      expect(response.status(), `kind=${kind}: ${await response.text()}`).toBe(200)
      const body = await readJsonSafe<GuardrailCheckListBody>(response)
      expect(Array.isArray(body?.items), `kind=${kind} returns an items list`).toBe(true)
      for (const item of body?.items ?? []) expect(item.kind).toBe(kind)
    }

    const unknown = await apiRequest(request, 'GET', kindFilterPath('not_an_integrity_kind'), { token })
    expect(unknown.status(), await unknown.text()).toBe(400)
  })

  test('returns this organization rows only', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    expect(tenantId, 'the admin token carries a tenant').toBeTruthy()
    expect(organizationId, 'the admin token carries an organization').toBeTruthy()

    const seeds: SeededIntegrityRun[] = []
    try {
      const own = await seedIntegrityRun({ tenantId, organizationId })
      seeds.push(own)
      const foreign = await seedIntegrityRun({ tenantId, organizationId: randomUUID() })
      seeds.push(foreign)

      const ownResponse = await apiRequest(request, 'GET', kindFilterPath('evidence_quote', own.runId), { token })
      expect(ownResponse.status(), await ownResponse.text()).toBe(200)
      const ownBody = await readJsonSafe<GuardrailCheckListBody>(ownResponse)
      const ownIds = (ownBody?.items ?? []).map((item) => item.id)
      expect(ownIds).toEqual(own.checkIds)
      expect(ownBody?.items?.[0]?.result).toBe('warn')

      const otherKind = await apiRequest(request, 'GET', kindFilterPath('reference_exists', own.runId), { token })
      expect(otherKind.status(), await otherKind.text()).toBe(200)
      expect((await readJsonSafe<GuardrailCheckListBody>(otherKind))?.items ?? []).toHaveLength(0)

      const foreignResponse = await apiRequest(request, 'GET', kindFilterPath('evidence_quote', foreign.runId), {
        token,
      })
      expect(foreignResponse.status(), await foreignResponse.text()).toBe(200)
      expect((await readJsonSafe<GuardrailCheckListBody>(foreignResponse))?.items ?? []).toHaveLength(0)
    } finally {
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })
})
