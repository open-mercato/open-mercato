import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  SCHEDULER_FORBIDDEN_INTERNAL_QUEUES,
  SCHEDULER_TARGETS_PATH,
} from './helpers/scheduler'

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
 * TC-SCHED-004: GET /api/scheduler/targets returns scheduler-safe queue names
 * and registered command IDs (from the command registry), both sorted
 * alphabetically by value. Internal/system workers must stay undiscoverable.
 * Read-only, no fixtures.
 */
test.describe('TC-SCHED-004: GET /api/scheduler/targets lists queues and commands', () => {
  test('returns only scheduler-safe queues plus a non-empty sorted command list', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', SCHEDULER_TARGETS_PATH, { token })
    expect(response.status()).toBe(200)

    const body = await readJsonSafe<TargetsResponse>(response)
    const queues = body?.queues ?? []
    const commands = body?.commands ?? []

    // Queues: well-shaped, sorted, and free of internal/system worker queues (#5213).
    expect(Array.isArray(body?.queues)).toBe(true)
    expectOptionShape(queues, 'queues')
    expectSortedByValue(queues, 'queues')
    const queueValues = queues.map((queue) => queue.value)
    for (const forbidden of SCHEDULER_FORBIDDEN_INTERNAL_QUEUES) {
      expect(queueValues, `internal queue ${forbidden} must not be a scheduler target`).not.toContain(forbidden)
    }

    // Commands: non-empty, well-shaped, and sorted.
    expect(Array.isArray(body?.commands)).toBe(true)
    expect(commands.length).toBeGreaterThan(0)
    expectOptionShape(commands, 'commands')
    expectSortedByValue(commands, 'commands')
  })
})
