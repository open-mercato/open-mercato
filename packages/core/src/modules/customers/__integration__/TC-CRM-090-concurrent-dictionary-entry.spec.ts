import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CRM-090 — Creating people in parallel with the same new job title must not fail.
 *
 * Each create adds the job title to the `job_title` dictionary. Two transactions that both
 * miss the entry used to insert it at flush time, so the second one hit the
 * `customer_dictionary_entries_unique` constraint and the whole create returned 500 DATABASE_ERROR.
 * The list is read once before the creates so a cached dictionary must be invalidated by them.
 *
 * Self-contained: creates its own people and dictionary entry and deletes them in teardown.
 */

const PEOPLE = '/api/customers/people'
const JOB_TITLES = '/api/customers/dictionaries/job-titles'
const PARALLEL_CREATES = 8

type DictionaryItem = { id: string; value: string }

test.describe('TC-CRM-090 parallel person creates sharing a new job title', () => {
  test('every create succeeds and the refreshed dictionary keeps a single entry', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const jobTitle = `Race Buyer ${stamp}`
    const personIds: string[] = []
    try {
      const warmUp = await apiRequest(request, 'GET', JOB_TITLES, { token })
      expect(warmUp.ok(), `dictionary warm-up status ${warmUp.status()}`).toBeTruthy()

      const responses = await Promise.all(
        Array.from({ length: PARALLEL_CREATES }, (_, index) =>
          apiRequest(request, 'POST', PEOPLE, {
            token,
            data: {
              firstName: 'Race',
              lastName: `Person ${stamp}-${index}`,
              displayName: `Race Person ${stamp}-${index}`,
              jobTitle,
            },
          }),
        ),
      )

      for (const [index, response] of responses.entries()) {
        const body = (await readJsonSafe(response)) as { id?: string; entityId?: string } | null
        const id = body?.id ?? body?.entityId
        if (id) personIds.push(id)
        expect(response.status(), `create #${index} failed: ${JSON.stringify(body)}`).toBe(201)
      }

      const dictionaryResponse = await apiRequest(request, 'GET', JOB_TITLES, { token })
      expect(dictionaryResponse.ok(), `dictionary status ${dictionaryResponse.status()}`).toBeTruthy()
      const dictionary = (await readJsonSafe(dictionaryResponse)) as { items?: DictionaryItem[] } | null
      const matching = (dictionary?.items ?? []).filter((item) => item.value === jobTitle)
      expect(matching).toHaveLength(1)

      await apiRequest(request, 'DELETE', `${JOB_TITLES}/${matching[0].id}`, { token }).catch(() => {})
    } finally {
      for (const id of personIds) {
        await apiRequest(request, 'DELETE', `${PEOPLE}?id=${id}`, { token }).catch(() => {})
      }
    }
  })
})
