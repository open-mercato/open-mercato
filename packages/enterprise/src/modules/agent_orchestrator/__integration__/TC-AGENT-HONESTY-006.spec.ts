import { expect, test, type Page } from '@playwright/test'

/**
 * TC-AGENT-HONESTY-006: a guardrail block surfaces as a policy verdict in the
 * Playground — never as the generic "invalid output" message.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-data-honesty-pass.md (§3.6, Phase 5).
 *
 * Determinism note (documented deviation from the spec's "trip a moderation
 * guardrail" phrasing): no shipped guardrail is deterministically trippable
 * end-to-end from the Playground without provider- or model-dependent behavior —
 * prompt-injection scans only context-assembled document/retrieval spans (which
 * playground runs do not populate), moderation requires a provider seam, and
 * grounding applies only to code-registry factual capabilities whose example
 * outputs carry no claims. The SERVER side of the contract (both routes mapping
 * `AgentGuardrailBlockedError` subclass-before-parent to the typed 422 body) is
 * covered by unit tests (`__tests__/guardrail-block-contract.test.ts`). This
 * spec deterministically exercises the CLIENT side of the same contract in the
 * real app: the run POST is intercepted with the exact production 422 body and
 * the UI must render the guardrail alert with kind/phase — not the generic
 * invalid-output copy.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-HONESTY-006: guardrail block is a policy verdict, not a model bug', () => {
  test('the playground renders the guardrail-blocked alert with kind/phase on the 422 contract body', async ({ page }) => {
    test.slow()

    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    // Intercept the run POST with the exact body the route produces for an
    // AgentGuardrailBlockedError (verified by the route unit tests).
    await page.route('**/api/agent_orchestrator/agents/*/run', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Blocked by a runtime guardrail',
          code: 'guardrail_blocked',
          kind: 'moderation',
          phase: 'input',
          guardrailSetVersion: 'sha256:tc-honesty-006',
        }),
      })
    })

    await page.goto('/backend/playground', { waitUntil: 'domcontentloaded' })

    // Any registered agent will do — the request never reaches the server.
    const input = page.locator('#ao-pg-input')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill('{"probe": true}')
    await page.getByRole('button', { name: /run/i }).click()

    // The distinct guardrail alert renders the interpolated kind + phase…
    const guardrailAlert = page.getByText(/moderation/).filter({ hasText: /input/ })
    await expect(guardrailAlert.first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Blocked by a moderation guardrail during the input phase/i)).toBeVisible()

    // …and the generic invalid-output / run-failed copy is NOT shown.
    await expect(page.getByText('Agent produced invalid output')).toHaveCount(0)
    await expect(page.getByText('The agent run failed.')).toHaveCount(0)
  })

  test('a plain invalid-output 422 keeps the generic error alert (no guardrail framing)', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    await page.route('**/api/agent_orchestrator/agents/*/run', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Agent produced invalid output' }),
      })
    })

    await page.goto('/backend/playground', { waitUntil: 'domcontentloaded' })
    const input = page.locator('#ao-pg-input')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill('{"probe": true}')
    await page.getByRole('button', { name: /run/i }).click()

    await expect(page.getByText('Agent produced invalid output')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/guardrail during the/i)).toHaveCount(0)
  })
})
