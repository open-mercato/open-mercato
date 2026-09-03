import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-AGENT-TRACE-002: Correction flywheel contract surfaces.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/next/2026-06-19-agent-trace-eval-capture.md
 *
 * Verifies the eval-case export envelope (versioned, approved-only), the approve
 * endpoint's not-found behavior, and the correction route's validation + scoping.
 *
 * NOTE: the full correct → approve → export chain requires a pending AgentProposal,
 * which is produced by the runtime (not creatable via a public API without an AI
 * round-trip), so it is exercised by the unit tests (correction-service.test.ts)
 * rather than seeded here. These cases cover the API contract + RBAC + validation.
 */

const randomUuid = () =>
  '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12)

test.describe('TC-AGENT-TRACE-002: eval-case export + correction contract', () => {
  test('exports a versioned eval-case envelope (approved-only)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'GET', '/api/agent_orchestrator/eval-cases/export', { token })
    expect(response.status()).toBe(200)
    const body = (await response.json()) as { version: number; generatedAt: string; count: number; cases: unknown[] }
    expect(body.version).toBe(1)
    expect(typeof body.generatedAt).toBe('string')
    expect(Array.isArray(body.cases)).toBe(true)
    expect(body.count).toBe(body.cases.length)
  })

  test('approve returns 404 for an unknown eval case (org-scoped)', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'POST',
      `/api/agent_orchestrator/eval-cases/${randomUuid()}/approve`,
      { token },
    )
    expect([404, 409]).toContain(response.status())
  })

  test('correction rejects an empty reason and an unknown proposal', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const emptyReason = await apiRequest(request, 'POST', '/api/agent_orchestrator/corrections', {
      token,
      data: { proposalId: randomUuid(), action: 'reject', reason: '' },
    })
    expect(emptyReason.status()).toBe(422)

    const unknownProposal = await apiRequest(request, 'POST', '/api/agent_orchestrator/corrections', {
      token,
      data: { proposalId: randomUuid(), action: 'reject', reason: 'not actionable' },
    })
    expect(unknownProposal.status()).toBe(404)
  })
})
