import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { SCHEDULER_EXECUTION_QUEUE, SCHEDULER_TARGETS_PATH } from './helpers/scheduler'

type TargetOption = { value: string; label: string }
type TargetsResponse = { queues?: TargetOption[]; commands?: TargetOption[] }

function expectSortedByValue(options: TargetOption[], label: string) {
  const values = options.map((option) => option.value)
  expect(values, `${label} should be sorted alphabetically by value`).toEqual(
    [...values].sort((a, b) => a.localeCompare(b)),
  )
}

function expectOptionShape(options: TargetOption[], label: string) {
  for (const option of options) {
    expect(typeof option.value, `${label} option value should be a string`).toBe('string')
    expect(typeof option.label, `${label} option label should be a string`).toBe('string')
  }
}

/**
 * TC-SCHED-004: GET /api/scheduler/targets returns available queue names
 * (from module workers) and registered command IDs (from the command
 * registry), both sorted alphabetically by value. Read-only, no fixtures.
 */
test.describe('TC-SCHED-004: GET /api/scheduler/targets lists queues and commands', () => {
  test('returns sorted queues (incl. scheduler-execution) and a non-empty command list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', SCHEDULER_TARGETS_PATH, { token })
    expect(response.status()).toBe(200)

    const body = await readJsonSafe<TargetsResponse>(response)
    const queues = body?.queues ?? []
    const commands = body?.commands ?? []

    // Queues: non-empty, well-shaped, sorted, and include the known scheduler queue.
    expect(Array.isArray(body?.queues)).toBe(true)
    expect(queues.length).toBeGreaterThan(0)
    expectOptionShape(queues, 'queues')
    expect(queues.map((queue) => queue.value)).toContain(SCHEDULER_EXECUTION_QUEUE)
    expectSortedByValue(queues, 'queues')

    // Commands: non-empty, well-shaped, and sorted.
    expect(Array.isArray(body?.commands)).toBe(true)
    expect(commands.length).toBeGreaterThan(0)
    expectOptionShape(commands, 'commands')
    expectSortedByValue(commands, 'commands')
  })
})
