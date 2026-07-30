import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildFailingStepDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  getWorkflowFailureQueue,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-061 [P0]: failure-queue triage, and a bulk replay that actually replays.
 *
 * Spec `.ai/specs/2026-07-26-workflows-ux-redesign.md` §8.4: *"**Failure queue +
 * bulk replay:** `Send to failure queue` directive parks instances as ATTENTION;
 * with FAILED instances they form a triage list with error grouping; bulk
 * retry/cancel runs through the progress module."*
 *
 * Three claims, asserted as three things rather than as one 200:
 * 1. the list is a UNION — an attention-parked instance and a FAILED one appear
 *    side by side, which the instance list route cannot express because it ANDs
 *    its `attention` and `status` filters;
 * 2. the grouping NORMALIZES — the group key replaces ids/numbers/quoted values
 *    with placeholders while the label keeps one raw message, and asking for that
 *    key narrows the list;
 * 3. the bulk replay REPLAYS — the queued progress job completes, the parked
 *    instances gain an attempt, their attention marker is cleared and they leave
 *    the queue. A 202 on its own proves only that a job was enqueued.
 *
 * Every assertion is scoped to this spec's own instance ids: the failure queue is
 * a shared, accumulating surface, so a total or a group count would be a
 * different test's data.
 *
 * Surfaces under test:
 * - GET  /api/workflows/instances/failure-queue (+ `?errorGroup=`)
 * - POST /api/workflows/instances/bulk-replay
 * - GET  /api/progress/jobs/[id]
 * - /backend/instances/failure-queue (the triage page)
 */

type ProgressJobBody = {
  status?: string
  resultSummary?: { action?: string; affectedCount?: number; skippedCount?: number; failedCount?: number }
}

test.describe('TC-WF-061: failure-queue triage and bulk replay', () => {
  test('the queue unions parked and failed runs, and groups them by normalized error', async ({ request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let parkedDefinitionId: string | null = null
    let failedDefinitionId: string | null = null
    let parkedInstanceId: string | null = null
    let failedInstanceId: string | null = null

    try {
      const parkedPayload = buildFailingStepDefinitionPayload(stamp, {
        suffix: '-parked',
        errorDirective: 'failureQueue',
      })
      const failedPayload = buildFailingStepDefinitionPayload(stamp, { suffix: '-failed' })
      parkedDefinitionId = await createWorkflowDefinitionFixture(request, token, parkedPayload)
      failedDefinitionId = await createWorkflowDefinitionFixture(request, token, failedPayload)

      parkedInstanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: parkedPayload.workflowId,
      })
      failedInstanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: failedPayload.workflowId,
      })

      // The directive parks rather than fails: existing PAUSED status plus the
      // engine-owned attention marker, no new instance status.
      const parked = await pollWorkflowInstance(
        request,
        token,
        parkedInstanceId,
        (instance) => instance.status === 'PAUSED',
        { timeoutMs: 40_000 },
      )
      expect(parked?.status, 'a failureQueue directive parks the run').toBe('PAUSED')
      const failed = await pollWorkflowInstance(
        request,
        token,
        failedInstanceId,
        (instance) => instance.status === 'FAILED',
        { timeoutMs: 40_000 },
      )
      expect(failed?.status, 'the same step without the directive fails the run').toBe('FAILED')

      const parkedDetail = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${encodeURIComponent(parkedInstanceId)}`,
        { token },
      )
      const parkedBody = await readJsonSafe<{
        data?: { metadata?: { attention?: { reason?: string; stepId?: string } | null } | null }
      }>(parkedDetail)
      expect(parkedBody?.data?.metadata?.attention?.reason).toBe('ERROR_DIRECTIVE')
      expect(parkedBody?.data?.metadata?.attention?.stepId).toBe('boom')

      // (1) The union.
      const queue = await getWorkflowFailureQueue(request, token)
      const queuedIds = (queue?.data ?? []).map((row) => row.id)
      expect(queuedIds, 'the attention-parked run is in the triage queue').toContain(parkedInstanceId)
      expect(queuedIds, 'and so is the FAILED one — the queue is a union').toContain(failedInstanceId)

      // (2) The grouping. Both runs failed on the same activity, so they share a
      //     group; the key is the normalized SHAPE while the label keeps the first
      //     raw message.
      const group = (queue?.groups ?? []).find((candidate) =>
        (candidate.instanceIds ?? []).includes(parkedInstanceId!),
      )
      expect(group, 'the parked run belongs to an error group').toBeTruthy()
      expect(
        group?.instanceIds ?? [],
        'two runs that broke the same way group together',
      ).toContain(failedInstanceId)
      expect(group?.key, 'the group key is normalized, not the raw message').not.toBe(group?.label)
      expect(group?.key ?? '', 'numbers in the message are replaced by a placeholder').toContain('{n}')
      expect(group?.label ?? '', 'the label keeps a real message an operator can read').toContain(
        'EXECUTE_FUNCTION',
      )
      expect(queue?.grouping?.scanLimit, 'the response reports the bound it grouped over').toBeGreaterThan(0)

      // Narrowing by group is what makes a bulk action target one root cause.
      const narrowed = await getWorkflowFailureQueue(
        request,
        token,
        `limit=100&errorGroup=${encodeURIComponent(group!.key!)}`,
      )
      const narrowedIds = (narrowed?.data ?? []).map((row) => row.id)
      expect(narrowedIds).toContain(parkedInstanceId)
      expect(narrowedIds).toContain(failedInstanceId)
      // Narrowing is a FILTER, not a re-query: every row it returns must belong to
      // the group that was asked for, or a bulk action launched from a group would
      // act on failures the operator never looked at.
      const groupMembers = new Set(group?.instanceIds ?? [])
      for (const id of narrowedIds) {
        expect(groupMembers.has(id!), `row ${id} belongs to the selected error group`).toBe(true)
      }
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, parkedInstanceId)
      await cancelWorkflowInstanceIfExists(request, token, failedInstanceId)
      await deleteWorkflowDefinitionIfExists(request, token, parkedDefinitionId)
      await deleteWorkflowDefinitionIfExists(request, token, failedDefinitionId)
    }
  })

  test('a bulk replay runs through the progress module and clears the queue', async ({ request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    const instanceIds: string[] = []

    try {
      const payload = buildFailingStepDefinitionPayload(stamp, {
        suffix: '-replay',
        errorDirective: 'failureQueue',
      })
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      for (let index = 0; index < 2; index += 1) {
        const instanceId = await startWorkflowInstanceFixture(request, token, {
          workflowId: payload.workflowId,
          correlationKey: `qa-replay-${stamp}-${index}`,
        })
        instanceIds.push(instanceId)
        const parked = await pollWorkflowInstance(
          request,
          token,
          instanceId,
          (instance) => instance.status === 'PAUSED',
          { timeoutMs: 40_000 },
        )
        expect(parked?.status).toBe('PAUSED')
        expect(parked?.retryCount ?? 0).toBe(0)
      }

      const replay = await apiRequest(request, 'POST', '/api/workflows/instances/bulk-replay', {
        token,
        data: { action: 'retry', ids: instanceIds },
      })
      const replayBody = await readJsonSafe<{ ok?: boolean; progressJobId?: string | null }>(replay)
      expect(
        replay.status(),
        `bulk replay is accepted asynchronously (got ${replay.status()}: ${JSON.stringify(replayBody)})`,
      ).toBe(202)
      expect(replayBody?.ok).toBe(true)
      // §8.4 routes bulk work through the progress module rather than the request.
      const progressJobId = replayBody?.progressJobId
      expect(progressJobId, 'the caller is handed a progress job to track').toBeTruthy()

      // The replay is only real if the instances actually moved.
      for (const instanceId of instanceIds) {
        const after = await pollWorkflowInstance(
          request,
          token,
          instanceId,
          (instance) => (instance.retryCount ?? 0) > 0,
          { timeoutMs: 90_000, intervalMs: 500 },
        )
        expect(after?.retryCount, `instance ${instanceId} was replayed`).toBeGreaterThan(0)

        const detail = await apiRequest(
          request,
          'GET',
          `/api/workflows/instances/${encodeURIComponent(instanceId)}`,
          { token },
        )
        const detailBody = await readJsonSafe<{
          data?: { metadata?: { attention?: unknown } | null; errorMessage?: string | null }
        }>(detail)
        expect(
          detailBody?.data?.metadata?.attention ?? null,
          'a replayed instance leaves the failure queue by losing its attention marker',
        ).toBeNull()
      }

      const queue = await getWorkflowFailureQueue(request, token)
      const queuedIds = (queue?.data ?? []).map((row) => row.id)
      for (const instanceId of instanceIds) {
        expect(queuedIds, `instance ${instanceId} is no longer awaiting triage`).not.toContain(instanceId)
      }

      const job = await apiRequest(request, 'GET', `/api/progress/jobs/${progressJobId}`, { token })
      expect(job.status()).toBe(200)
      const jobBody = await readJsonSafe<ProgressJobBody>(job)
      expect(jobBody?.status, 'the progress job reports the batch as finished').toBe('completed')
      expect(jobBody?.resultSummary?.action).toBe('retry')
      expect(jobBody?.resultSummary?.affectedCount, 'every requested instance was acted on').toBe(
        instanceIds.length,
      )
      expect(jobBody?.resultSummary?.failedCount).toBe(0)
    } finally {
      for (const instanceId of instanceIds) {
        await cancelWorkflowInstanceIfExists(request, token, instanceId)
      }
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('bulk replay is gated on its own feature, and reading the queue is not', async ({ request }) => {
    test.setTimeout(60_000)

    // `employee` holds `workflows.instances.view` (so it can triage) but not
    // `workflows.instances.bulk_ops` (so it cannot act in bulk) — §8.4's ACL
    // appendix splits exactly there.
    const employeeToken = await getAuthToken(request, 'employee')

    const readable = await apiRequest(
      request,
      'GET',
      '/api/workflows/instances/failure-queue?limit=5',
      { token: employeeToken },
    )
    expect(readable.status(), 'triage is readable with instances.view alone').toBe(200)

    const refused = await apiRequest(request, 'POST', '/api/workflows/instances/bulk-replay', {
      token: employeeToken,
      data: { action: 'retry', ids: ['00000000-0000-0000-0000-000000000000'] },
    })
    expect(refused.status(), 'acting in bulk needs instances.bulk_ops').toBe(403)
    const refusedBody = await readJsonSafe<{ requiredFeatures?: string[] }>(refused)
    expect(refusedBody?.requiredFeatures ?? []).toContain('workflows.instances.bulk_ops')
  })

  test('the triage page lists the parked run and narrows to its error group', async ({ page, request }) => {
    test.setTimeout(180_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildFailingStepDefinitionPayload(stamp, {
        suffix: '-ui',
        errorDirective: 'failureQueue',
      })
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
      })
      await pollWorkflowInstance(request, token, instanceId, (instance) => instance.status === 'PAUSED', {
        timeoutMs: 40_000,
      })

      await login(page, 'admin')
      await page.goto('/backend/instances/failure-queue')

      // The row is there, and it names the step the directive parked on — the
      // triage surface has to say WHERE it broke, not only that it did.
      const row = page.getByText(payload.workflowId, { exact: true })
      await expect(row).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('boom', { exact: true }).first()).toBeVisible()

      // Error grouping is what makes this a triage list rather than a second
      // instance list. Selecting a group narrows the table to it.
      const groupChip = page
        .getByRole('button', { name: /EXECUTE_FUNCTION/ })
        .first()
      await expect(groupChip).toBeVisible({ timeout: 30_000 })
      await groupChip.click()
      await expect(groupChip).toHaveAttribute('aria-pressed', 'true')
      await expect(
        page.getByText(payload.workflowId, { exact: true }),
        'the run stays listed inside its own group',
      ).toBeVisible()
      await expect(
        page.getByText(/Showing \d+ instance/i),
        'the page states how large the selected group is',
      ).toBeVisible()
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
