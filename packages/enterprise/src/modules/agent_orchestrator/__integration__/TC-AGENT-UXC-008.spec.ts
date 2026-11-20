import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  getCapturedOmEvents,
  installOmEventCollector,
} from '@open-mercato/core/helpers/integration/sseEventCollector'
import { insertProcessExecutionFixtures } from './helpers/agentPerfFixtures'
import { test } from './helpers/processReconnectFixtures'

export const integrationMeta = {
  description: 'Native SSE reconnect recovers executions missed while the task list was hidden (#8584)',
  dependsOnModules: ['workflows'],
}

type ExecutionResponse = {
  execution: { id: string; status: string; workflowInstanceId: string | null }
}

for (const previousStatus of ['Never run', 'Failed'] as const) {
  test(`TC-AGENT-UXC-008: reconnect replaces ${previousStatus} after a missed execution`, async ({
    page, request, reconnectTask,
  }, testInfo) => {
    const { id: taskId, name, token, tenantId, organizationId } = reconnectTask
    let failedExecutionId: string | undefined
    if (previousStatus === 'Failed') {
      const failedAt = new Date(Date.now() - 60 * 60_000)
      ;[failedExecutionId] = await insertProcessExecutionFixtures([{
        tenantId,
        organizationId,
        processDefinitionId: taskId,
        status: 'failed',
        createdAt: failedAt,
        completedAt: failedAt,
      }])
    }

    await login(page, 'admin')
    await page.goto('/backend/processes/definitions', { waitUntil: 'domcontentloaded' })
    const taskRow = page.getByRole('row').filter({ hasText: name })
    await expect(taskRow.getByText(previousStatus, { exact: true })).toBeVisible()
    await page.waitForFunction(
      () => (window as unknown as { __omEventBridgeReady?: boolean }).__omEventBridgeReady === true,
    )
    await installOmEventCollector(page)
    const sentinel = randomUUID()
    await page.evaluate((value) => {
      ;(window as unknown as Record<string, unknown>).__taskReconnectDocument = value
    }, sentinel)

    try {
      const disconnected = page.waitForEvent('requestfailed', {
        predicate: (request) => new URL(request.url()).pathname === '/api/events/stream',
      })
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await disconnected
      await page.waitForFunction(
        () => (window as unknown as { __omEventBridgeReady?: boolean }).__omEventBridgeReady === false,
      )

      const started = await apiRequest(
        request, 'POST', `/api/agent_orchestrator/processes/${taskId}/executions`,
        { token, data: { input: {} } },
      )
      expect(started.status()).toBe(202)
      const executionId = expectId(
        (await readJsonSafe<{ executionId: string }>(started))?.executionId,
        'a real execution is accepted while the native bridge is disconnected',
      )
      expect(executionId).not.toBe(failedExecutionId)
      await drainIntegrationQueue('agent-process-executions')
      await expect.poll(async () => {
        const response = await apiRequest(
          request, 'GET', `/api/agent_orchestrator/executions/${executionId}`, { token },
        )
        expect(response.ok()).toBe(true)
        const body = await readJsonSafe<ExecutionResponse>(response)
        return body?.execution.workflowInstanceId ? body.execution.status : null
      }).toBe('completed')

      await expect(taskRow.getByText(previousStatus, { exact: true })).toBeVisible()
      await expect(taskRow.getByText('Completed', { exact: true })).toHaveCount(0)
      expect(await page.evaluate(() => document.visibilityState)).toBe('hidden')
      expect((await getCapturedOmEvents(page)).filter((event) => event.payload?.id === executionId)).toEqual([])
      await testInfo.attach('hidden-stale-row', { body: await page.screenshot(), contentType: 'image/png' })

      const streamReopened = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/events/stream' && response.status() === 200,
      )
      const listRefreshed = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/agent_orchestrator/processes'
        && response.request().method() === 'GET' && response.status() === 200,
      )
      await page.evaluate(() => {
        Reflect.deleteProperty(document, 'visibilityState')
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await streamReopened
      await listRefreshed
      await expect.poll(async () => (await getCapturedOmEvents(page)).map((event) => event.id))
        .toContain('om:bridge:reconnected')
      await expect(taskRow.getByText('Completed', { exact: true })).toBeVisible()
      await expect(taskRow.getByText(previousStatus, { exact: true })).toHaveCount(0)
      expect(await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__taskReconnectDocument,
      )).toBe(sentinel)
      expect((await getCapturedOmEvents(page)).filter((event) => event.payload?.id === executionId)).toEqual([])
      await testInfo.attach('reconnected-current-row', { body: await page.screenshot(), contentType: 'image/png' })
      await testInfo.attach('execution-recovery', {
        body: JSON.stringify({ previousStatus, failedExecutionId, executionId, recoveredStatus: 'completed', reloaded: false }),
        contentType: 'application/json',
      })
    } finally {
      if (!page.isClosed()) {
        await page.evaluate(() => {
          Reflect.deleteProperty(document, 'visibilityState')
          document.dispatchEvent(new Event('visibilitychange'))
        })
      }
    }
  })
}
