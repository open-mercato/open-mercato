import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createScopedAgentUser,
  deleteScopedAgentUser,
  type ScopedAgentUser,
} from './helpers/agentAccessFixtures'
import {
  GUARDRAIL_CHECKS_PATH,
  GUARDRAIL_READ_FEATURE,
  deleteSeededIntegrityRuns,
  rawOutputKeyFor,
  runArtifactPath,
  seedIntegrityRun,
  type SeededIntegrityRun,
} from './helpers/integrityFixtures'

/**
 * TC-AGENT-INT-002: the run artifact route serves `kind=raw_output` only for keys the run's checks reference.
 * Source: .ai/specs/enterprise/agent-orchestrator/2026-10-21-output-integrity-guardrails.md
 * (Testing Strategy → Integration → Encryption: `trace.view` only, 403 without it,
 * other org's key → 404).
 *
 * No model needed. A seeded run carries one `evidence_quote` check whose evidence
 * references `rawOutput.key`; no artifact blob exists for it.
 *   - an unknown run id → 404; an unreferenced key on the seeded run → 404;
 *   - the referenced key passes the ownership check and reaches storage, which
 *     holds no blob → 502 (never 200, never 404);
 *   - the same shape seeded under another organization → 404 for the caller;
 *   - an unknown `kind` → 422;
 *   - a user holding `guardrail.read` but not `trace.view` → 403.
 *
 * Not covered here (needs a scripted model, which this environment lacks): the
 * 200 path returning a decrypted raw output written by a real repaired run, and
 * the ciphertext-at-rest assertion on the stored object.
 */

test.describe('TC-AGENT-INT-002: raw_output artifact contract', () => {
  test('ownership, organization scope and validation of kind=raw_output', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(token)
    expect(tenantId, 'the admin token carries a tenant').toBeTruthy()
    expect(organizationId, 'the admin token carries an organization').toBeTruthy()

    const seeds: SeededIntegrityRun[] = []
    try {
      const missingRun = await apiRequest(
        request,
        'GET',
        runArtifactPath(randomUUID(), { kind: 'raw_output', key: 'x' }),
        { token },
      )
      expect(missingRun.status(), await missingRun.text()).toBe(404)

      const own = await seedIntegrityRun({ tenantId, organizationId })
      seeds.push(own)

      const unreferenced = await apiRequest(
        request,
        'GET',
        runArtifactPath(own.runId, { kind: 'raw_output', key: rawOutputKeyFor(own.runId) }),
        { token },
      )
      expect(unreferenced.status(), await unreferenced.text()).toBe(404)

      const referenced = await apiRequest(
        request,
        'GET',
        runArtifactPath(own.runId, { kind: 'raw_output', key: own.rawOutputKey }),
        { token },
      )
      expect(referenced.status(), `referenced key reaches storage: ${await referenced.text()}`).toBe(502)

      const outputKindWithRawKey = await apiRequest(
        request,
        'GET',
        runArtifactPath(own.runId, { kind: 'output', key: own.rawOutputKey }),
        { token },
      )
      expect(outputKindWithRawKey.status(), await outputKindWithRawKey.text()).toBe(404)

      const invalidKind = await apiRequest(
        request,
        'GET',
        runArtifactPath(own.runId, { kind: 'raw_input', key: own.rawOutputKey }),
        { token },
      )
      expect(invalidKind.status(), await invalidKind.text()).toBe(422)

      const foreign = await seedIntegrityRun({ tenantId, organizationId: randomUUID() })
      seeds.push(foreign)
      const foreignKey = await apiRequest(
        request,
        'GET',
        runArtifactPath(foreign.runId, { kind: 'raw_output', key: foreign.rawOutputKey }),
        { token },
      )
      expect(foreignKey.status(), await foreignKey.text()).toBe(404)
    } finally {
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })

  test('requires agent_orchestrator.trace.view', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(adminToken)

    let user: ScopedAgentUser | null = null
    const seeds: SeededIntegrityRun[] = []
    try {
      const own = await seedIntegrityRun({ tenantId, organizationId })
      seeds.push(own)
      user = await createScopedAgentUser(request, adminToken, {
        label: 'int-no-trace',
        features: [GUARDRAIL_READ_FEATURE],
      })

      const checks = await apiRequest(
        request,
        'GET',
        `${GUARDRAIL_CHECKS_PATH}?kind=evidence_quote&agentRunId=${own.runId}`,
        { token: user.token },
      )
      expect(checks.status(), `guardrail.read is enough for the list: ${await checks.text()}`).toBe(200)

      const artifact = await apiRequest(
        request,
        'GET',
        runArtifactPath(own.runId, { kind: 'raw_output', key: own.rawOutputKey }),
        { token: user.token },
      )
      expect(artifact.status(), await artifact.text()).toBe(403)
    } finally {
      await deleteScopedAgentUser(request, adminToken, user).catch(() => undefined)
      await deleteSeededIntegrityRuns(seeds).catch(() => undefined)
    }
  })
})
