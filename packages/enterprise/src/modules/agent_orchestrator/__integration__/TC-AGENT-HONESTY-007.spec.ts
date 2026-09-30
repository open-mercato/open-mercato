import { expect, test, type Page } from '@playwright/test'

/**
 * TC-AGENT-HONESTY-007: the Playground result panel does not contradict itself.
 *
 * The panel used to print "Recommended for approval · 85%" and, directly under
 * it, "The agent proposed nothing" with "Options the agent considered: 0" — for
 * the same proposal the decision queue rendered correctly (#5980). The cause was
 * the call site, not the data: it handed `ProposalCard` the leading option's
 * `actions[]` where the card reads an option ENVELOPE.
 *
 * Determinism: the run POST is intercepted with the exact envelope the run route
 * returns, so no provider, model or agent registration is involved — this
 * exercises the client-side rendering contract in the real app. The mapper
 * itself is unit-tested in `__tests__/playground-proposal-render.test.tsx`.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

const PROPOSAL_ENVELOPE = {
  options: [
    {
      id: 'negotiation',
      label: 'Stage → Negotiation',
      confidence: 0.85,
      rationale: 'The buyer asked for pricing in writing.',
      actions: [{ type: 'set_stage', payload: { stage: 'negotiation' } }],
    },
    {
      id: 'hold',
      label: 'Hold for legal',
      confidence: 0.4,
      actions: [{ type: 'create_task', payload: { title: 'Legal review' } }],
    },
  ],
  rationale: 'Two viable next steps for this deal.',
}

async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

async function runWithProposal(page: Page, proposal: unknown): Promise<void> {
  // `runId`/`proposalId` stay null so the panel makes no follow-up trace call —
  // this test is about how the returned proposal renders, nothing else.
  await page.route('**/api/agent_orchestrator/agents/*/run', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'proposal', proposal, runId: null, proposalId: null }),
    })
  })

  await page.goto('/backend/playground', { waitUntil: 'domcontentloaded' })
  const input = page.locator('#ao-pg-input')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill('{"probe": true}')
  await page.getByRole('button', { name: /run/i }).click()
}

test.describe('TC-AGENT-HONESTY-007: the playground result panel agrees with itself', () => {
  test('a proposal with an action renders its options and never the empty state', async ({ page }) => {
    test.slow()

    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await runWithProposal(page, PROPOSAL_ENVELOPE)

    // The proposed action is named, ranked and carries the agent's confidence…
    await expect(page.getByText('Stage → Negotiation')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('85% confidence')).toBeVisible()
    await expect(page.getByText('Hold for legal')).toBeVisible()
    await expect(page.locator('[data-proposal-option]')).toHaveCount(2)

    // …and the "nothing was proposed" copy is nowhere in the same panel.
    await expect(page.getByText('The agent proposed nothing')).toHaveCount(0)
  })

  test('an empty option set still renders the empty state', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await runWithProposal(page, { options: [], rationale: 'Nothing worth doing here.' })

    await expect(page.getByText('The agent proposed nothing')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('[data-proposal-option]')).toHaveCount(0)
  })
})
