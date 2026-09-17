import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-AGENT-PROCDEF-005: choose reported progress and a weekday schedule, then save the intended setup', async ({
  page,
  request,
}, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  const workflowId = `tc-procdef-005-${Date.now()}`
  const name = `Process setup ${workflowId}`
  let workflowRecordId: string | undefined
  let processId: string | undefined
  try {
    const created = await apiRequest(request, 'POST', '/api/workflows/definitions', {
      token,
      data: {
        workflowId,
        workflowName: name,
        enabled: true,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Receive case', stepType: 'START', milestone: 'case_received' },
            { stepId: 'end', stepName: 'Finish case', stepType: 'END', milestone: 'case_completed' },
          ],
          transitions: [{ transitionId: 'finish', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
        },
      },
    })
    const workflow = await readJsonSafe<{ data?: { id: string } }>(created)
    workflowRecordId = workflow?.data?.id
    expect(created.status()).toBe(201)
    expect(workflowRecordId).toBeTruthy()

    await login(page, 'admin')
    await page.goto('/backend/processes/definitions')
    await page.getByRole('button', { name: 'New definition', exact: true }).click()
    const form = page.getByRole('main')
    await form.getByRole('textbox').first().fill(name)
    await form.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'Existing workflow', exact: true }).click()
    await form.getByRole('button', { name: 'Browse Workflows', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Select Workflow', exact: true })
    await picker.getByRole('textbox', { name: 'Search by workflow ID, name, or description…' }).fill(workflowId)
    await picker.getByRole('button', { name: `${name} ${workflowId} v1 Enabled`, exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(form.getByRole('button', { name: `${name} (${workflowId})`, exact: true })).toBeVisible()
    await form
      .getByRole('button', { name: 'Case received case_received Reported by: Receive case', exact: true })
      .click()
    await form.getByRole('textbox', { name: 'Name shown to your team', exact: true }).fill('Request received')
    await expect(
      form.getByRole('button', {
        name: 'Case received case_received Reported by: Receive case',
        exact: true,
      }),
    ).toHaveCount(0)

    await form.getByRole('button', { name: 'Add schedule', exact: true }).click()
    await form.getByRole('combobox', { name: 'Repeat', exact: true }).click()
    await page.getByRole('option', { name: 'Weekdays', exact: true }).click()
    await form.getByRole('textbox', { name: 'At time', exact: true }).fill('09:30')
    await form.getByRole('combobox', { name: 'Timezone', exact: true }).fill('Europe/Warsaw')
    await expect(form.getByText(/Next runs:.*9:30 AM/)).toBeVisible()
    for (const title of [
      'What should this process do?',
      'When should it start?',
      'What progress should people see?',
      'What can this process access?',
      'Ready to use?',
      'Advanced input contract',
    ]) {
      await expect(form.getByText(title, { exact: true })).toBeVisible()
      await expect(form.getByRole('button', { name: title, exact: true })).toHaveCount(0)
    }
    await expect(form.getByText('Default input (JSON)', { exact: true })).toBeVisible()
    await expect(form.getByText('Input schema (JSON Schema)', { exact: true })).toBeVisible()
    await form.getByRole('checkbox', { name: 'Definition enabled', exact: true }).uncheck()

    if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath('process-setup-desktop.png'), fullPage: true })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath('process-setup-mobile.png'), fullPage: true })
    }

    const saving = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/agent_orchestrator/processes',
    )
    await form.getByRole('button', { name: 'Save definition', exact: true }).first().click()
    const saved = await saving
    const savedBody: unknown = await saved.json()
    processId =
      savedBody && typeof savedBody === 'object' && 'id' in savedBody && typeof savedBody.id === 'string'
        ? savedBody.id
        : undefined
    expect(saved.status()).toBe(201)
    expect(processId).toBeTruthy()
    const detail = await apiRequest(request, 'GET', `/api/agent_orchestrator/processes/${processId}`, {
      token,
    })
    expect(detail.ok()).toBeTruthy()
    const stored = await readJsonSafe<{ definition?: Record<string, unknown> }>(detail)
    expect(stored?.definition).toMatchObject({
      name,
      enabled: false,
      milestones: [{ key: 'case_received', label: 'Request received', order: 0 }],
      triggers: [
        { kind: 'manual', requireFeatures: [] },
        { kind: 'schedule', cron: '30 9 * * 1-5', timezone: 'Europe/Warsaw', enabled: true },
      ],
    })
  } finally {
    try {
      if (processId) {
        const deleted = await apiRequest(
          request,
          'DELETE',
          `/api/agent_orchestrator/processes?id=${encodeURIComponent(processId)}`,
          { token },
        )
        expect(deleted.ok(), 'process fixture cleanup').toBeTruthy()
      }
    } finally {
      if (workflowRecordId) {
        const deleted = await apiRequest(
          request,
          'DELETE',
          `/api/workflows/definitions/${encodeURIComponent(workflowRecordId)}`,
          { token },
        )
        expect(deleted.ok(), 'workflow fixture cleanup').toBeTruthy()
      }
    }
  }
})
