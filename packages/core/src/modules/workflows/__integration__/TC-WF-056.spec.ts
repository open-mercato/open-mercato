import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildInspectorUserTaskDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  findInstanceUserTask,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-056 [P1] (UI): a pending proposal renders as a DRAFT CARD on its
 * disposition task.
 *
 * The spec's second clause — the one-click trace link — is BROKEN and is
 * asserted as such in the third test, with its root cause. It is not softened
 * away; it is pinned so the gap is visible in CI rather than only in a report.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §7.6: *"In the run view a
 * pending proposal renders as a **draft card** (Lindy pattern) with the would-be
 * mutation; one-click link to the agent run trace."*
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THIS SPEC IS GATED AND IS SKIPPED IN THE DEFAULT CHECKOUT. READ THIS BEFORE
 * COUNTING IT AS COVERAGE.
 *
 * The card is `agent_orchestrator.injection.task-proposal-draft`, which lives in
 * `packages/enterprise` — an OPTIONAL peer that `apps/mercato/.env` disables
 * (`OM_ENABLE_ENTERPRISE_MODULES=false`). The host page and the injection spot
 * (`workflows.task.detail:context`) are core, but with the peer absent the spot
 * renders nothing at all, so there is no honest assertion to make. The
 * `dependsOnModules` gate below removes the spec from discovery rather than
 * letting it fail, per `.ai/qa/AGENTS.md`.
 *
 * TO ACTUALLY RUN IT a maintainer must:
 *   1. export OM_ENABLE_ENTERPRISE_MODULES=true
 *      export OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true
 *      — BOTH are required (`apps/mercato/src/modules.ts` ANDs them). Note that
 *      `OM_ENABLE_ENTERPRISE_MODULES_AGENTS` is absent from the ephemeral
 *      runner's forwarding list AND from `BUILD_CACHE_ENV_KEYS`
 *      (`packages/cli/src/lib/testing/integration.ts`); it reaches the app only
 *      because `buildEnvironment` spreads `process.env`, and toggling it alone
 *      does NOT invalidate a cached Next build.
 *   2. `yarn generate` — the module is registered into
 *      `apps/mercato/.mercato/generated/*` only when both flags are set.
 *   3. apply the module's 24 migrations (a fresh ephemeral database does this as
 *      part of bootstrap; an existing one needs `mercato db:migrate` plus
 *      `yarn mercato auth sync-role-acls` for the new ACL features).
 *   4. export DATABASE_URL to the app under test, because the proposal is seeded
 *      through `withClient` (see below).
 * No AI provider key is needed: the module loads without one, and the proposal
 * here is seeded rather than inferred.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THE PROPOSAL IS SEEDED WITH SQL. `agent_proposals` rows are produced by
 * the agent runtime (a real model round trip) and there is NO create route —
 * `api/proposals/route.ts` exports `GET` only. The established precedent is
 * direct `pg` inserts (`agent_orchestrator/__integration__/helpers/agentPerfFixtures.ts`,
 * whose header states the same constraint); the statements are inlined here
 * instead of imported so that a core-side spec never reaches into an enterprise
 * package's internals. The disposition task's `form_schema` is patched the same
 * way, to exactly what `createAgentDispositionTask` writes in production
 * (`{ proposalId, payload, confidence }`) — which is the only thing the widget
 * reads off the host context.
 *
 * Surfaces under test:
 * - /backend/tasks/[id] (core host page + `workflows.task.detail:context`)
 * - GET /api/agent_orchestrator/proposals?id=
 * - /backend/traces/[runId] (the one-click destination)
 */

export const integrationMeta = {
  description: 'Agent proposal draft card on a workflows disposition task (spec 7.6)',
  dependsOnModules: ['workflows', 'agent_orchestrator'],
  requiredEnvVars: ['OM_ENABLE_ENTERPRISE_MODULES_AGENTS'],
}

const PROPOSED_STAGE = 'At risk'
const PROPOSED_OWNER = 'Renewals desk'
const RATIONALE = 'Health score dropped below the renewal threshold for two consecutive weeks.'
const CONFIDENCE = 0.62

type SeededProposal = { runId: string; proposalId: string }

async function seedPendingProposal(scope: {
  tenantId: string
  organizationId: string
  agentId: string
}): Promise<SeededProposal> {
  const runId = randomUUID()
  const proposalId = randomUUID()
  const now = new Date()
  await withClient(async (client) => {
    await client.query(
      `insert into agent_runs (id, tenant_id, organization_id, agent_id, status, input, created_at, updated_at, completed_at)
       values ($1, $2, $3, $4, 'ok', $5::jsonb, $6, $6, $6)`,
      [
        runId,
        scope.tenantId,
        scope.organizationId,
        scope.agentId,
        JSON.stringify({ seededBy: 'TC-WF-056' }),
        now,
      ],
    )
    // `source` defaults to 'runtime', which the list route hard-filters on.
    await client.query(
      `insert into agent_proposals
         (id, tenant_id, organization_id, agent_id, run_id, payload, confidence, disposition, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending', $8, $8)`,
      [
        proposalId,
        scope.tenantId,
        scope.organizationId,
        scope.agentId,
        runId,
        JSON.stringify({
          rationale: RATIONALE,
          actions: [
            {
              commandId: 'customers.deals.update',
              payload: { stage: PROPOSED_STAGE, owner: PROPOSED_OWNER },
            },
          ],
        }),
        CONFIDENCE,
        now,
      ],
    )
  })
  return { runId, proposalId }
}

/** Make the task an agent disposition task, exactly as `createAgentDispositionTask` does. */
async function bindProposalToTask(taskId: string, proposal: SeededProposal): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `update user_tasks
          set form_schema = $2::jsonb,
              updated_at = now()
        where id = $1`,
      [
        taskId,
        JSON.stringify({
          proposalId: proposal.proposalId,
          payload: { stage: PROPOSED_STAGE, owner: PROPOSED_OWNER },
          confidence: CONFIDENCE,
        }),
      ],
    )
    await client.query(`update agent_proposals set user_task_id = $2 where id = $1`, [
      proposal.proposalId,
      taskId,
    ])
  })
}

async function deleteSeededProposal(proposal: SeededProposal | null): Promise<void> {
  if (!proposal) return
  await withClient(async (client) => {
    await client.query('delete from agent_proposals where id = $1', [proposal.proposalId])
    await client.query('delete from agent_runs where id = $1', [proposal.runId])
  }).catch(() => undefined)
}

test.describe('TC-WF-056: a pending proposal renders as a draft card', () => {
  test('the card shows the would-be mutation and routes to where the verdict is taken', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now() + randomInt(1_000)
    const agentId = `qa.draft_card.${stamp}`

    let definitionId: string | null = null
    let instanceId: string | null = null
    let proposal: SeededProposal | null = null

    try {
      // A REAL disposition task: the row, its event and its notification are all
      // written by the workflows engine, which is what `createAgentDispositionTask`
      // does in production too. Only the proposal it points at is seeded.
      const payload = buildInspectorUserTaskDefinitionPayload(stamp, {
        suffix: '-draftcard',
        stepName: 'Dispose agent proposal',
        postTaskTrigger: 'manual',
        userTaskConfig: {
          assignedToRoles: ['admin'],
          allowedActions: ['complete'],
          formSchema: { fields: [{ name: 'approved', type: 'boolean', label: 'Approved' }] },
        },
      })
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
      })

      const task = await findInstanceUserTask(request, token, instanceId, { timeoutMs: 30_000 })
      expect(task?.id, 'the review task exists').toBeTruthy()
      const taskId = task!.id!

      proposal = await seedPendingProposal({ tenantId, organizationId, agentId })
      await bindProposalToTask(taskId, proposal)

      await login(page, 'admin')
      await page.goto(`/backend/tasks/${encodeURIComponent(taskId)}`)

      const card = page.getByTestId('task-proposal-draft')
      await expect(card, 'the draft card renders on the disposition task').toBeVisible({
        timeout: 30_000,
      })

      // (1) It says what it is, and that NOTHING has happened yet — the whole
      //     point of a draft card is that the mutation is still a proposal.
      await expect(card.getByText('Proposed by the agent')).toBeVisible()
      await expect(card.getByText(/Nothing has been written yet/i)).toBeVisible()

      // (2) The would-be mutation, field by field — not the key/value dump the
      //     generic `formSchema` walker would produce.
      await expect(card.getByText('Proposed decision')).toBeVisible()
      await expect(card.getByText(PROPOSED_STAGE, { exact: true })).toBeVisible()
      await expect(card.getByText(PROPOSED_OWNER, { exact: true })).toBeVisible()

      // (3) The confidence the auto-approve threshold was compared against.
      await expect(card.getByText(/Confidence:\s*62%/)).toBeVisible()

      // (4) The agent's reasoning, from the proposal's own rationale.
      await expect(card.getByText(RATIONALE)).toBeVisible()

      // (5) The card is read-only and sends the operator where the verdict is
      //     actually taken — it must not grow a second dispose path.
      const reviewButton = card.getByRole('button', { name: /Review proposal/i })
      await expect(reviewButton).toBeVisible()
      await reviewButton.click()
      await expect(page).toHaveURL(new RegExp(`/backend/caseload/${proposal.proposalId}`), {
        timeout: 30_000,
      })
    } finally {
      await deleteSeededProposal(proposal)
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  /**
   * KNOWN DEFECT — asserted as it behaves today, deliberately, not softened.
   *
   * §7.6 promises "one-click link to the agent run trace", and that link NEVER
   * renders. The widget declares its own local `DraftProposal` type and reads
   * `proposal.runId` straight off the API item, but
   * `GET /api/agent_orchestrator/proposals` is a `makeCrudRoute` list whose
   * projection — and whose own `proposalListItemSchema` — is snake_case
   * (`run_id`). Every OTHER consumer of that route goes through the module's
   * shared mapper, which normalizes both spellings
   * (`components/types.ts`: `asString(item.run_id) ?? asString(item.runId)`);
   * the draft card is the one that does not, so `runId` is always `undefined`
   * and the `proposal.runId ? … : null` branch renders nothing. The other three
   * fields the card reads (`id`, `payload`, `confidence`) happen to spell the
   * same in both cases, which is why only the trace link is dead.
   *
   * WHEN THAT IS FIXED (read `run_id`, or reuse the shared mapper) this test must
   * be INVERTED: the button becomes visible and clicking it must land on
   * `/backend/traces/<runId>`.
   */
  test('the trace link does not render, because the widget reads runId off a snake_case route', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(token)
    const stamp = Date.now() + randomInt(1_000)
    const agentId = `qa.draft_trace.${stamp}`

    let definitionId: string | null = null
    let instanceId: string | null = null
    let proposal: SeededProposal | null = null

    try {
      const payload = buildInspectorUserTaskDefinitionPayload(stamp, {
        suffix: '-tracelink',
        stepName: 'Dispose agent proposal',
        postTaskTrigger: 'manual',
        userTaskConfig: {
          assignedToRoles: ['admin'],
          allowedActions: ['complete'],
          formSchema: { fields: [{ name: 'approved', type: 'boolean', label: 'Approved' }] },
        },
      })
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
      })
      const task = await findInstanceUserTask(request, token, instanceId, { timeoutMs: 30_000 })
      const taskId = task!.id!

      proposal = await seedPendingProposal({ tenantId, organizationId, agentId })
      await bindProposalToTask(taskId, proposal)

      // The run IS reachable: the API carries it, under `run_id`.
      const listed = await apiRequest(
        request,
        'GET',
        `/api/agent_orchestrator/proposals?id=${encodeURIComponent(proposal.proposalId)}`,
        { token },
      )
      expect(listed.status()).toBe(200)
      const listedBody = await readJsonSafe<{
        items?: Array<Record<string, unknown>>
      }>(listed)
      const item = (listedBody?.items ?? []).find((row) => row.id === proposal!.proposalId)
      expect(item, 'the proposal is served by the list route').toBeTruthy()
      expect(item?.run_id, 'the route carries the run under a snake_case key').toBe(proposal.runId)
      expect(
        item?.runId,
        'DEFECT: and NOT under the camelCase key the draft card reads',
      ).toBeUndefined()

      await login(page, 'admin')
      await page.goto(`/backend/tasks/${encodeURIComponent(taskId)}`)

      const card = page.getByTestId('task-proposal-draft')
      await expect(card, 'the card itself renders').toBeVisible({ timeout: 30_000 })
      await expect(
        card.getByRole('button', { name: /Open full trace/i }),
        'DEFECT: §7.6’s one-click trace link never renders (expected visible once fixed)',
      ).toHaveCount(0)
    } finally {
      await deleteSeededProposal(proposal)
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('a task carrying no proposal renders no card at all', async ({ page, request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildInspectorUserTaskDefinitionPayload(stamp, {
        suffix: '-nocard',
        postTaskTrigger: 'manual',
        userTaskConfig: {
          assignedToRoles: ['admin'],
          formSchema: { fields: [{ name: 'approved', type: 'boolean', label: 'Approved' }] },
        },
      })
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
      })
      const task = await findInstanceUserTask(request, token, instanceId, { timeoutMs: 30_000 })
      expect(task?.id).toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/tasks/${encodeURIComponent(task!.id!)}`)

      // The claim block proves the page rendered; the card's absence is therefore
      // the widget declining, not the page failing to load.
      await expect(page.getByTestId('task-claim')).toBeVisible({ timeout: 30_000 })
      await expect(
        page.getByTestId('task-proposal-draft'),
        'an ordinary user task gets no proposal card',
      ).toHaveCount(0)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
