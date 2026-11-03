import { expect, test } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'

/**
 * TC-QIDX-5039: OR-combined custom-field filters return the union, not an empty list.
 *
 * The unit tests for this fix compile SQL against a fake Kysely, so they can prove the
 * shape of the WHERE but never that Postgres agrees. This spec closes that gap: it
 * drives the real list API against real rows, which is how #5039 was found in the first
 * place and the only level at which the regression would have been caught.
 */

const ENTITY_ID = 'customers:customer_person_profile'
const FIELD_KEY = `qa5039_${Date.now().toString(36)}`
const VALUE_A = 'alpha'
const VALUE_B = 'beta'

type CreatedPerson = { id: string; personId?: string }

const treeQuery = (combinator: 'and' | 'or', rules: Array<{ field: string; op: string; value: string }>): string => {
  const params = new URLSearchParams({ page: '1', pageSize: '50', 'filter[v]': '2' })
  params.set('filter[root][combinator]', combinator)
  rules.forEach((rule, index) => {
    params.set(`filter[root][children][${index}][type]`, 'rule')
    params.set(`filter[root][children][${index}][field]`, rule.field)
    params.set(`filter[root][children][${index}][op]`, rule.op)
    params.set(`filter[root][children][${index}][value]`, rule.value)
  })
  return params.toString()
}

test.describe('TC-QIDX-5039: OR-combined custom-field filters', () => {
  let token: string
  const createdPeople: CreatedPerson[] = []

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request)

    const definitions = await apiRequest(request, 'POST', '/api/entities/definitions.batch', {
      token,
      data: {
        entityId: ENTITY_ID,
        definitions: [{
          key: FIELD_KEY,
          kind: 'select',
          configJson: { label: 'QA 5039 focus', options: [VALUE_A, VALUE_B], filterable: true },
          isActive: true,
        }],
      },
    })
    expect(definitions.ok(), 'custom field definition should be created').toBeTruthy()

    for (const value of [VALUE_A, VALUE_B]) {
      const response = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: {
          firstName: 'Qa5039',
          lastName: `Person-${value}`,
          [`cf_${FIELD_KEY}`]: value,
        },
      })
      expect(response.ok(), `person for ${value} should be created`).toBeTruthy()
      createdPeople.push(await response.json() as CreatedPerson)
    }
  })

  test.afterAll(async ({ request }) => {
    for (const person of createdPeople) {
      if (!person?.id) continue
      await apiRequest(request, 'DELETE', `/api/customers/people?id=${person.id}`, { token }).catch(() => null)
    }
    await apiRequest(request, 'POST', '/api/entities/definitions.batch', {
      token,
      data: {
        entityId: ENTITY_ID,
        definitions: [{
          key: FIELD_KEY,
          kind: 'select',
          configJson: { label: 'QA 5039 focus', options: [VALUE_A, VALUE_B], filterable: true },
          isActive: false,
        }],
      },
    }).catch(() => null)
  })

  test('each value matches its own record on its own', async ({ request }) => {
    for (const value of [VALUE_A, VALUE_B]) {
      const response = await apiRequest(
        request,
        'GET',
        `/api/customers/people?${treeQuery('and', [{ field: `cf_${FIELD_KEY}`, op: 'is', value }])}`,
        { token },
      )
      expect(response.ok()).toBeTruthy()
      const body = await response.json()
      expect(body.total, `single filter on ${value}`).toBe(1)
    }
  })

  test('two values joined by OR return both records, not zero', async ({ request }) => {
    const response = await apiRequest(
      request,
      'GET',
      `/api/customers/people?${treeQuery('or', [
        { field: `cf_${FIELD_KEY}`, op: 'is', value: VALUE_A },
        { field: `cf_${FIELD_KEY}`, op: 'is', value: VALUE_B },
      ])}`,
      { token },
    )
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    // Before the fix this returned 0: the two disjuncts were ANDed, asking for one
    // record to hold both values at once.
    expect(body.total).toBe(2)
  })

  test('two values joined by AND still return nothing, so the fix did not over-correct', async ({ request }) => {
    const response = await apiRequest(
      request,
      'GET',
      `/api/customers/people?${treeQuery('and', [
        { field: `cf_${FIELD_KEY}`, op: 'is', value: VALUE_A },
        { field: `cf_${FIELD_KEY}`, op: 'is', value: VALUE_B },
      ])}`,
      { token },
    )
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body.total).toBe(0)
  })

  test('a non-custom-field condition ORed with a custom-field one widens the result', async ({ request }) => {
    // `lifecycle_stage` is doc-backed and unencrypted, so it filters for real; an
    // encrypted base column such as `last_name` would compare against ciphertext and
    // contribute nothing, hiding the very behaviour under test.
    const stageRule = { field: 'lifecycle_stage', op: 'is', value: 'customer' }
    const cfRule = { field: `cf_${FIELD_KEY}`, op: 'is', value: VALUE_B }

    const totalFor = async (combinator: 'and' | 'or', rules: Array<{ field: string; op: string; value: string }>) => {
      const response = await apiRequest(request, 'GET', `/api/customers/people?${treeQuery(combinator, rules)}`, { token })
      expect(response.ok()).toBeTruthy()
      return (await response.json()).total as number
    }

    const stageOnly = await totalFor('and', [stageRule])
    const cfOnly = await totalFor('and', [cfRule])
    const union = await totalFor('or', [stageRule, cfRule])

    expect(cfOnly).toBe(1)
    // Before the fix the custom-field leg was ANDed onto the whole query, so adding an
    // OR branch removed rows instead of adding them — the union came back at or below
    // the smaller leg. Counts are derived rather than hard-coded so the assertion does
    // not depend on how much demo data the environment happens to carry.
    // Deliberately not `stageOnly + cfOnly`: whether the new record also carries the
    // filtered lifecycle stage depends on the create defaults, and that is not what
    // this test is about.
    expect(union).toBeGreaterThan(stageOnly)
    expect(union).toBeGreaterThanOrEqual(cfOnly)
  })
})
